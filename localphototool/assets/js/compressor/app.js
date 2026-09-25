/* ==========================================================================
   LocalPhotoTool — compressor page controller
   ========================================================================== */
(function () {
  'use strict';

  var engine = window.LPT.engine;
  var zipLib = window.LPT.zip;

  // Resolve the worker relative to this script so the site works from the
  // domain root, a sub-directory, or a plain file:// preview.
  var SELF_SRC = (document.currentScript && document.currentScript.src) || '';
  var WORKER_URL = SELF_SRC ? new URL('worker.js', SELF_SRC).href : 'worker.js';
  /* Our own copy, two levels up from assets/js/compressor/. Kept next to the
     rest of the assets so the decoder is never a third-party request. */
  var HEIC_URL = SELF_SRC
    ? new URL('../../vendor/libheif-bundle.mjs', SELF_SRC).href
    : 'assets/vendor/libheif-bundle.mjs';

  /* ---------------------------------------------------------------------
     State
     --------------------------------------------------------------------- */
  var DEFAULTS = {
    mode: 'auto',
    format: 'auto',
    quality: 0.8,
    targetKB: 200,
    maxDimension: 0,
    sharpen: 'auto',
    dither: true,
    pngColors: 'auto',
    heic: true
  };

  var STORE_KEY = 'lpt.options.v1';

  var state = {
    options: Object.assign({}, DEFAULTS),
    items: [],
    seq: 0,
    pool: null,
    inline: false,
    active: 0
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    var kb = bytes / 1024;
    if (kb < 1000) return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
    var mb = kb / 1024;
    if (mb < 1000) return (mb < 10 ? mb.toFixed(2) : mb.toFixed(1)) + ' MB';
    return (mb / 1024).toFixed(2) + ' GB';
  }

  function baseName(name) {
    var i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  function savedPct(before, after) {
    if (!before) return 0;
    return Math.round((1 - after / before) * 100);
  }

  function uid() { return 'i' + (++state.seq) + '-' + Math.random().toString(36).slice(2, 7); }

  var toastTimer = null;
  function toast(message, kind) {
    var node = $('#toast');
    if (!node) return;
    node.textContent = '';
    node.appendChild(el('span', { text: message }));
    node.classList.toggle('is-warn', kind === 'warn');
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('is-visible'); }, 3600);
  }

  /* ---------------------------------------------------------------------
     Options persistence
     --------------------------------------------------------------------- */
  /* A page may pin the choices its own name promises. /heic-to-jpg/ pins JPEG,
     because otherwise "auto" format selection — which picks the smallest
     honest answer — can legitimately choose PNG for a smooth photo and quietly
     break the one promise the page makes.

     Pinned keys beat stored preferences but are never written back, so a visit
     to a landing page cannot silently rewrite the settings someone chose on the
     main tool. Declared as an attribute rather than an inline script so it
     stays inside the Content-Security-Policy. */
  var PAGE_DEFAULTS = (function () {
    var out = {};
    try {
      var raw = document.documentElement.getAttribute('data-compressor-defaults');
      if (!raw) return out;
      var parsed = JSON.parse(raw);
      Object.keys(DEFAULTS).forEach(function (k) {
        if (parsed[k] !== undefined) out[k] = parsed[k];
      });
    } catch (e) { /* a malformed attribute must not take the page down */ }
    return out;
  })();

  function loadOptions() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (parsed[k] !== undefined) state.options[k] = parsed[k];
        });
      }
    } catch (e) { /* private mode */ }
    Object.keys(PAGE_DEFAULTS).forEach(function (k) { state.options[k] = PAGE_DEFAULTS[k]; });
  }

  function saveOptions() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.options)); } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------------
     Worker pool
     --------------------------------------------------------------------- */
  function workerSupported() {
    try {
      return typeof Worker !== 'undefined' &&
        typeof OffscreenCanvas !== 'undefined' &&
        typeof createImageBitmap === 'function' &&
        typeof OffscreenCanvas.prototype.convertToBlob === 'function';
    } catch (e) { return false; }
  }

  function WorkerPool(size) {
    this.size = size;
    this.slots = [];
    this.queue = [];
    this.caps = null;
    this.failed = false;
  }

  WorkerPool.prototype.init = function () {
    var self = this;
    var promises = [];
    for (var i = 0; i < this.size; i++) {
      (function (index) {
        var slot = { index: index, worker: null, job: null, ready: false, caps: null };
        try {
          var w = new Worker(WORKER_URL);
          slot.worker = w;
          w.onmessage = function (ev) { self._onMessage(slot, ev); };
          w.onerror = function () {
            if (!slot.ready) { self.failed = true; }
          };
          promises.push(new Promise(function (resolve) {
            slot.resolveReady = resolve;
            w.postMessage({ type: 'warmup' });
          }));
        } catch (err) {
          self.failed = true;
          promises.push(Promise.resolve());
        }
        self.slots.push(slot);
      })(i);
    }
    return Promise.race([
      Promise.all(promises).then(function () { return self; }),
      new Promise(function (resolve) { setTimeout(function () { resolve(self); }, 8000); })
    ]);
  };

  WorkerPool.prototype._onMessage = function (slot, ev) {
    var msg = ev.data || {};
    if (msg.type === 'caps') {
      slot.caps = msg.payload;
      slot.ready = true;
      this.caps = msg.payload;
      if (typeof this.onCaps === 'function') this.onCaps(msg.payload);
      if (slot.resolveReady) { slot.resolveReady(); slot.resolveReady = null; }
      return;
    }
    var job = slot.job;
    if (!job || job.id !== msg.id) return;
    if (msg.type === 'progress') {
      job.onProgress(msg.payload.frac, msg.payload.label);
      return;
    }
    slot.job = null;
    if (msg.type === 'done') job.resolve(msg.payload);
    else job.reject(new Error((msg.payload && msg.payload.message) || 'failed'));
    this._drain();
  };

  WorkerPool.prototype._drain = function () {
    for (var i = 0; i < this.slots.length; i++) {
      var slot = this.slots[i];
      if (slot.job || !slot.worker || !this.queue.length) continue;
      var job = this.queue.shift();
      slot.job = job;
      slot.worker.postMessage({ type: 'compress', id: job.id, file: job.file, options: job.options });
    }
  };

  WorkerPool.prototype.run = function (file, options, onProgress) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var job = {
        id: uid(), file: file, options: options,
        onProgress: onProgress, resolve: resolve, reject: reject
      };
      self.queue.push(job);
      self._drain();
    });
  };

  /* Ask every worker to fetch the named codecs. Fire-and-forget: the pool is
     usable immediately and each worker reports back when its set is ready. */
  WorkerPool.prototype.prewarm = function (formats) {
    if (!formats || !formats.length) return;
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i].worker) {
        this.slots[i].worker.postMessage({ type: 'prewarm', formats: formats });
      }
    }
  };

  /* ---------------------------------------------------------------------
     HEIC / HEIF — lazy, optional, entirely client-side

     libheif arrives as one ~1.4 MB ES module served from our own origin. Two
     properties matter more than its size:

       · it contains no `eval` and no `new Function`, so it survives our
         Content-Security-Policy. The previous pick, heic2any, did not: its
         Emscripten glue called `new Function` on module init, the browser
         refused to run it, and every HEIC conversion died before a single
         pixel was decoded — while a bare local server (no CSP) kept saying the
         feature was fine.
       · it applies the EXIF orientation tag itself. An iPhone portrait photo is
         stored landscape with a "rotate me" tag; ignore that tag and the user
         gets a sideways picture, which is worse than an error message.

     Decoding is serialised on purpose: one 12 MP frame is ~48 MB of RGBA, and
     a phone that decodes four of those at once is a phone that kills the tab.
     --------------------------------------------------------------------- */
  var heicLib = null;

  function loadHeicLib() {
    if (!heicLib) {
      heicLib = import(/* @vite-ignore */ HEIC_URL).then(function (mod) {
        var factory = mod.default || mod;
        /* The module default export is the Emscripten factory, not the module. */
        return typeof factory === 'function' ? factory() : factory;
      }).then(function (lib) {
        if (!lib || typeof lib.HeifDecoder !== 'function') throw new Error('heic-no-decoder');
        return lib;
      });
      heicLib.catch(function () { heicLib = null; });   // a failed load may be retried
    }
    return heicLib;
  }

  function isHeic(file) {
    return /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
  }

  function decodeHeicOnce(file) {
    return file.arrayBuffer().then(function (buffer) {
      return loadHeicLib().then(function (lib) {
        var images = new lib.HeifDecoder().decode(buffer);
        if (!images || !images.length) throw new Error('heic-no-image');
        var img = images[0];
        var w = img.get_width();
        var h = img.get_height();
        if (!w || !h) throw new Error('heic-bad-size');

        var pixels = new Uint8ClampedArray(w * h * 4);
        return new Promise(function (resolve) {
          img.display({ data: pixels, width: w, height: h }, function (out) {
            resolve(out && out.data ? out : { data: pixels, width: w, height: h });
          });
        }).then(function (out) {
          try { img.free(); } catch (e) { /* not fatal */ }

          var canvas = document.createElement('canvas');
          canvas.width = out.width;
          canvas.height = out.height;
          var ctx = canvas.getContext('2d');
          var frame = ctx.createImageData(out.width, out.height);
          frame.data.set(out.data);
          ctx.putImageData(frame, 0, 0);

          return new Promise(function (resolve, reject) {
            /* 0.96 rather than 1.0: this is an intermediate the compressor will
               re-encode, so one clean pass is enough — but two lossy passes at
               low quality would be visible in the final file. */
            canvas.toBlob(function (blob) {
              blob ? resolve(blob) : reject(new Error('heic-encode-failed'));
            }, 'image/jpeg', 0.96);
          });
        });
      });
    });
  }

  var heicQueue = Promise.resolve();
  function decodeHeic(file) {
    /* Chain onto the previous decode whether it settled or failed. */
    var next = heicQueue.then(function () { return decodeHeicOnce(file); },
                              function () { return decodeHeicOnce(file); });
    heicQueue = next.catch(function () { return null; });
    return next;
  }

  function normalizeInput(file) {
    if (!state.options.heic || !isHeic(file)) return Promise.resolve(file);
    return decodeHeic(file).then(function (blob) {
      var name = (file.name || 'photo.heic').replace(/\.(heic|heif)$/i, '.jpg');
      return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
    });
  }

  /* ---------------------------------------------------------------------
     Intake
     --------------------------------------------------------------------- */
  function addFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList).filter(function (f) {
      return f && (f.type.indexOf('image/') === 0 || isHeic(f));
    });
    if (!incoming.length) {
      toast('Those files are not images.');
      return;
    }
    incoming.forEach(function (file) {
      var item = {
        id: uid(),
        file: file,
        name: file.name || 'image',
        status: 'queued',
        progress: 0,
        label: 'Queued',
        result: null,
        outputBlob: null,
        outputName: null,
        url: null,
        thumb: null,
        error: null,
        worse: false
      };
      state.items.push(item);
    });
    render();
    markBatchStart();
    pump();
    revealedBatch = false;   /* a new batch may bring results into view again */
    revealResults();
  }

  /* ---------------------------------------------------------------------
     Finish signal

     A chime only earns its place when the user could plausibly have looked
     away. A two-image batch that lands in a second does not need one, and a
     batch where nothing succeeded should stay quiet and let the toast speak.
     --------------------------------------------------------------------- */
  var CHIME_AFTER_MS = 6000;
  var batch = { running: false, start: 0 };
  var baseTitle = document.title;

  function markBatchStart() {
    batch.running = true;
    batch.start = Date.now();
  }

  function flagTitle(show) {
    if (show) {
      if (document.title.indexOf('Done') === -1) document.title = '✓ Done — ' + baseTitle;
    } else if (document.title !== baseTitle) {
      document.title = baseTitle;
    }
  }

  function batchFinished() {
    if (!batch.running) return;
    batch.running = false;

    var done = state.items.filter(function (i) { return i.status === 'done'; });
    if (!done.length) return;

    var elapsed = Date.now() - batch.start;
    if (elapsed < CHIME_AFTER_MS && !document.hidden) return;

    /* The title is the reliable half: iOS suspends AudioContext in a
       background tab, so the sound may never arrive — the title always does. */
    flagTitle(true);
    if (window.LPTChime && window.LPTChime.enabled()) window.LPTChime.play();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) flagTitle(false);
  });

  /* Two controls, one setting: the switch lives with the other options, and
     a bell sits in the results bar because that is where a chime is heard —
     someone startled by it should not have to open Advanced settings. */
  function syncChime() {
    var api = window.LPTChime;
    if (!api) return;
    var on = api.enabled();
    var box = $('#chimeOn');
    if (box) box.checked = on;
    var bell = $('#chimeToggle');
    if (bell) {
      bell.setAttribute('aria-pressed', on ? 'true' : 'false');
      bell.setAttribute('aria-label', on ? 'Turn the finish sound off' : 'Turn the finish sound on');
      bell.title = on ? 'Finish sound is on' : 'Finish sound is off';
    }
  }

  function initChime() {
    var api = window.LPTChime;
    if (!api) return;
    syncChime();

    var box = $('#chimeOn');
    if (box) {
      box.addEventListener('change', function () {
        api.setEnabled(box.checked);
        syncChime();
        if (box.checked) api.play();
      });
    }

    var bell = $('#chimeToggle');
    if (bell) {
      bell.addEventListener('click', function () {
        var on = !api.enabled();
        api.setEnabled(on);
        syncChime();
        if (on) api.play();
      });
    }

    /* Previewing is a direct request, so it plays even when the chime is off. */
    var test = $('#chimeTest');
    if (test) test.addEventListener('click', function () { api.play(); });
  }

  function pump() {
    var pending = state.items.filter(function (i) {
      return i.status === 'queued' && !i.inFlight;
    });
    if (!pending.length) {
      if (state.active === 0) batchFinished();
      updateSummary();
      return;
    }
    var capacity = state.pool && !state.inline ? state.pool.size : 1;
    var room = capacity - state.active;
    if (room <= 0) return;

    pending.slice(0, room).forEach(function (item) {
      item.status = 'processing';
      state.active++;
      processItem(item).then(function () {
        state.active--;
        pump();
      });
    });
    renderItemStates();
  }

  function processItem(item) {
    // Token guard: if the user changes settings while a job is running, the
    // stale result must never overwrite the newer run's output.
    var token = (item.runToken = (item.runToken || 0) + 1);
    item.inFlight = true;
    var options = buildOptions();
    /* Keeping the original when the re-encode came out bigger is a good trade
       for compression — and the wrong one for a format conversion. Somebody
       converting a HEIC is here precisely because .heic does not open where
       they need it, so handing the HEIC back (smaller!) would defeat the whole
       point of the visit. Size logic applies only while the format holds. */
    var converting = state.options.heic && isHeic(item.file);
    var step = function (frac, label) {
      if (item.runToken !== token) return;
      item.progress = frac;
      item.label = label || 'Working';
      updateProgress(item);
    };

    return normalizeInput(item.file)
      .then(function (input) {
        if (state.pool && !state.inline && !state.pool.failed) {
          return state.pool.run(input, options, step);
        }
        return engine.compress(input, options, {
          caps: (state.pool && state.pool.caps && state.pool.caps.formats) || engine.detectFormats(),
          report: step
        });
      })
      .then(function (result) {
        item.inFlight = false;
        if (item.runToken !== token) { pump(); return; }
        item.result = result;
        var worse = !converting && result.blob.size >= item.file.size;
        item.worse = worse;
        item.outputBlob = worse ? item.file : result.blob;
        item.outputName = worse
          ? item.name
          : baseName(item.name) + '.' + extFor(result.formatKey);
        item.url = URL.createObjectURL(item.outputBlob);
        item.status = 'done';
        item.progress = 1;
        item.label = worse ? 'Already optimal' : 'Done';
        renderItemStates(item);
        updateSummary();
        revealResults();
        /* Never quietly substitute a format the user explicitly picked. */
        if (result.downgraded) {
          toast(result.downgraded.toUpperCase() + ' is not available here — saved as '
            + (result.formatKey === 'webp' ? 'WebP' : 'JPEG') + ' instead.', 'warn');
        }
        preparePhotoTwin(item);
      })
      .catch(function (err) {
        item.inFlight = false;
        if (item.runToken !== token) { pump(); return; }
        item.status = 'error';
        item.error = friendlyError(err);
        item.label = 'Failed';
        renderItemStates(item);
        updateSummary();
      });
  }

  function extFor(key) {
    return key === 'jpeg' ? 'jpg' : (key || 'jpg');
  }

  function friendlyError(err) {
    var msg = (err && err.message) || 'unknown';
    if (msg === 'decode-failed' || msg === 'decode-unsupported') {
      return 'This file could not be decoded in your browser.';
    }
    if (msg === 'too-large') return 'Image is too large for in-browser processing.';
    if (/^heic-no-decoder/.test(msg)) return 'The HEIC decoder could not be loaded. Reload the page and try again.';
    if (/^heic-/.test(msg)) return 'This HEIC file could not be opened — it may be damaged.';
    return 'Compression failed — try a different output format.';
  }

  /* On a phone the results land far below the fold, so pull them into view as
     soon as a batch starts. Skipped when they are already comfortably visible
     so the page is never yanked out from under someone's thumb. */
  var revealedBatch = false;
  function revealResults(force) {
    var results = $('#results');
    if (!results || results.hidden) return;
    var modal = $('#compareModal');
    if (modal && !modal.hidden) return;
    if (!force && revealedBatch) return;

    var box = results.getBoundingClientRect();
    if (!force && box.top >= 0 && box.top < window.innerHeight * 0.55) {
      revealedBatch = true;
      return;
    }

    revealedBatch = true;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(function () {
      try {
        results.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      } catch (e) {
        results.scrollIntoView();
      }
    });
  }

  function buildOptions() {
    var o = state.options;
    return {
      mode: o.mode,
      format: o.format,
      quality: Number(o.quality),
      targetKB: Number(o.targetKB),
      maxDimension: Number(o.maxDimension) || 0,
      sharpen: o.sharpen,
      dither: !!o.dither,
      pngColors: o.pngColors === 'auto' ? 'auto'
        : (o.pngColors === 'off' ? false : Number(o.pngColors))
    };
  }

  /* ---------------------------------------------------------------------
     Rendering — results
     --------------------------------------------------------------------- */
  var listNode = null;
  var renderedIds = {};

  function render() {
    listNode = $('#resultList');
    var results = $('#results');
    if (!state.items.length) {
      results.hidden = true;
      updateSummary();
      return;
    }
    results.hidden = false;
    state.items.forEach(function (item) {
      if (renderedIds[item.id]) return;
      var node = buildResultNode(item);
      renderedIds[item.id] = node;
      listNode.appendChild(node);
    });
    updateSummary();
  }

  function buildResultNode(item) {
    var thumb = el('div', { class: 'result__thumb' }, [el('span', { class: 'ph', text: previewTag(item) })]);
    var name = el('p', { class: 'result__name', text: item.name, title: item.name });
    var meta = el('div', { class: 'result__meta' });
    var bar = el('div', { class: 'result__bar' }, [el('span', { style: 'width:0%' })]);
    var main = el('div', { class: 'result__main' }, [name, meta, bar]);
    var actions = el('div', { class: 'result__actions' });
    var note = el('div', { class: 'result__note hidden' });

    var node = el('div', { class: 'result', 'data-id': item.id }, [thumb, main, actions, note]);
    item.node = { root: node, thumb: thumb, meta: meta, bar: bar, actions: actions, note: note, name: name };
    renderItemStates(item);
    return node;
  }

  function previewTag(item) {
    var m = /\.([a-z0-9]+)$/i.exec(item.name || '');
    return m ? m[1].toUpperCase().slice(0, 4) : 'IMG';
  }

  function renderItemStates(item) {
    var items = item ? [item] : state.items;
    items.forEach(function (it) {
      if (!it.node) return;
      var n = it.node;
      var pct = Math.round((it.progress || 0) * 100);

      if (it.status === 'error') {
        n.bar.classList.add('is-done');
        n.bar.firstChild.style.width = '100%';
        n.bar.firstChild.style.background = 'var(--danger-500)';
        n.note.textContent = it.error;
        n.note.classList.remove('hidden');
        n.meta.innerHTML = '';
        n.meta.appendChild(el('span', { text: formatBytes(it.file.size) }));
        n.actions.innerHTML = '';
        n.actions.appendChild(el('button', {
          class: 'btn btn--quiet btn--sm', 'data-act': 'remove', text: 'Remove'
        }));
        return;
      }

      if (it.status === 'done' && it.result) {
        var r = it.result;
        n.bar.classList.add('is-done');
        n.bar.firstChild.style.width = '100%';
        if (it.worse) {
          n.bar.firstChild.style.background = 'var(--warning-500)';
        }
        n.meta.innerHTML = '';
        n.meta.appendChild(el('span', { html: formatBytes(it.file.size) + ' → <strong>' + formatBytes(it.outputBlob.size) + '</strong>' }));
        n.meta.appendChild(el('span', { class: 'sep', text: '·' }));
        if (it.worse) {
          n.meta.appendChild(el('span', { class: 'result__grew', text: 'already optimal' }));
        } else {
          n.meta.appendChild(el('span', { class: 'result__saved', text: '−' + savedPct(it.file.size, r.blob.size) + '%' }));
        }
        n.meta.appendChild(el('span', { class: 'sep', text: '·' }));
        n.meta.appendChild(el('span', { text: r.originalWidth + '×' + r.originalHeight + (r.width !== r.originalWidth ? ' → ' + r.width + '×' + r.height : '') }));
        n.meta.appendChild(el('span', { class: 'sep', text: '·' }));
        var label = it.worse ? 'Original kept' : formatLabel(r);
        n.meta.appendChild(el('span', { class: 'badge badge--brand', text: label }));

        if (it.thumbImg === undefined) {
          it.thumbImg = true;
          var img = el('img', { alt: '', loading: 'lazy', src: it.url });
          n.thumb.innerHTML = '';
          n.thumb.appendChild(img);
        }

        n.actions.innerHTML = '';
        n.actions.appendChild(el('button', {
          class: 'btn btn--ghost btn--sm', 'data-act': 'compare',
          html: icon('compare') + '<span>Compare</span>', title: 'Compare before and after'
        }));
        n.actions.appendChild(el('button', {
          class: 'btn btn--primary btn--sm', 'data-act': 'download',
          html: icon('download') + '<span>Save</span>'
        }));
        n.actions.appendChild(el('button', {
          class: 'btn btn--quiet btn--sm', 'data-act': 'remove', text: '×',
          'aria-label': 'Remove from list', title: 'Remove'
        }));
        return;
      }

      if (it.status === 'processing') {
        n.bar.firstChild.style.width = Math.max(6, pct) + '%';
        n.meta.innerHTML = '';
        n.meta.appendChild(el('span', { text: formatBytes(it.file.size) }));
        n.meta.appendChild(el('span', { class: 'sep', text: '·' }));
        n.meta.appendChild(el('span', { text: (it.label || 'Working') + '…' }));
        n.actions.innerHTML = '';
        return;
      }

      n.meta.innerHTML = '';
      n.meta.appendChild(el('span', { text: formatBytes(it.file.size) }));
      n.meta.appendChild(el('span', { class: 'sep', text: '·' }));
      n.meta.appendChild(el('span', { text: 'Queued' }));
      n.actions.innerHTML = '';
    });
  }

  function formatLabel(r) {
    var f = (r.formatKey || 'jpeg').toUpperCase();
    if (f === 'JPEG') f = 'JPG';
    if (r.strategy === 'png8') return 'PNG-8 · ' + r.palette + ' colors';
    if (r.formatKey === 'png') return 'PNG · lossless';
    return f + ' · Q' + Math.round((r.quality || 0) * 100);
  }

  function updateProgress(item) {
    if (!item.node) return;
    var pct = Math.round((item.progress || 0) * 100);
    item.node.bar.firstChild.style.width = Math.max(6, pct) + '%';
    var labelNode = item.node.meta.querySelector('span:last-child');
    if (labelNode) labelNode.textContent = (item.label || 'Working') + '…';
  }

  function updateSummary() {
    var done = state.items.filter(function (i) { return i.status === 'done'; });
    var failed = state.items.filter(function (i) { return i.status === 'error'; });
    var totalIn = 0, totalOut = 0;
    done.forEach(function (i) {
      totalIn += i.file.size;
      totalOut += i.outputBlob.size;
    });

    var summary = $('#resSummary');
    if (summary) {
      var parts = [];
      parts.push(state.items.length + (state.items.length === 1 ? ' image' : ' images'));
      if (done.length) parts.push(done.length + ' optimized');
      if (failed.length) parts.push(failed.length + ' failed');
      summary.textContent = parts.join(' · ');
    }

    var bar = $('#actionBar');
    var pct = totalIn ? savedPct(totalIn, totalOut) : 0;
    if (bar) {
      if (!done.length) {
        bar.hidden = true;
      } else {
        bar.hidden = false;
        $('#actionSaved').textContent = pct > 0 ? '−' + pct + '% smaller' : 'No reduction';
        $('#actionSub').textContent = formatBytes(totalIn) + ' → ' + formatBytes(totalOut) + ' saved ' + formatBytes(Math.max(0, totalIn - totalOut));
      }
    }
    var dl = $('#downloadAll');
    if (dl) dl.disabled = !done.length;
    var cl = $('#clearAll');
    if (cl) cl.disabled = !state.items.length;
  }

  /* ---------------------------------------------------------------------
     Icons
     --------------------------------------------------------------------- */
  var ICONS = {
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>',
    compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 3v18"/><path d="m8 10-2 2 2 2"/><path d="m16 10 2 2-2 2"/></svg>',
    zip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v14H4z"/><path d="M9 6V4h6v2"/><path d="M10 10h4M10 14h4"/></svg>'
  };
  function icon(name) { return ICONS[name] || ''; }

  /* ---------------------------------------------------------------------
     Saving on phones

     A ZIP is the right answer on a desktop and the wrong answer on a phone:
     iOS drops it in the Files app where nobody looks, and the user has to
     unzip it before the images exist at all. Phones get the system share
     sheet instead — on iOS that sheet contains "Save to Photos", which puts
     the results exactly where the user goes looking.
     --------------------------------------------------------------------- */
  var saveCap = { mobile: false, ios: false, share: false, shareFiles: false };

  function detectSaveCap() {
    var ua = navigator.userAgent || '';
    var touch = navigator.maxTouchPoints || 0;
    saveCap.ios = /iP(hone|ad|od)/i.test(ua) || (/Macintosh/.test(ua) && touch > 1);
    saveCap.android = /Android/i.test(ua);
    saveCap.mobile = saveCap.ios || saveCap.android ||
      (touch > 0 && Math.min(window.screen.width, window.screen.height) <= 500);
    saveCap.share = typeof navigator.share === 'function';
    if (saveCap.share && typeof navigator.canShare === 'function') {
      try {
        saveCap.shareFiles = !!navigator.canShare({
          files: [new File([new Uint8Array([0])], 'probe.jpg', { type: 'image/jpeg' })]
        });
      } catch (e) { saveCap.shareFiles = false; }
    }
    return saveCap;
  }

  function saveStrategy() {
    if (!saveCap.mobile) return 'zip';
    return saveCap.shareFiles ? 'share' : 'download';
  }

  /* iOS has no usable ZIP story: Safari drops the archive in Files, Files
     cannot unpack it, and the images never reach Photos. So on iOS the ZIP
     path is removed entirely rather than merely deprioritised. */
  function zipAllowed() {
    return !saveCap.ios;
  }

  function saveModeLabel(mode) {
    if (mode === 'share') return saveCap.ios ? 'Save to Photos' : 'Save images';
    if (mode === 'download') return saveCap.ios ? 'How to save' : 'Save all images';
    return 'Download all (.zip)';
  }

  function saveHintText(mode, webpish) {
    if (mode === 'share') {
      var text = saveCap.ios
        ? 'Choose "Save to Photos" in the share sheet — the images go to your Photos app.'
        : 'Choose Photos / Gallery in the share sheet, or save to Files.';
      if (saveCap.ios && webpish) text += ' WebP is converted to JPEG, so Photos can import it.';
      return text;
    }
    /* 'download' — no share sheet available. On iOS that means long-press. */
    return saveCap.ios
      ? 'This browser cannot hand images to Photos in one go — long-press each result and choose "Save to Photos".'
      : 'Images are saved to the Files app → Downloads.';
  }

  /* iOS Photos does not reliably import WebP or AVIF — the "Save" action can
     be missing entirely. Prepare a JPEG twin in the background while the user
     is still looking at the results, so the tap can share it synchronously. */
  function needsPhotoTwin(item) {
    return !!saveCap.ios && /webp|avif/i.test((item.outputBlob && item.outputBlob.type) || '');
  }

  function toJpegBlob(blob, quality) {
    if (typeof createImageBitmap !== 'function') return Promise.resolve(null);
    return createImageBitmap(blob).then(function (bmp) {
      var c;
      if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(bmp.width, bmp.height);
      else { c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; }
      var cx = c.getContext('2d');
      if (!cx) return null;
      cx.drawImage(bmp, 0, 0);
      if (typeof c.convertToBlob === 'function') {
        return c.convertToBlob({ type: 'image/jpeg', quality: quality || 0.92 });
      }
      return new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', quality || 0.92); });
    }).catch(function () { return null; });
  }

  function preparePhotoTwin(item) {
    if (!needsPhotoTwin(item) || item.photoBlob || item.photoPending) return;
    item.photoPending = true;
    toJpegBlob(item.outputBlob, 0.92).then(function (jpg) {
      item.photoPending = false;
      if (!jpg) return;
      item.photoBlob = jpg;
      item.photoName = baseName(item.outputName) + '.jpg';
      var hint = $('#saveHint');
      if (hint && !hint.hidden) syncSaveButtons();
    }).catch(function () { item.photoPending = false; });
  }

  function itemToFile(item, forPhotos) {
    var useTwin = forPhotos && item.photoBlob;
    var blob = useTwin ? item.photoBlob : item.outputBlob;
    var name = useTwin ? (item.photoName || item.outputName) : item.outputName;
    if (!name) name = 'image.' + (/png/.test(blob.type || '') ? 'png' : 'jpg');
    try { return new File([blob], name, { type: blob.type || 'image/jpeg' }); }
    catch (e) { return null; }
  }

  /* Keep this synchronous up to the navigator.share() call: the browser only
     honours share() while the user gesture is still active. */
  function saveItems(items) {
    if (!items.length) return;
    if (saveCap.shareFiles) {
      var files = items.map(function (it) { return itemToFile(it, true); }).filter(Boolean);
      var ok = false;
      try { ok = files.length > 0 && navigator.canShare({ files: files }); } catch (e) { ok = false; }
      if (ok) {
        try {
          navigator.share({
            files: files,
            title: 'LocalPhotoTool',
            text: files.length + ' compressed image' + (files.length === 1 ? '' : 's')
          }).then(function () {
            toast('Saved — look in your Photos app.');
          }).catch(function (err) {
            if (!err || err.name !== 'AbortError') fallbackSave(items);
          });
          return;
        } catch (e) { /* fall through */ }
      }
    }
    fallbackSave(items);
  }

  /* ---------------------------------------------------------------------
     Save coach

     Most people have never shared several files at once, so before the
     first couple of shares we lay out exactly what is about to happen.
     The confirm tap counts as a user gesture, which is what share() needs.
     --------------------------------------------------------------------- */
  var GUIDE_KEY = 'lpt:saveGuideSeen';
  var guide = { items: [], mode: 'share' };

  function guideSeen() {
    try { return parseInt(localStorage.getItem(GUIDE_KEY) || '0', 10) || 0; }
    catch (e) { return 0; }
  }

  function markGuideSeen() {
    try { localStorage.setItem(GUIDE_KEY, String(guideSeen() + 1)); } catch (e) {}
  }

  function openSaveGuide(items, mode) {
    var modal = $('#saveGuide');
    if (!modal) { saveItems(items); return; }
    guide.items = items;
    guide.mode = mode;

    var n = items.length;
    var body = $('#saveGuideBody');
    body.innerHTML = '';
    $('#saveGuideTitle').textContent = mode === 'share'
      ? 'Saving ' + n + ' image' + (n === 1 ? '' : 's')
      : 'Saving your images';

    if (mode === 'share') {
      var steps = el('ol', { class: 'save-guide__steps' });
      steps.appendChild(el('li', { html: 'Tap <strong>Open share menu</strong> below.' }));
      steps.appendChild(el('li', { html: 'In the menu that slides up, scroll down and tap <strong>Save to Photos</strong>.' }));
      steps.appendChild(el('li', { html: 'Done — the image' + (n === 1 ? '' : 's') + ' land straight in your <strong>Photos</strong> app.' }));
      body.appendChild(steps);
      body.appendChild(el('p', {
        class: 'save-guide__note',
        text: 'Can\'t find Save to Photos? Tap Edit Actions… at the bottom of the list and switch it on — you only have to do that once.'
      }));
      var converted = items.some(function (i) { return !!i.photoBlob; });
      if (converted) {
        body.appendChild(el('p', {
          class: 'save-guide__note',
          text: 'WebP is converted to JPEG along the way, because Photos refuses to import WebP. Downloads stay WebP.'
        }));
      }
      $('#saveGuideGo').hidden = false;
      $('#saveGuideCancel').textContent = 'Cancel';
    } else {
      var list = el('ol', { class: 'save-guide__steps' });
      list.appendChild(el('li', { html: 'Press and hold a result image.' }));
      list.appendChild(el('li', { html: 'Tap <strong>Save to Photos</strong> (or Save Image).' }));
      body.appendChild(list);
      body.appendChild(el('p', {
        class: 'save-guide__note',
        text: 'This browser cannot hand several images to Photos in one go, so repeat once per image. We never send you a .zip here — your phone could not open it.'
      }));
      $('#saveGuideGo').hidden = true;
      $('#saveGuideCancel').textContent = 'Got it';
    }

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSaveGuide() {
    var modal = $('#saveGuide');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    guide.items = [];
  }

  function initSaveGuide() {
    var go = $('#saveGuideGo');
    var cancel = $('#saveGuideCancel');
    var close = $('#saveGuideClose');
    var modal = $('#saveGuide');
    if (!modal) return;

    if (go) go.addEventListener('click', function () {
      var items = guide.items;
      closeSaveGuide();
      if (items.length) shareBatch(items);
    });
    if (cancel) cancel.addEventListener('click', closeSaveGuide);
    if (close) close.addEventListener('click', closeSaveGuide);
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal) closeSaveGuide();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !modal.hidden) closeSaveGuide();
    });
  }

  /* Called by every "save several" button. */
  function requestSave(items) {
    if (!items.length) return;
    if (saveCap.shareFiles && guideSeen() < 2 && items.length > 1) {
      openSaveGuide(items, 'share');
      return;
    }
    saveItems(items);
  }

  /* Skip the plumbing above — used after the guide has been confirmed. */
  function shareBatch(items) {
    var files = items.map(function (it) { return itemToFile(it, true); }).filter(Boolean);
    var ok = false;
    try { ok = files.length > 0 && navigator.canShare({ files: files }); } catch (e) { ok = false; }
    if (ok) {
      markGuideSeen();
      try {
        navigator.share({
          files: files,
          title: 'LocalPhotoTool',
          text: files.length + ' compressed image' + (files.length === 1 ? '' : 's')
        }).then(function () {
          toast('Saved — look in your Photos app.');
        }).catch(function (err) {
          if (!err || err.name !== 'AbortError') fallbackSave(items);
        });
        return;
      } catch (e) { /* fall through */ }
    }
    fallbackSave(items);
  }

  function fallbackSave(items) {
    if (saveCap.ios) {
      if ($('#saveGuide')) openSaveGuide(items, 'press');
      else toast('Long-press a result image, then choose "Save to Photos".');
      return;
    }
    items.forEach(function (item, i) {
      setTimeout(function () { triggerDownload(item.outputBlob, item.outputName); }, i * 400);
    });
    toast('Downloading ' + items.length + ' image' + (items.length === 1 ? '' : 's') + '.');
  }

  function syncSaveButtons() {
    var mode = saveStrategy();
    var label = saveModeLabel(mode);

    [['#downloadAll', '#downloadAllLabel'], ['#barDownload', '#barDownloadLabel']].forEach(function (pair) {
      var btn = $(pair[0]);
      if (!btn) return;
      btn.dataset.act = mode;
      var span = $(pair[1]);
      if (span) span.textContent = label;
    });

    var hint = $('#saveHint');
    if (!hint) return;
    if (mode === 'zip') { hint.hidden = true; hint.innerHTML = ''; return; }

    hint.hidden = false;
    hint.innerHTML = '';
    var webpish = state.items.some(function (i) {
      return i.status === 'done' && /webp|avif/i.test((i.outputBlob && i.outputBlob.type) || '');
    });
    hint.appendChild(el('span', { text: saveHintText(mode, webpish) }));

    /* The ZIP escape hatch is the one way an iPhone could still end up with
       an archive it cannot open, so it is not rendered there. Android and
       desktop file managers unpack ZIPs natively, so it stays for them. */
    if (!zipAllowed()) return;
    hint.appendChild(el('button', {
      class: 'linkish', type: 'button', id: 'zipInstead', text: 'Download .zip instead'
    }));
    var alt = $('#zipInstead');
    if (alt) alt.addEventListener('click', downloadAll);
  }

  /* ---------------------------------------------------------------------
     Downloads
     --------------------------------------------------------------------- */
  var dlQueue = 0;
  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1200);
  }

  function downloadAll() {
    var done = state.items.filter(function (i) { return i.status === 'done'; });
    if (!done.length) return;

    /* Last line of defence: even if some other code path reaches the ZIP
       builder on an iPhone, route it to the share sheet instead. */
    if (!zipAllowed()) { requestSave(done); return; }

    var btn = $('#downloadAll');
    var restore = btn.innerHTML;
    if (btn) { btn.disabled = true; btn.textContent = 'Packing…'; }

    var used = {};
    Promise.all(done.map(function (item) {
      return item.outputBlob.arrayBuffer().then(function (buf) {
        var name = dedupe(item.outputName || 'image.jpg', used);
        used[name] = true;
        return { name: name, data: new Uint8Array(buf) };
      });
    })).then(function (entries) {
      var zip = zipLib.create(entries);
      triggerDownload(zip, 'localphototool-' + stamp() + '.zip');
      toast('Downloaded ' + entries.length + ' optimized image' + (entries.length === 1 ? '' : 's') + '.');
    }).catch(function () {
      toast('Could not build the ZIP archive.');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = restore; }
    });
  }

  function dedupe(name, used) {
    if (!used[name]) return name;
    var dot = name.lastIndexOf('.');
    var stem = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var n = 2;
    var candidate = stem + '-' + n + ext;
    while (used[candidate]) candidate = stem + '-' + (++n) + ext;
    return candidate;
  }

  function stamp() {
    var d = new Date();
    var pad = function (v) { return String(v).padStart(2, '0'); };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  /* ---------------------------------------------------------------------
     Compare modal
     --------------------------------------------------------------------- */
  var compareState = { item: null, split: 50, zoom: 1, panX: 0, panY: 0 };

  function openCompare(item) {
    if (!item.result) return;
    compareState.item = item;
    compareState.split = 50;
    compareState.zoom = 1;
    compareState.panX = 0;
    compareState.panY = 0;

    var modal = $('#compareModal');
    $('#compareTitle').textContent = item.name;
    var badge = $('#compareBadge');
    badge.textContent = item.worse
      ? 'No gain — original kept'
      : '−' + savedPct(item.file.size, item.result.blob.size) + '% · ' + formatBytes(item.file.size) + ' → ' + formatBytes(item.result.blob.size);

    var origUrl = URL.createObjectURL(item.file);
    compareState.origUrl = origUrl;
    $('#compareBase').src = origUrl;
    $('#compareOver').src = item.url;

    $('#compareStats').innerHTML = '';
    var stats = [
      ['Original', formatBytes(item.file.size) + ' · ' + item.result.originalWidth + '×' + item.result.originalHeight],
      ['Compressed', formatBytes(item.worse ? item.file.size : item.result.blob.size) + ' · ' + item.result.width + '×' + item.result.height],
      ['Format', (item.result.formatKey || '').toUpperCase()],
      ['Encoder', encoderLabel(item)],
      ['Took', item.result.duration + ' ms']
    ];
    if (item.result.psnr) stats.push(['Measured PSNR', item.result.psnr.toFixed(1) + ' dB']);
    if (item.result.downscales) stats.push(['Downscale rounds', String(item.result.downscales)]);
    stats.forEach(function (pair) {
      $('#compareStats').appendChild(el('span', { html: pair[0] + ': <b>' + pair[1] + '</b>' }));
    });

    setSplit(50);
    setZoom(1);
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    setTimeout(function () { $('#compareHandle').focus(); }, 40);
  }

  function encoderLabel(item) {
    var e = item.result.encoder || 'native';
    if (e === 'wasm') return 'WASM codec';
    if (e === 'lpt-png8') return 'PNG-8 quantizer';
    return 'Browser codec';
  }

  function closeCompare() {
    var modal = $('#compareModal');
    modal.hidden = true;
    document.body.classList.remove('no-scroll');
    if (compareState.origUrl) URL.revokeObjectURL(compareState.origUrl);
    compareState.origUrl = null;
    compareState.item = null;
  }

  function setSplit(pct) {
    compareState.split = Math.max(0, Math.min(100, pct));
    var cmp = $('#compare');
    if (cmp) {
      cmp.style.setProperty('--split', compareState.split + '%');
      $('#compareHandle').setAttribute('aria-valuenow', Math.round(compareState.split));
    }
  }

  function setZoom(z) {
    compareState.zoom = z;
    var cmp = $('#compare');
    if (!cmp) return;
    cmp.style.setProperty('--zoom', z);
    cmp.style.setProperty('--panx', '0px');
    cmp.style.setProperty('--pany', '0px');
    compareState.panX = 0; compareState.panY = 0;
    cmp.classList.toggle('is-zoomed', z > 1);
    $$('#compareZoom [data-zoom]').forEach(function (b) {
      b.classList.toggle('btn--primary', Number(b.dataset.zoom) === z);
      b.classList.toggle('btn--ghost', Number(b.dataset.zoom) !== z);
    });
  }

  function initCompareGestures() {
    var cmp = $('#compare');
    var handle = $('#compareHandle');
    if (!cmp || !handle) return;
    var dragging = null;

    function ratioFrom(clientX) {
      var rect = cmp.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * 100;
    }

    function onMove(ev) {
      if (!dragging) return;
      var x = ev.touches ? ev.touches[0].clientX : ev.clientX;
      if (dragging === 'split') {
        setSplit(ratioFrom(x));
      } else if (compareState.zoom > 1) {
        var rect = cmp.getBoundingClientRect();
        compareState.panX += (x - dragging.lastX);
        compareState.panY += ((ev.touches ? ev.touches[0].clientY : ev.clientY) - dragging.lastY);
        dragging.lastX = x;
        dragging.lastY = ev.touches ? ev.touches[0].clientY : ev.clientY;
        cmp.style.setProperty('--panx', compareState.panX + 'px');
        cmp.style.setProperty('--pany', compareState.panY + 'px');
      }
      ev.preventDefault();
    }

    function onUp() {
      dragging = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    handle.addEventListener('pointerdown', function (ev) {
      dragging = 'split';
      ev.preventDefault();
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    cmp.addEventListener('pointerdown', function (ev) {
      var rect = cmp.getBoundingClientRect();
      if (compareState.zoom > 1) {
        dragging = { lastX: ev.clientX, lastY: ev.clientY };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      } else {
        setSplit(((ev.clientX - rect.left) / rect.width) * 100);
      }
    });

    handle.addEventListener('keydown', function (ev) {
      var step = ev.shiftKey ? 10 : 2;
      if (ev.key === 'ArrowLeft') { setSplit(compareState.split - step); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { setSplit(compareState.split + step); ev.preventDefault(); }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('#compareModal').hidden) closeCompare();
    });
  }

  /* ---------------------------------------------------------------------
     Wiring
     --------------------------------------------------------------------- */
  function initSettings() {
    var q = $('#quality'), qv = $('#qualityValue');
    var t = $('#targetKB');
    var md = $('#maxDimension');
    var pc = $('#pngColors');
    var dt = $('#dither');

    q.value = Math.round(state.options.quality * 100);
    qv.textContent = q.value + '%';
    t.value = state.options.targetKB;
    md.value = String(state.options.maxDimension);
    pc.value = String(state.options.pngColors);
    dt.checked = !!state.options.dither;

    $$('input[name="mode"]').forEach(function (r) {
      r.checked = r.value === state.options.mode;
    });
    $$('input[name="format"]').forEach(function (r) {
      r.checked = r.value === state.options.format;
    });
    $$('input[name="sharpen"]').forEach(function (r) {
      r.checked = r.value === state.options.sharpen;
    });

    function syncMode() {
      var target = state.options.mode === 'target';
      var quality = state.options.mode === 'quality';
      $('#targetField').classList.toggle('hidden', !target);
      $('#qualityField').classList.toggle('hidden', !quality);
      $('#autoNote').classList.toggle('hidden', state.options.mode !== 'auto');
    }
    syncMode();

    q.addEventListener('input', function () {
      state.options.quality = Number(q.value) / 100;
      qv.textContent = q.value + '%';
      saveOptions(); recompressAll();
    });
    t.addEventListener('input', function () {
      var v = Math.max(5, Math.min(50000, Number(t.value) || 200));
      state.options.targetKB = v;
      saveOptions(); recompressAll();
    });
    t.addEventListener('blur', function () { t.value = state.options.targetKB; });
    md.addEventListener('change', function () {
      state.options.maxDimension = Number(md.value) || 0;
      saveOptions(); recompressAll();
    });
    pc.addEventListener('change', function () {
      state.options.pngColors = pc.value === 'auto' ? 'auto' : (pc.value === 'off' ? 'off' : Number(pc.value));
      saveOptions(); recompressAll();
    });
    dt.addEventListener('change', function () {
      state.options.dither = dt.checked;
      saveOptions(); recompressAll();
    });
    $$('input[name="mode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        state.options.mode = r.value;
        syncMode(); saveOptions(); recompressAll();
      });
    });
    $$('input[name="format"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        state.options.format = r.value;
        /* Picking a format is the earliest honest signal that its codec will be
           needed, so start it now — long before a file arrives. */
        preloadFormats(warmTargets());
        saveOptions(); recompressAll();
      });
    });
    $$('input[name="sharpen"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        state.options.sharpen = r.value;
        saveOptions(); recompressAll();
      });
    });
  }

  function resetItemForRerun(item) {
    // Invalidate anything still in flight for this item.
    item.runToken = (item.runToken || 0) + 1;
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
    item.result = null;
    item.outputBlob = null;
    item.outputName = null;
    item.error = null;
    item.worse = false;
    item.progress = 0;
    item.label = 'Queued';
    item.status = 'queued';
    item.thumbImg = undefined;
    if (item.node) {
      item.node.bar.classList.remove('is-done');
      item.node.bar.firstChild.style.width = '0%';
      item.node.bar.firstChild.style.background = '';
      item.node.note.classList.add('hidden');
      item.node.thumb.innerHTML = '';
      item.node.thumb.appendChild(el('span', { class: 'ph', text: previewTag(item) }));
    }
  }

  function recompressAll() {
    if (!state.items.length) return;
    state.items.forEach(resetItemForRerun);
    renderItemStates();
    markBatchStart();
    pump();
  }

  function removeItem(item) {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.node && item.node.root.parentNode) item.node.root.parentNode.removeChild(item.node.root);
    delete renderedIds[item.id];
    state.items = state.items.filter(function (i) { return i !== item; });
    if (!state.items.length) {
      revealed = false;
      $('#results').hidden = true;
    }
    updateSummary();
  }

  function initResults() {
    var list = $('#resultList');
    list.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      var root = btn.closest('.result');
      if (!root) return;
      var item = state.items.filter(function (i) { return i.id === root.dataset.id; })[0];
      if (!item) return;
      var act = btn.dataset.act;
      if (act === 'download') {
        if (saveStrategy() === 'zip') triggerDownload(item.outputBlob, item.outputName);
        else requestSave([item]);
      }
      else if (act === 'compare') openCompare(item);
      else if (act === 'remove') removeItem(item);
    });
  }

  function initIntake() {
    var dz = $('#dropzone');
    var input = $('#fileInput');
    var pasteHint = $('#pasteHint');

    $('#pickBtn').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      if (input.files && input.files.length) addFiles(input.files);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      dz.addEventListener(type, function (ev) {
        ev.preventDefault();
        dz.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      dz.addEventListener(type, function (ev) {
        ev.preventDefault();
        if (type === 'dragleave' && dz.contains(ev.relatedTarget)) return;
        dz.classList.remove('is-dragover');
      });
    });
    dz.addEventListener('drop', function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        addFiles(ev.dataTransfer.files);
      }
    });
    dz.addEventListener('click', function (ev) {
      if (ev.target.closest('button') || ev.target.closest('a')) return;
      input.click();
    });
    dz.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); }
    });

    // Whole-page drop
    ['dragover', 'drop'].forEach(function (type) {
      window.addEventListener(type, function (ev) {
        if (type === 'dragover') ev.preventDefault();
        if (type === 'drop' && ev.target.closest && !ev.target.closest('#dropzone')) {
          ev.preventDefault();
          if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
            addFiles(ev.dataTransfer.files);
          }
        }
      });
    });

    document.addEventListener('paste', function (ev) {
      var items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        ev.preventDefault();
        addFiles(files);
        toast('Pasted ' + files.length + ' image(s) from clipboard.');
      }
    });

    if (pasteHint) pasteHint.hidden = !(navigator.clipboard || window.ClipboardEvent);
  }

  function initCompareModal() {
    $('#compareClose').addEventListener('click', closeCompare);
    var modal = $('#compareModal');
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal) closeCompare();
    });
    $$('#compareView [data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.dataset.view;
        setSplit(v === 'original' ? 100 : v === 'result' ? 0 : 50);
        $$('#compareView [data-view]').forEach(function (x) {
          x.classList.toggle('btn--primary', x === b);
          x.classList.toggle('btn--ghost', x !== b);
        });
      });
    });
    $$('#compareZoom [data-zoom]').forEach(function (b) {
      b.addEventListener('click', function () { setZoom(Number(b.dataset.zoom)); });
    });
    $('#compareSave').addEventListener('click', function () {
      var item = compareState.item;
      if (!item) return;
      if (saveStrategy() === 'zip') triggerDownload(item.outputBlob, item.outputName);
      else saveItems([item]);
    });
    initCompareGestures();
  }

  function initBulk() {
    ['#downloadAll', '#barDownload'].forEach(function (sel) {
      var btn = $(sel);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (saveStrategy() === 'zip') downloadAll();
        else requestSave(state.items.filter(function (i) { return i.status === 'done'; }));
      });
    });
    $('#clearAll').addEventListener('click', function () {
      if (!state.items.length) return;
      state.items.slice().forEach(removeItem);
      revealedBatch = false;
      toast('List cleared. Your files were never uploaded.');
    });
    $('#barClear').addEventListener('click', function () {
      state.items.slice().forEach(removeItem);
      revealedBatch = false;
    });
  }

  /* ---------------------------------------------------------------------
     Codec warm-up — on intent, not on load

     The WASM encoders are the only slow first step in the whole tool (AOM alone
     is ~1.7 MB), so they were originally fetched the moment the page opened.
     Two things were wrong with that. It billed people who never compressed
     anything, and it competed for bandwidth with the codec the visitor had
     actually asked for — a hand-picked AVIF could miss its patience budget
     behind its own warm-up and come back as WebP, which is the one outcome the
     format control exists to prevent.

     So nothing is fetched until someone reaches for the tool: the first
     tap/click/keypress inside it, a drag over the page, or a paste. By then a
     download has the whole "pick a photo" gesture to finish in, and a visitor
     who only reads the page pays nothing.
     --------------------------------------------------------------------- */
  var warmedOnIntent = false;
  var pendingPrewarm = [];

  /* Only what the current settings can actually output. 'auto' never picks
     AVIF, so warming it there would be dead weight; choosing AVIF by hand is
     precisely when its download needs the head start. */
  function warmTargets() {
    var f = state.options.format || 'auto';
    if (f === 'avif') return ['avif'];
    if (f === 'webp') return ['webp'];
    if (f === 'jpeg') return ['jpeg'];
    if (f === 'original') return ['jpeg', 'webp'];
    return ['webp', 'jpeg'];
  }

  function preloadFormats(formats) {
    if (!formats || !formats.length) return;
    if (state.pool) state.pool.prewarm(formats);
    else if (state.inline) engine.preload(formats);       // main-thread fallback
    else pendingPrewarm = pendingPrewarm.concat(formats); // pool still booting
  }

  /* Intent can beat the pool into existence (tab-and-enter is fast); hold the
     request rather than warm the main thread and then warm it again per worker. */
  function flushPrewarm() {
    if (!pendingPrewarm.length) return;
    var list = pendingPrewarm;
    pendingPrewarm = [];
    preloadFormats(list);
  }

  function warmOnIntent() {
    if (warmedOnIntent) return;
    warmedOnIntent = true;
    preloadFormats(warmTargets());
  }

  function initWarmupOnIntent() {
    /* The drop zone carries the pick button, so it covers "tap to choose" as
       well as "click anywhere in the box". Deliberately not the whole tool
       section: touching a format radio is a different intent, and the format
       handler warms exactly the codec that was picked instead of guessing. */
    var dz = $('#dropzone') || $('#tool');
    if (dz) {
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
        dz.addEventListener(type, warmOnIntent, { capture: true, passive: true });
      });
    }
    ['dragenter', 'dragover'].forEach(function (type) {
      window.addEventListener(type, warmOnIntent, { passive: true });
    });
    document.addEventListener('paste', warmOnIntent);
  }

  /* Why a codec is not on, when the engine actually tried. A bare "unavailable"
     cannot tell a slow CDN from a broken build — for the visitor it is the
     difference between "this browser can't" and "we tried, it did not work", and
     for anyone reading a bug report it is the whole diagnosis. */
  var REASON_TEXT = {
    'fetch-timeout': 'encoder download timed out',
    'warm-timeout': 'encoder was too slow to start',
    'no-export': 'encoder module had nothing usable',
    'import-rejected': 'encoder download failed',
    'probe-threw': 'encoder failed its self-test',
    'probe-empty': 'encoder produced nothing',
    'all-sources-failed': 'no reachable encoder'
  };
  function whyText(reason) {
    return reason ? (REASON_TEXT[reason] || reason) : '';
  }

  function renderEngineStatus() {
    var box = $('#engineStatus');
    if (!box) return;
    var caps = (state.pool && state.pool.caps) || null;
    var formats = (caps && caps.formats) || engine.detectFormats();
    var wasm = (caps && caps.wasm) || {};
    var reasons = (caps && caps.reasons) || {};
    var rows = [];

    rows.push(row(state.inline ? 'dim' : 'on', 'Processing',
      state.inline ? 'Main thread' : 'Background workers ×' + (state.pool ? state.pool.size : 1)));
    rows.push(row(wasm.jpeg ? 'on' : 'dim', 'JPEG', wasm.jpeg ? 'MozJPEG (WASM)' : 'Browser codec'));
    rows.push(row(formats.webp ? (wasm.webp ? 'on' : 'dim') : 'dim', 'WebP',
      wasm.webp ? 'libwebp (WASM)' : (formats.webp ? 'Browser codec' : (whyText(reasons.webp) || 'unsupported'))));
    rows.push(row(wasm.avif ? 'on' : 'dim', 'AVIF',
      wasm.avif ? 'AOM (WASM)' : (formats.avif ? 'Browser codec' : (whyText(reasons.avif) || 'unavailable'))));
    rows.push(row('on', 'PNG', 'LPT PNG-8 quantizer + browser'));

    box.innerHTML = '';
    rows.forEach(function (r) {
      box.appendChild(el('div', null, [
        el('span', { class: 'dot dot--' + r.level }),
        el('span', { text: r.name + ': ' }),
        el('span', { style: 'color:var(--text-2)', text: r.value })
      ]));
    });
  }

  function row(level, name, value) { return { level: level, name: name, value: value }; }

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  function boot() {
    loadOptions();
    detectSaveCap();
    initSettings();
    initIntake();
    initResults();
    initCompareModal();
    initBulk();
    initSaveGuide();
    initChime();
    syncSaveButtons();
    initWarmupOnIntent();

    renderEngineStatus();

    if (workerSupported()) {
      state.pool = new WorkerPool(navigator.hardwareConcurrency && navigator.hardwareConcurrency >= 8 ? 3 : 2);
      state.pool.onCaps = function () { renderEngineStatus(); };
      state.pool.init().then(function () {
        if (state.pool.failed && !state.pool.caps) {
          state.inline = true;
          state.pool = null;
        }
        flushPrewarm();
        renderEngineStatus();
        pump();
      });
    } else {
      state.inline = true;
      flushPrewarm();
      renderEngineStatus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
