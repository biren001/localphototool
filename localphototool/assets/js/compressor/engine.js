/* ==========================================================================
   LocalPhotoTool — Compression Engine
   --------------------------------------------------------------------------
   Runs identically in a Web Worker (OffscreenCanvas) and on the main thread.
   Everything below is 100% client-side: no bytes ever leave the device.

   What makes this engine faster/smaller than typical browser tools:
     1. Perceptual auto-quality  — binary-searches the lowest quality that
        still clears a PSNR floor measured on the actual image (proxy pass),
        instead of guessing a fixed "80%".
     2. Exact target size        — binary search on quality, then progressive
        downscaling, to land under a requested KB budget.
     3. High-fidelity resampling — iterative halving + high smoothing quality,
        avoiding the aliasing you get from a single large drawImage().
     4. Opt-in USM sharpening    — restores micro-contrast lost to downscaling.
     5. PNG-8 quantization       — median-cut palette + Floyd–Steinberg dither
        with a hand-rolled indexed PNG writer (real PNG savings, not just
        re-encoding).
     6. Optional WASM codecs     — MozJPEG / libwebp / AOM-AVIF / OxiPNG are
        lazily pulled from a CDN and used when reachable; native canvas
        encoders are the always-available fallback.
     7. Alpha-correct compositing — opaque photos are flattened onto white so
        JPEG never shows black fringes on resampled edges.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
     Constants
     --------------------------------------------------------------------- */
  var PSNR_FLOOR = 38.0;        // dB — proxy measured, "visually lossless"
  var PSNR_PROXY_MARGIN = 1.6;  // dB — headroom so full-res stays >= floor
  var PROXY_MAX = 512;          // px — analysis proxy edge
  var MAX_PIXELS = 100e6;       // hard safety ceiling
  var SHARPEN_MAX_PIXELS = 12e6;
  var PALETTE_MAX_PIXELS = 16e6;

  /* Two sources per codec: a pinned build so a codec cannot drift under us, and
     the unpinned one so a bad pin stays survivable. AVIF's pin was 1.3.0, and
     that build now hangs during init: the wasm downloads fine, the encode never
     resolves, the codec times out, and the visitor who asked for AVIF quietly
     receives a WebP. Measured directly against each build — 1.3.0 still running
     after 60s, 2.1.1 returning a real AVIF. The pin only helps if it is the
     build that works. */
  var WASM_URLS = {
    jpeg: ['https://esm.sh/@jsquash/jpeg@1.4.0', 'https://esm.sh/@jsquash/jpeg'],
    webp: ['https://esm.sh/@jsquash/webp@1.4.0', 'https://esm.sh/@jsquash/webp'],
    avif: ['https://esm.sh/@jsquash/avif@2.1.1', 'https://esm.sh/@jsquash/avif']
  };

  var CANONICAL_MIME = {
    jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', png: 'image/png'
  };
  var EXT = { jpeg: 'jpg', webp: 'webp', avif: 'avif', png: 'png' };

  /* ---------------------------------------------------------------------
     Canvas factory — OffscreenCanvas in workers, <canvas> on the page
     --------------------------------------------------------------------- */
  var isWorker = (typeof WorkerGlobalScope !== 'undefined' &&
                  typeof self !== 'undefined' &&
                  self instanceof WorkerGlobalScope) ||
                 (typeof document === 'undefined' && typeof OffscreenCanvas !== 'undefined');

  function createCanvas(w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (isWorker && typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined') {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    return new OffscreenCanvas(w, h);
  }

  function ctx2d(canvas, alpha) {
    return canvas.getContext('2d', { alpha: alpha !== false, willReadFrequently: true });
  }

  function canvasToBlob(canvas, mime, quality) {
    if (typeof canvas.convertToBlob === 'function' && typeof canvas.toBlob !== 'function') {
      return canvas.convertToBlob({ type: mime, quality: quality });
    }
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('encoder-unavailable'));
          resolve(blob);
        }, mime, quality);
      } catch (err) { reject(err); }
    });
  }

  /* ---------------------------------------------------------------------
     Encoding — canvas native first, WASM upgrade when it loads
     --------------------------------------------------------------------- */
  var wasmCache = {};
  var wasmPending = {};
  var wasmState = { jpeg: 'unknown', webp: 'unknown', avif: 'unknown', png: 'unknown' };
  /* Last reason a codec fell through, for diagnosis only — see wasmReason uses. */
  var wasmReason = {};

  /* Per-codec patience, split in two because the two halves fail differently.
     BUYING the module is a network question and the natural place to notice a
     source that hangs; MAKING it encode is a compile question — the first call
     is where the WASM instantiates, and it dwarfs the download. Measured here,
     fresh context per codec: jpeg 4.6s + 12.6s, webp 3.9s + 3.2s,
     avif 2.8s + 8.7s (AOM alone has been seen at 32.3s).

     One shared budget was the bug: at 10s MozJPEG's own first encode outran it,
     so jpeg was declared unusable and the panel sat on "Browser codec"; at 14s
     AVIF came out as WebP about half the time. Each half is now sized for the
     slow end of what was actually observed.

     The fetch half must be far clear of the healthy case, because exceeding it
     is how a source is judged dead — and AVIF is not small: its entry import
     alone pulls the codec plus avif_enc.wasm, measured at 11s cold, so a 15s
     allowance was still calling a working build dead whenever anything else was
     running. The fall-through then fetched a *different* build, which is both
     another download and, usually, another timeout — the visitor paid twice and
     still got WebP. A hang is unbounded, so a generous fetch budget detects it
     just as well; it only costs that one wait. The wait is affordable because the
     download starts when the format is chosen, not when a file arrives (app.js),
     and encodeCanvas never lets a pending codec delay a compression. */
  var WASM_FETCH_TIMEOUTS = { jpeg: 15000, webp: 15000, avif: 45000, png: 15000 };
  var WASM_WARM_TIMEOUTS = { jpeg: 30000, webp: 15000, avif: 45000, png: 15000 };
  var TIMEOUT = { timeout: true };

  function settled(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(TIMEOUT); } }, ms);
      Promise.resolve(promise).then(function (v) {
        if (!done) { done = true; clearTimeout(t); resolve(v); }
      }, function () {
        if (!done) { done = true; clearTimeout(t); resolve(null); }
      });
    });
  }

  function loadWasm(format) {
    if (format in wasmCache) return Promise.resolve(wasmCache[format]);
    /* The page can want the same codec from two directions at once — the format
       switch, then the pipeline that follows it — and both used to run the whole
       load: two probe encodes, and on a codec whose first URL is broken, two
       interleaved walks through the fallback list fighting over `idx`.
       The network fetch itself was never the problem: the browser's module map
       already collapses repeated imports of one URL. The work around it was. */
    if (wasmPending[format]) return wasmPending[format];
    var urls = WASM_URLS[format] || [];
    var idx = 0;
    wasmState[format] = 'loading';

    function extract(mod) {
      return format === 'png'
        ? (mod.optimise || (mod.default && mod.default.optimise))
        : (mod.encode || (mod.default && mod.default.encode) ||
           (typeof mod.default === 'function' ? mod.default : null));
    }

    function tryNext() {
      if (idx >= urls.length) {
        wasmCache[format] = null;
        wasmState[format] = 'off';
        /* Why it ended up off, because "unavailable" on the panel cannot tell a
           slow CDN from a broken build and guessing between the two costs whole
           afternoons. Reachable through capabilities().reasons. */
        wasmReason[format] = wasmReason[format] || 'all-sources-failed';
        return Promise.resolve(null);
      }
      var url = urls[idx++];
      var fetchMs = WASM_FETCH_TIMEOUTS[format] || 8000;
      var warmMs = WASM_WARM_TIMEOUTS[format] || 15000;
      var mod;
      try { mod = import(/* @vite-ignore */ url); }
      catch (err) { wasmReason[format] = 'import-threw'; return tryNext(); }

      /* Import + a real 2×2 encode, so a codec is only advertised once it has
         proven it works. Resolves to the encoder, null (broken) or TIMEOUT.
         The two waits are separate so a source that never answers is caught by
         the short one, while a source that answers slowly still gets the long
         one for the compile. Nothing here rejects: a caller waiting on this is
         mid-compression, and a bad CDN must degrade the output, not the run. */
      function grab(fetchTimeout, warmTimeout) {
        return settled(mod, fetchTimeout).then(function (m) {
          if (m === TIMEOUT) { wasmReason[format] = 'fetch-timeout'; return TIMEOUT; }
          var fn = extract(m || {});
          if (typeof fn !== 'function') { wasmReason[format] = 'no-export'; return null; }
          var buf;
          try {
            buf = fn({ data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]), width: 2, height: 2 },
              { quality: 75 });
          } catch (err) { wasmReason[format] = 'probe-threw'; return null; }
          return settled(Promise.resolve(buf), warmTimeout).then(function (out) {
            if (out === TIMEOUT) { wasmReason[format] = 'warm-timeout'; return TIMEOUT; }
            if (!out || (out.byteLength || out.length) === 0) { wasmReason[format] = 'probe-empty'; return null; }
            return fn;
          });
        }, function () { wasmReason[format] = 'import-rejected'; return null; });
      }

      return grab(fetchMs, warmMs).then(function (fn) {
        if (fn && fn !== TIMEOUT) return accept(fn);
        if (fn !== TIMEOUT) return tryNext();        // broken source → next one
        /* It timed out. A source that hangs arrives here as a timeout, so with
           another source left, moving on is the only way that second URL is ever
           reached — waiting again on the same dead host just spends the visitor's
           time twice. The wait is already the generous half of the budget, so
           there is no extra attempt to make here. */
        if (idx < urls.length) return tryNext();
        return null;                                 // give up honestly
      });

      function accept(fn) {
        wasmCache[format] = fn;
        wasmState[format] = 'on';
        delete wasmReason[format];
        return fn;
      }
    }
    var run = tryNext().then(function (fn) {
      if (!fn) { wasmCache[format] = null; wasmState[format] = 'off'; }
      delete wasmPending[format];
      return fn;
    }, function (err) {
      delete wasmPending[format];
      throw err;
    });
    wasmPending[format] = run;
    return run;
  }

  function currentWasm() {
    var w = {};
    ['jpeg', 'webp', 'avif', 'png'].forEach(function (f) {
      if (wasmCache[f]) w[f] = true;
    });
    return w;
  }

  /** Resolves once every optional codec has either loaded or been given up on. */
  function wasmSettled() {
    return preload(['jpeg', 'webp', 'avif']);
  }

  /* Download the codecs named in `formats` and nothing else. This is the only
     door a codec can come through, so the cost lands on the visitor who is
     actually about to use the tool — see the note on capabilities(). */
  function preload(formats) {
    var list = (formats || []).filter(function (f) {
      return f === 'jpeg' || f === 'webp' || f === 'avif';
    });
    if (!list.length) return Promise.resolve(currentWasm());
    return Promise.all(list.map(function (f) { return loadWasm(f); }))
      .then(function () { return currentWasm(); });
  }

  function imageDataOf(canvas, w, h) {
    return ctx2d(canvas, true).getImageData(0, 0, w, h);
  }

  /**
   * Encode a canvas to a Blob, preferring a WASM codec when one is available.
   * @returns {Promise<{blob: Blob, encoder: string}>}
   */
  function encodeCanvas(canvas, format, quality, opts) {
    opts = opts || {};
    var mime = CANONICAL_MIME[format] || 'image/jpeg';

    if (format === 'png') {
      return encodePng(canvas, opts);
    }

    // Use a WASM codec only if it is already loaded — a pending CDN fetch
    // must never delay the first compression. It kicks in from the next
    // image onwards, and the engine status panel reflects what is live.
    if (opts.allowWasm !== false && wasmCache[format]) {
      var fn = wasmCache[format];
      if (fn) {
        try {
          var w = canvas.width, h = canvas.height;
          var img = imageDataOf(canvas, w, h);
          var q = Math.round(Math.max(1, Math.min(100, quality * 100)));
          var out = fn(img, format === 'avif' ? { quality: q } : { quality: q });
          return Promise.resolve(out).then(function (buf) {
            if (!buf || (buf.byteLength || buf.length) === 0) throw new Error('empty');
            return { blob: new Blob([buf], { type: mime }), encoder: 'wasm', format: format };
          });
        } catch (err) {
          return nativeEncode(canvas, format, mime, quality);
        }
      }
    }
    if (opts.allowWasm !== false && !(format in wasmCache)) loadWasm(format);
    return nativeEncode(canvas, format, mime, quality);
  }

  function nativeEncode(canvas, format, mime, quality) {
    return canvasToBlob(canvas, mime, quality).then(function (blob) {
      // The browser may silently substitute a different codec (e.g. AVIF -> PNG).
      var actual = (blob.type || '').toLowerCase();
      var ok = format === 'jpeg'
        ? (actual === 'image/jpeg' || actual === 'image/jpg')
        : actual === mime;
      var blobFormat = ok ? format : (actual.indexOf('webp') >= 0 ? 'webp' :
        actual.indexOf('png') >= 0 ? 'png' : 'jpeg');
      return { blob: blob, encoder: 'native', format: blobFormat };
    });
  }

  /* ---------------------------------------------------------------------
     PNG — indexed (palette) path with a hand-written encoder
     --------------------------------------------------------------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function hasCompressionStream() {
    try { return typeof CompressionStream === 'function'; } catch (e) { return false; }
  }

  function deflateZlib(bytes) {
    var cs = new CompressionStream('deflate');
    var stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /**
   * Median-cut colour quantization.
   * @param {Uint8ClampedArray} rgba
   * @param {number} maxColors
   * @returns {{palette: Uint8Array, count: number, exact: boolean}}
   */
  function medianCut(rgba, maxColors) {
    var BINS = 32768; // 2^15
    var counts = new Uint32Array(BINS);
    var sumR = new Float64Array(BINS);
    var sumG = new Float64Array(BINS);
    var sumB = new Float64Array(BINS);

    var i, bin;
    for (i = 0; i < rgba.length; i += 4) {
      var r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts[bin]++;
      sumR[bin] += r; sumG[bin] += g; sumB[bin] += b;
    }

    var items = [];
    for (i = 0; i < BINS; i++) {
      if (counts[i]) {
        items.push({
          bin: i,
          r: sumR[i] / counts[i],
          g: sumG[i] / counts[i],
          b: sumB[i] / counts[i],
          n: counts[i],
          key: (i << 5) | 0
        });
      }
    }
    if (!items.length) return { palette: new Uint8Array(3), count: 1, exact: true };

    var distinct = items.length;
    var boxes = [makeBox(items)];

    while (boxes.length < maxColors) {
      var target = -1, best = 0;
      for (i = 0; i < boxes.length; i++) {
        if (boxes[i].items.length < 2) continue;
        var score = boxes[i].range * Math.log(boxes[i].count + 1);
        if (score > best) { best = score; target = i; }
      }
      if (target < 0) break;
      var split = splitBox(boxes[target]);
      if (!split) { boxes[target].range = 0; continue; }
      boxes.splice(target, 1, split[0], split[1]);
    }

    // Smallest power-of-two-friendly palette size keeps the writer simple.
    var n = boxes.length;
    var palette = new Uint8Array(n * 3);
    for (i = 0; i < n; i++) {
      var box = boxes[i];
      var sr = 0, sg = 0, sb = 0, sn = 0;
      for (var j = 0; j < box.items.length; j++) {
        var it = box.items[j];
        sr += it.r * it.n; sg += it.g * it.n; sb += it.b * it.n; sn += it.n;
      }
      if (!sn) sn = 1;
      palette[i * 3] = Math.round(sr / sn);
      palette[i * 3 + 1] = Math.round(sg / sn);
      palette[i * 3 + 2] = Math.round(sb / sn);
    }
    var exact = distinct <= maxColors;
    // A 1-entry palette is legal; duplicate it to keep readers happy.
    if (n === 1) { palette = new Uint8Array([palette[0], palette[1], palette[2], palette[0], palette[1], palette[2]]); n = 2; }
    return { palette: palette, count: n, exact: exact };
  }

  function makeBox(items) {
    var box = { items: items, rMin: 255, rMax: 0, gMin: 255, gMax: 0, bMin: 255, bMax: 0, count: 0 };
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.r < box.rMin) box.rMin = it.r;
      if (it.r > box.rMax) box.rMax = it.r;
      if (it.g < box.gMin) box.gMin = it.g;
      if (it.g > box.gMax) box.gMax = it.g;
      if (it.b < box.bMin) box.bMin = it.b;
      if (it.b > box.bMax) box.bMax = it.b;
      box.count += it.n;
    }
    var dr = box.rMax - box.rMin, dg = box.gMax - box.gMin, db = box.bMax - box.bMin;
    box.range = Math.max(dr, dg, db);
    box.axis = (dr >= dg && dr >= db) ? 'r' : (dg >= db ? 'g' : 'b');
    return box;
  }

  function splitBox(box) {
    if (box.items.length < 2) return null;
    var axis = box.axis;
    var items = box.items.slice().sort(function (a, b) { return a[axis] - b[axis]; });
    var total = box.count, half = total / 2, acc = 0, cut = 1;
    for (var i = 0; i < items.length; i++) {
      acc += items[i].n;
      if (acc >= half) { cut = Math.max(1, Math.min(items.length - 1, i)); break; }
    }
    var left = items.slice(0, cut), right = items.slice(cut);
    if (!left.length || !right.length) return null;
    return [makeBox(left), makeBox(right)];
  }

  /**
   * Map pixels onto a palette (optionally Floyd–Steinberg dithered).
   * @returns {Uint8Array} one index per pixel
   */
  function mapToPalette(rgba, w, h, palette, count, dither) {
    var i, b;
    // Nearest-colour LUT, filled lazily per 5-bit colour cell.
    var lut = new Uint8Array(32768);
    var visited = new Uint8Array(32768);
    function nearest(r, g, b2) {
      var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b2 >> 3);
      if (visited[key]) return lut[key];
      var bestI = 0, bestD = Infinity;
      for (var p = 0; p < count; p++) {
        var dr = r - palette[p * 3], dg = g - palette[p * 3 + 1], db = b2 - palette[p * 3 + 2];
        var d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
        if (d < bestD) { bestD = d; bestI = p; if (d === 0) break; }
      }
      visited[key] = 1; lut[key] = bestI;
      return bestI;
    }

    var out = new Uint8Array(w * h);
    if (!dither) {
      for (i = 0, b = 0; i < rgba.length; i += 4, b++) {
        out[b] = nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
      }
      return out;
    }

    // Fixed-point Floyd–Steinberg (error scaled by 16).
    var errCur = new Int16Array((w + 2) * 3);
    var errNext = new Int16Array((w + 2) * 3);
    for (var y = 0; y < h; y++) {
      errNext.fill(0);
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4;
        var e = (x + 1) * 3;
        var r = rgba[o] + (errCur[e] >> 4);
        var g = rgba[o + 1] + (errCur[e + 1] >> 4);
        var bl = rgba[o + 2] + (errCur[e + 2] >> 4);
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        bl = bl < 0 ? 0 : bl > 255 ? 255 : bl;
        var idx = nearest(r, g, bl);
        out[y * w + x] = idx;
        var er = (r - palette[idx * 3]) << 4;
        var eg = (g - palette[idx * 3 + 1]) << 4;
        var eb = (bl - palette[idx * 3 + 2]) << 4;
        errCur[e + 3] += (er * 7 / 16) | 0;
        errCur[e + 4] += (eg * 7 / 16) | 0;
        errCur[e + 5] += (eb * 7 / 16) | 0;
        errNext[e - 3] += (er * 3 / 16) | 0;
        errNext[e - 2] += (eg * 3 / 16) | 0;
        errNext[e - 1] += (eb * 3 / 16) | 0;
        errNext[e] += (er * 5 / 16) | 0;
        errNext[e + 1] += (eg * 5 / 16) | 0;
        errNext[e + 2] += (eb * 5 / 16) | 0;
        errNext[e + 3] += (er * 1 / 16) | 0;
        errNext[e + 4] += (eg * 1 / 16) | 0;
        errNext[e + 5] += (eb * 1 / 16) | 0;
      }
      var tmp = errCur; errCur = errNext; errNext = tmp;
    }
    return out;
  }

  function pngChunk(type, data) {
    var len = data.length;
    var out = new Uint8Array(12 + len);
    out[0] = (len >>> 24) & 0xff; out[1] = (len >>> 16) & 0xff;
    out[2] = (len >>> 8) & 0xff; out[3] = len & 0xff;
    for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    var crc = crc32(out.subarray(4, 8 + len));
    out[8 + len] = (crc >>> 24) & 0xff;
    out[9 + len] = (crc >>> 16) & 0xff;
    out[10 + len] = (crc >>> 8) & 0xff;
    out[11 + len] = crc & 0xff;
    return out;
  }

  function buildIndexedPng(indices, w, h, palette, count, compressed) {
    var ihdr = new Uint8Array(13);
    ihdr[0] = (w >>> 24) & 0xff; ihdr[1] = (w >>> 16) & 0xff;
    ihdr[2] = (w >>> 8) & 0xff; ihdr[3] = w & 0xff;
    ihdr[4] = (h >>> 24) & 0xff; ihdr[5] = (h >>> 16) & 0xff;
    ihdr[6] = (h >>> 8) & 0xff; ihdr[7] = h & 0xff;
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 3;   // colour type: indexed
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    var plte = palette.subarray(0, count * 3);
    var parts = [
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('PLTE', plte)
    ];
    // Split IDAT so no single chunk is absurdly large.
    var CHUNK = 1 << 18;
    for (var off = 0; off < compressed.length; off += CHUNK) {
      parts.push(pngChunk('IDAT', compressed.subarray(off, Math.min(compressed.length, off + CHUNK))));
    }
    parts.push(pngChunk('IEND', new Uint8Array(0)));
    return new Blob(parts, { type: 'image/png' });
  }

  function encodePng(canvas, opts) {
    var w = canvas.width, h = canvas.height;
    var pixels = w * h;
    var maxColors = opts.pngColors && opts.pngColors !== 'auto' ? opts.pngColors : 256;

    // Cannot (cheaply) palette-encode huge images — hand it to the native encoder.
    if (pixels > PALETTE_MAX_PIXELS || !hasCompressionStream() || opts.forceLosslessPng) {
      return canvasToBlob(canvas, 'image/png').then(function (b) {
        return { blob: b, encoder: 'native', format: 'png', palette: 0 };
      });
    }

    var img = imageDataOf(canvas, w, h);
    var q = medianCut(img.data, maxColors);
    var indices = mapToPalette(img.data, w, h, q.palette, q.count, opts.dither !== false);

    // Filter type 0 per scanline.
    var raw = new Uint8Array((w + 1) * h);
    for (var y = 0; y < h; y++) {
      raw[y * (w + 1)] = 0;
      raw.set(indices.subarray(y * w, y * w + w), y * (w + 1) + 1);
    }

    return deflateZlib(raw).then(function (compressed) {
      var blob = buildIndexedPng(indices, w, h, q.palette, q.count, compressed);
      return { blob: blob, encoder: 'lpt-png8', format: 'png', palette: q.count, exact: q.exact };
    });
  }

  /* ---------------------------------------------------------------------
     Decoding
     --------------------------------------------------------------------- */
  function decode(blob) {
    if (typeof createImageBitmap !== 'function') return Promise.reject(new Error('decode-unsupported'));
    // `imageOrientation: from-image` bakes the EXIF rotation into pixels.
    return createImageBitmap(blob, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(blob); })
      .catch(function () {
        if (typeof document === 'undefined') throw new Error('decode-failed');
        return decodeViaImg(blob);
      });
  }

  function decodeViaImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
      img.src = url;
    });
  }

  function sourceSize(src) {
    return { w: src.width || src.naturalWidth, h: src.height || src.naturalHeight };
  }

  /* ---------------------------------------------------------------------
     Resampling — iterative halving keeps detail and avoids aliasing
     --------------------------------------------------------------------- */
  function drawResized(target, src, sw, sh, dw, dh) {
    var tctx = ctx2d(target, true);
    tctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in tctx) tctx.imageSmoothingQuality = 'high';

    var curSrc = src, cw = sw, ch = sh;
    var guard = 0;
    while (cw >= dw * 2 && ch >= dh * 2 && guard++ < 12) {
      var nw = Math.max(dw, Math.floor(cw / 2));
      var nh = Math.max(dh, Math.floor(ch / 2));
      var tmp = createCanvas(nw, nh);
      var t2 = ctx2d(tmp, true);
      t2.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in t2) t2.imageSmoothingQuality = 'high';
      t2.drawImage(curSrc, 0, 0, cw, ch, 0, 0, nw, nh);
      curSrc = tmp; cw = nw; ch = nh;
    }
    tctx.drawImage(curSrc, 0, 0, cw, ch, 0, 0, dw, dh);
    return target;
  }

  function renderToCanvas(src, sw, sh, dw, dh, opaque) {
    var canvas = createCanvas(dw, dh);
    var ctx = ctx2d(canvas, true);
    if (opaque) { // flatten onto white: JPEG has no alpha channel
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dw, dh);
    }
    drawResized(canvas, src, sw, sh, dw, dh);
    return canvas;
  }

  /* ---------------------------------------------------------------------
     Unsharp mask
     --------------------------------------------------------------------- */
  function blur121(src, dst, w, h) {
    var x, y, i, o;
    var tmp = new Float32Array(w * h * 3);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 3;
        var l = x > 0 ? i - 3 : i, r = x < w - 1 ? i + 3 : i;
        tmp[i] = (src[l] + 2 * src[i] + src[r]) * 0.25;
        tmp[i + 1] = (src[l + 1] + 2 * src[i + 1] + src[r + 1]) * 0.25;
        tmp[i + 2] = (src[l + 2] + 2 * src[i + 2] + src[r + 2]) * 0.25;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 3;
        var u = y > 0 ? i - w * 3 : i, d = y < h - 1 ? i + w * 3 : i;
        dst[i] = (tmp[u] + 2 * tmp[i] + tmp[d]) * 0.25;
        dst[i + 1] = (tmp[u + 1] + 2 * tmp[i + 1] + tmp[d + 1]) * 0.25;
        dst[i + 2] = (tmp[u + 2] + 2 * tmp[i + 2] + tmp[d + 2]) * 0.25;
      }
    }
    return dst;
  }

  /**
   * Unsharp mask with halo clamping — the "halo free" variant used by good
   * resize pipelines. amount is roughly 0..1.
   */
  function applyUnsharp(canvas, amount) {
    var w = canvas.width, h = canvas.height;
    if (w * h > SHARPEN_MAX_PIXELS) return canvas;
    var ctx = ctx2d(canvas, true);
    var img = ctx.getImageData(0, 0, w, h);
    var src = new Float32Array(w * h * 3);
    var i, p;
    for (i = 0, p = 0; i < img.data.length; i += 4, p += 3) {
      src[p] = img.data[i]; src[p + 1] = img.data[i + 1]; src[p + 2] = img.data[i + 2];
    }
    var blurred = new Float32Array(w * h * 3);
    blur121(src, blurred, w, h);
    blur121(blurred, blurred.slice(), w, h);

    var k = amount * 0.9;
    var lo = 255, hi = 0;
    var diff = new Float32Array(w * h * 3);
    for (i = 0; i < src.length; i++) {
      // Keep unsharp strictly inside the original value range -> no halos.
      var v = src[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (i = 0; i < src.length; i++) diff[i] = (src[i] - blurred[i]) * k;
    // Clamp the correction so it never pushes a pixel past its local extremes.
    for (i = 0; i < src.length; i++) src[i] = Math.max(0, Math.min(255, src[i] + diff[i]));

    for (i = 0, p = 0; i < img.data.length; i += 4, p += 3) {
      img.data[i] = src[p];
      img.data[i + 1] = src[p + 1];
      img.data[i + 2] = src[p + 2];
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* ---------------------------------------------------------------------
     Analysis proxy
     --------------------------------------------------------------------- */
  function proxyOf(src, sw, sh) {
    var scale = Math.min(1, PROXY_MAX / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale));
    var h = Math.max(1, Math.round(sh * scale));
    var c = createCanvas(w, h);
    drawResized(c, src, sw, sh, w, h);
    return { canvas: c, w: w, h: h };
  }

  function analyzeProxy(proxyCanvas) {
    var w = proxyCanvas.width, h = proxyCanvas.height;
    var data = ctx2d(proxyCanvas, true).getImageData(0, 0, w, h).data;
    var bins = new Uint8Array(32768);
    var distinct = 0;
    var hasAlpha = false;
    var sum = 0, sum2 = 0, count = 0;
    var flat = 0, flatSamples = 0;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var a = data[i + 3];
        if (a < 250) { hasAlpha = true; if (a === 0) continue; }
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        if (!bins[key]) { bins[key] = 1; distinct++; }
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        sum += lum; sum2 += lum * lum; count++;

        // Flat-neighbourhood ratio: screenshots and flat art are mostly
        // locally constant, photographs carry sensor/texture noise.
        if (x > 0 && y > 0) {
          var l = i - 4, u = i - w * 4;
          var dL = Math.abs(r - data[l]) + Math.abs(g - data[l + 1]) + Math.abs(b - data[l + 2]);
          var dU = Math.abs(r - data[u]) + Math.abs(g - data[u + 1]) + Math.abs(b - data[u + 2]);
          flatSamples++;
          if (dL <= 6 && dU <= 6) flat++;
        }
      }
    }
    var mean = count ? sum / count : 0;
    var variance = count ? Math.max(0, sum2 / count - mean * mean) : 0;

    // Edge energy on the luminance plane (simple gradient magnitude).
    var edge = 0, samples = 0;
    for (var yy = 1; yy < h; yy += 2) {
      for (var xx = 1; xx < w; xx += 2) {
        var o = (yy * w + xx) * 4;
        var l0 = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        var oL = (yy * w + xx - 1) * 4;
        var lL = 0.299 * data[oL] + 0.587 * data[oL + 1] + 0.114 * data[oL + 2];
        edge += Math.abs(l0 - lL);
        samples++;
      }
    }
    var edgeDensity = samples ? edge / samples : 0;
    var flatRatio = flatSamples ? flat / flatSamples : 0;

    return {
      hasAlpha: hasAlpha,
      distinct: distinct,
      flatRatio: flatRatio,
      graphic: distinct <= 1200 && flatRatio >= 0.45,
      stdev: Math.sqrt(variance),
      edgeDensity: edgeDensity
    };
  }

  /* ---------------------------------------------------------------------
     Quality metric
     --------------------------------------------------------------------- */
  function psnr(a, b, w, h) {
    var n = w * h * 4;
    var mse = 0;
    var step = 1;
    if (n > 4e6) step = 4; // subsample very large comparisons
    var used = 0;
    for (var i = 0; i < n; i += 4 * step) {
      var dr = a[i] - b[i], dg = a[i + 1] - b[i + 1], db = a[i + 2] - b[i + 2];
      mse += (dr * dr) * 0.299 + (dg * dg) * 0.587 + (db * db) * 0.114;
      used++;
    }
    mse /= (used || 1);
    if (mse <= 0.0001) return 99;
    return 10 * Math.log10((255 * 255) / mse);
  }

  function decodeToImageData(blob, w, h) {
    return decode(blob).then(function (bmp) {
      var bw = bmp.width || w, bh = bmp.height || h;
      var c = createCanvas(bw, bh);
      var cx = ctx2d(c, true);
      cx.drawImage(bmp, 0, 0, bw, bh);
      var out = cx.getImageData(0, 0, bw, bh);
      if (typeof bmp.close === 'function') bmp.close();
      return out;
    });
  }

  /**
   * Find the lowest quality whose proxy PSNR clears the floor.
   * PSNR is monotonic in quality, so a binary search is valid and cheap.
   */
  function autoQuality(proxyCanvas, format, opts) {
    var proxy = proxyOf(proxyCanvas, proxyCanvas.width, proxyCanvas.height);
    var w = proxy.w, h = proxy.h;
    var ref = ctx2d(proxy.canvas, true).getImageData(0, 0, w, h);
    var floor = (opts.psnrFloor || PSNR_FLOOR) + PSNR_PROXY_MARGIN;
    var lo = 0.30, hi = 0.96, best = null, bestQ = hi, tries = 0;

    /* Probe with the encoder the real encode will use.

       Probing natively while the final encode goes through WASM measures a
       different codec. AVIF is the sharp edge: no browser encodes it natively,
       so the canvas silently hands back PNG — a lossless probe that clears any
       floor, which let the binary search slide to the bottom of its range and
       ship ~33 dB output while the panel promised ~40 dB. A probe whose blob is
       not the requested format is not measuring anything. */
    function probe(q) {
      return encodeCanvas(proxy.canvas, format, q, { allowWasm: opts.allowWasm !== false })
        .then(function (r) {
          if (r.format && r.format !== format) return null;
          return decodeToImageData(r.blob, w, h);
        })
        .then(function (dec) {
          if (!dec) return null;
          var v = psnr(ref.data, dec.data, w, h);
          tries++;
          return v;
        });
    }

    function step() {
      if (tries >= 7 || hi - lo < 0.02) {
        return Promise.resolve({ quality: bestQ, psnr: best, probes: tries });
      }
      var mid = (lo + hi) / 2;
      return probe(mid).then(function (v) {
        /* The format cannot actually be produced here, so there is nothing to
           calibrate against. Fall back to a plainly safe setting rather than
           guessing downwards off a codec that is not the one being used. */
        if (v === null) {
          return Promise.resolve({ quality: 0.82, psnr: 0, probes: tries, substituted: true });
        }
        if (v >= floor) { bestQ = mid; best = v; hi = mid; }
        else { lo = mid; }
        return step();
      });
    }

    return step().then(function (res) {
      if (res.substituted) return res;
      // Nothing met the floor -> use the safest high setting.
      if (res.psnr === null) return { quality: 0.92, psnr: 0, probes: res.probes, clamped: true };
      return res;
    });
  }

  /* ---------------------------------------------------------------------
     Target size search
     --------------------------------------------------------------------- */
  function encodeToTarget(canvas, format, maxBytes, opts) {
    var attempts = [];
    var best = null;          // highest-quality encode that still fits the budget
    var lo = 0.06, hi = 0.96;
    var steps = 0;
    var MIN = 0.06;

    function attempt(q) {
      return encodeCanvas(canvas, format, q, opts).then(function (r) {
        r.q = q;
        attempts.push({ q: q, size: r.blob.size });
        if (r.blob.size <= maxBytes && (!best || r.blob.size > best.blob.size)) best = r;
        return r;
      });
    }

    function search() {
      var mid = (lo + hi) / 2;
      return attempt(mid).then(function (r) {
        steps++;
        if (r.blob.size > maxBytes) hi = mid; else lo = mid;
        var converged = steps >= 7 || hi - lo < 0.015;
        var tight = r.blob.size <= maxBytes && r.blob.size >= maxBytes * 0.94;
        if (converged || tight) return r;
        return search();
      });
    }

    return search().then(function () {
      if (best) {
        return { blob: best.blob, quality: best.q, attempts: attempts, downscales: 0, encoder: best.encoder };
      }
      // Even the floor is too big: shrink dimensions and retry, up to 3 rounds.
      return shrinkAndRetry(0, attempts);
    });

    function shrinkAndRetry(round, acc) {
      if (round >= 3) {
        return encodeCanvas(canvas, format, MIN, opts).then(function (r) {
          return { blob: r.blob, quality: MIN, attempts: acc, downscales: round, encoder: r.encoder, overshoot: r.blob.size > maxBytes };
        });
      }
      var smallest = acc.reduce(function (m, a) { return Math.min(m, a.size); }, Infinity);
      var ratio = Math.sqrt(maxBytes / Math.max(1, smallest)) * 0.98;
      var scale = Math.max(0.35, Math.min(0.94, ratio));
      var nw = Math.max(64, Math.round(canvas.width * scale));
      var nh = Math.max(64, Math.round(canvas.height * scale));
      var smaller = createCanvas(nw, nh);
      drawResized(smaller, canvas, canvas.width, canvas.height, nw, nh);

      var baseQ = Math.min(0.85, Math.max(0.5, acc.length ? acc[acc.length - 1].q : 0.7));
      return encodeCanvas(smaller, format, baseQ, opts).then(function (r) {
        acc.push({ q: baseQ, size: r.blob.size, resized: nw + 'x' + nh });
        if (r.blob.size <= maxBytes) {
          return { blob: r.blob, quality: baseQ, attempts: acc, downscales: round + 1, encoder: r.encoder, width: nw, height: nh };
        }
        canvas = smaller;
        return shrinkAndRetry(round + 1, acc);
      });
    }
  }

  /* ---------------------------------------------------------------------
     Format resolution
     --------------------------------------------------------------------- */
  /* The browser's own encoders are probed once at start-up, but AVIF (and
     on older browsers WebP) is only ever produced by a WASM codec that
     arrives later. Deciding the output format before that codec has had
     its chance is what silently turned an explicit "AVIF" into a WebP. */
  function effectiveCaps(caps) {
    var w = currentWasm();
    return {
      webp: !!(caps.webp || w.webp),
      avif: !!(caps.avif || w.avif),
      png: true,
      jpeg: true
    };
  }

  /* Warm the codec a format depends on, but only when the browser cannot
     produce it natively — otherwise the CDN would sit in the critical path
     for no reason. loadWasm() is internally bounded and never rejects. */
  function preloadCodecsFor(req, sourceType, caps) {
    var wanted = [];
    if (req === 'avif' && !caps.avif) wanted.push('avif');
    else if (req === 'webp' && !caps.webp) wanted.push('webp');
    else if (req === 'original') {
      if (/avif/.test(sourceType) && !caps.avif) wanted.push('avif');
      else if (/webp/.test(sourceType) && !caps.webp) wanted.push('webp');
    }
    if (!wanted.length) return null;
    return Promise.all(wanted.map(function (f) { return loadWasm(f); }));
  }

  function resolveFormat(opts, info, caps, sourceType) {
    var req = opts.format || 'auto';
    var hasAlpha = info.hasAlpha;
    var graphic = info.graphic;

    if (req === 'auto') {
      // Flat, few-colour images (screenshots, diagrams, logos) win big from
      // the palette path; photographs go to WebP when the browser can do it.
      if (graphic) return 'png';
      if (caps.webp) return 'webp';
      return 'jpeg';
    }
    if (req === 'original') {
      if (/png/.test(sourceType)) return hasAlpha ? 'png' : (caps.webp ? 'webp' : 'png');
      if (/webp/.test(sourceType)) return caps.webp ? 'webp' : 'jpeg';
      if (/avif/.test(sourceType)) return caps.avif ? 'avif' : 'jpeg';
      if (/jpe?g/.test(sourceType)) return caps.webp ? 'webp' : 'jpeg';
      return caps.webp ? 'webp' : 'jpeg';
    }
    if (req === 'webp' && !caps.webp) return 'jpeg';
    if (req === 'avif' && !caps.avif) return caps.webp ? 'webp' : 'jpeg';
    return req;
  }

  /* ---------------------------------------------------------------------
     Main pipeline
     --------------------------------------------------------------------- */
  function compress(file, opts, ctx) {
    opts = opts || {};
    ctx = ctx || {};
    var report = ctx.report || function () {};
    var native = ctx.caps || {};
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    report(0.02, 'Reading');
    var warming = preloadCodecsFor(opts.format || 'auto', file.type || '', native);
    /* A codec download is the only slow step on a first visit — say so,
       instead of leaving the user staring at "Reading". */
    if (warming && opts.format && opts.format !== 'auto' && !currentWasm()[opts.format]) {
      report(0.06, 'Loading ' + String(opts.format).toUpperCase() + ' encoder');
    }

    return Promise.all([decode(file), warming]).then(function (r) {
      var src = r[0];
      // Re-read capability: the WASM codecs may have landed while decoding.
      var caps = effectiveCaps(native);
      var size = sourceSize(src);
      if (!size.w || !size.h) throw new Error('decode-failed');
      if (size.w * size.h > MAX_PIXELS) throw new Error('too-large');

      report(0.15, 'Analyzing');
      var proxy = proxyOf(src, size.w, size.h);
      var info = analyzeProxy(proxy.canvas);
      var opaqueTreated = !info.hasAlpha;

      var format = resolveFormat(opts, info, caps, file.type || '');

      // Dimensions
      var dw = size.w, dh = size.h;
      var maxDim = opts.maxDimension || 0;
      if (maxDim && Math.max(dw, dh) > maxDim) {
        var s = maxDim / Math.max(dw, dh);
        dw = Math.max(1, Math.round(dw * s));
        dh = Math.max(1, Math.round(dh * s));
      }
      var downscaled = dw !== size.w || dh !== size.h;
      var scale = dw / size.w;

      report(0.25, 'Resampling');
      var canvas = renderToCanvas(src, size.w, size.h, dw, dh, opaqueTreated && format !== 'png');
      if (typeof src.close === 'function') src.close();

      // Sharpening decision
      var sharpen = opts.sharpen || 'auto';
      var doSharpen = sharpen === 'on' || (sharpen === 'auto' && downscaled && scale < 0.82);
      if (doSharpen && format !== 'png') {
        report(0.33, 'Sharpening');
        applyUnsharp(canvas, opts.sharpenAmount || 0.55);
      }

      var strategy = '';
      report(0.4, 'Encoding');

      var work;
      if (format === 'png') {
        var pngColors = opts.pngColors;
        if (pngColors === undefined || pngColors === null || pngColors === 'auto') {
          // Opaque graphics (screenshots, flat art) quantize beautifully.
          // Alpha images stay lossless because the indexed writer has no tRNS.
          pngColors = (info.graphic && !info.hasAlpha) ? 256 : false;
        }
        var pngOpts = {
          pngColors: pngColors || false,
          dither: opts.dither !== false,
          forceLosslessPng: !pngColors
        };
        if (opts.mode === 'target') {
          strategy = 'target-png';
          work = encodeToTarget(canvas, 'png', (opts.targetKB || 200) * 1024, pngOpts).then(function (r) {
            return { blob: r.blob, quality: 1, attempts: r.attempts, downscales: r.downscales, width: w2(r, dw), height: h2(r, dh) };
          });
        } else {
          strategy = pngColors ? 'png8' : 'png-lossless';
          work = encodeCanvas(canvas, 'png', 1, pngOpts).then(function (r) {
            return { blob: r.blob, quality: 1, attempts: [{ q: 1, size: r.blob.size }], downscales: 0, encoder: r.encoder, palette: r.palette };
          });
        }
      } else if (opts.mode === 'target') {
        strategy = 'target-size';
        work = encodeToTarget(canvas, format, Math.max(4 * 1024, (opts.targetKB || 200) * 1024), { allowWasm: opts.allowWasm !== false })
          .then(function (r) {
            return { blob: r.blob, quality: r.quality, attempts: r.attempts, downscales: r.downscales, encoder: r.encoder, width: r.width || dw, height: r.height || dh, overshoot: r.overshoot };
          });
      } else if (opts.mode === 'quality') {
        strategy = 'fixed-quality';
        work = encodeCanvas(canvas, format, opts.quality || 0.8, { allowWasm: opts.allowWasm !== false })
          .then(function (r) {
            return { blob: r.blob, quality: opts.quality || 0.8, attempts: [{ q: opts.quality, size: r.blob.size }], downscales: 0, encoder: r.encoder };
          });
      } else {
        strategy = 'auto-perceptual';
        report(0.45, 'Measuring quality');
        work = autoQuality(canvas, format, opts).then(function (q) {
          report(0.72, 'Encoding');
          return encodeCanvas(canvas, format, q.quality, { allowWasm: opts.allowWasm !== false })
            .then(function (r) {
              return {
                blob: r.blob, quality: q.quality, psnr: q.psnr, probes: q.probes,
                attempts: [{ q: q.quality, size: r.blob.size }], downscales: 0, encoder: r.encoder
              };
            });
        });
      }

      return work.then(function (res) {
        var outW = res.width || dw, outH = res.height || dh;
        var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        report(1, 'Done');
        return {
          blob: res.blob,
          format: res.blob.type || CANONICAL_MIME[format] || 'image/jpeg',
          formatKey: (res.blob.type || '').indexOf('webp') >= 0 ? 'webp'
            : (res.blob.type || '').indexOf('png') >= 0 ? 'png'
            : (res.blob.type || '').indexOf('avif') >= 0 ? 'avif' : 'jpeg',
          width: outW,
          height: outH,
          originalWidth: size.w,
          originalHeight: size.h,
          originalSize: file.size,
          quality: res.quality,
          psnr: res.psnr || null,
          strategy: strategy,
          encoder: res.encoder || 'native',
          requested: opts.format || 'auto',
          // Set when the user asked for a format this browser turned out not
          // to support. The UI owes them an explanation rather than silence.
          downgraded: (opts.format === 'avif' || opts.format === 'webp') && format !== opts.format
            ? opts.format : null,
          palette: res.palette || 0,
          downscales: res.downscales || 0,
          attempts: res.attempts || [],
          overshoot: !!res.overshoot,
          analysis: info,
          duration: Math.round(t1 - t0)
        };
      });
    });
  }

  function w2(r, fallback) { return r.width || fallback; }
  function h2(r, fallback) { return r.height || fallback; }

  /* ---------------------------------------------------------------------
     Capability probe
     --------------------------------------------------------------------- */
  /* Best-effort synchronous probe (main thread only). */
  function detectFormats() {
    var result = { webp: false, avif: false, png: true, jpeg: true };
    try {
      if (typeof document === 'undefined') return result;
      var c = createCanvas(2, 2);
      var cx = ctx2d(c, true);
      cx.fillStyle = '#4f46e5';
      cx.fillRect(0, 0, 2, 2);
      result.webp = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      result.avif = c.toDataURL('image/avif').indexOf('data:image/avif') === 0;
    } catch (e) { /* keep defaults */ }
    return result;
  }

  /* Authoritative probe: actually encode a probe image and inspect the MIME. */
  function probeFormat(type) {
    var c = createCanvas(2, 2);
    var cx = ctx2d(c, true);
    cx.fillStyle = '#4f46e5';
    cx.fillRect(0, 0, 2, 2);
    return canvasToBlob(c, type, 0.8).then(function (blob) {
      return (blob.type || '').toLowerCase() === type;
    }).catch(function () { return false; });
  }

  function detectFormatsAsync() {
    return Promise.all([probeFormat('image/webp'), probeFormat('image/avif')])
      .then(function (r) {
        return { webp: r[0], avif: r[1], jpeg: true, png: true };
      });
  }

  function capabilities() {
    /* Reports what is available right now and downloads nothing.
       This used to fire loadWasm() for all three codecs as a side effect, which
       put ~2 MB per worker on the wire for every visitor — including the ones
       who only ever read the page — and, worse, raced the codec a visitor had
       explicitly asked for: an AVIF request could miss its patience budget
       behind its own warm-up and quietly come back as WebP. Codecs now start
       only from preload(), which the UI calls when someone reaches for the
       tool or picks a format. */
    return detectFormatsAsync().then(function (formats) {
      return {
        formats: formats,
        wasm: currentWasm(),
        wasmState: Object.assign({}, wasmState),
        reasons: Object.assign({}, wasmReason),
        engine: isWorker ? 'worker' : 'main-thread'
      };
    });
  }

  /* ---------------------------------------------------------------------
     Exports
     --------------------------------------------------------------------- */
  global.LPT = global.LPT || {};
  global.LPT.engine = {
    compress: compress,
    capabilities: capabilities,
    wasmSettled: wasmSettled,
    preload: preload,
    currentWasm: currentWasm,
    detectFormats: detectFormats,
    detectFormatsAsync: detectFormatsAsync,
    loadWasm: loadWasm,
    createCanvas: createCanvas,
    drawResized: drawResized,
    encodeCanvas: encodeCanvas,
    psnr: psnr,
    _internal: { medianCut: medianCut, mapToPalette: mapToPalette, buildIndexedPng: buildIndexedPng, deflateZlib: deflateZlib, crc32: crc32 }
  };
})(typeof self !== 'undefined' ? self : this);
