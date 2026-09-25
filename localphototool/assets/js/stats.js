/* ==========================================================================
   LocalPhotoTool — anonymous visit counter (client)

   No cookies, no fingerprinting, no third-party endpoint. The browser keeps a
   random ID in localStorage; the server counts that ID once per day, so a
   person who opens ten tabs or comes back five times is still one visitor.
   If the endpoint is unreachable the widget simply stays out of the way.
   ========================================================================== */
(function () {
  'use strict';

  var API = '/api/count';
  var VID_KEY = 'lpt.vid';
  var SENT_KEY = 'lpt.sent';
  var CACHE_KEY = 'lpt.stats';
  var MIN_GAP = 5 * 60 * 1000;      // do not ping more than once every 5 min
  var CACHE_TTL = 30 * 60 * 1000;   // cached numbers are good for 30 min
  var MUTE_KEY = 'lpt.mute';        // owner opt-out; this browser only

  /* ---------------------------------------------------------------- store */

  function ls(op, key, value) {
    try {
      if (op === 'get') return window.localStorage.getItem(key);
      if (op === 'set') window.localStorage.setItem(key, value);
      if (op === 'del') window.localStorage.removeItem(key);
    } catch (e) { /* private mode — run without persistence */ }
    return null;
  }

  function randomId() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (b) {
      return b.toString(36);
    }).join('').replace(/[^a-z0-9]/gi, '').slice(0, 24).padEnd(12, '0');
  }

  function visitorId() {
    var id = ls('get', VID_KEY);
    if (!id || id.length < 8) {
      id = 'v' + randomId();
      ls('set', VID_KEY, id);
    }
    return id;
  }

  /* ------------------------------------------------------------- filters */

  function forced() {
    if (window.LPT_STATS_FORCE) return true;
    try { return window.location.search.indexOf('stats=1') !== -1; } catch (e) { return false; }
  }

  function looksAutomated() {
    if (forced()) return false;
    try {
      if (navigator.webdriver) return true;
      var ua = navigator.userAgent || '';
      if (/bot|crawl|spider|slurp|headless|preview|monitor|scan|lighthouse|puppeteer|playwright|selenium|phantom/i.test(ua)) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /* -------------------------------------------------------------- render */

  function fmt(n) {
    try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); }
  }

  function animate(el, target, suffix) {
    suffix = suffix || '';
    var from = parseInt(String(el.textContent).replace(/[^0-9-]/g, ''), 10);
    if (isNaN(from)) from = 0;
    if (from === target || window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = fmt(target) + suffix;
      return;
    }
    var start = 0;
    var dur = Math.min(900, 300 + Math.abs(target - from));
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (target - from) * eased)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* Round a public number down so it reads as a range, e.g. 1,237 → "1,200+".
     A precise small number ("12 visitors") hurts more than it helps. */
  function floorValue(v, floor) {
    if (!floor || floor <= 1) return { value: v, suffix: '' };
    var f = Math.floor(v / floor) * floor;
    if (f <= 0) return { value: v, suffix: '' };
    return { value: f, suffix: '+' };
  }

  function paint(el, data) {
    var key = el.getAttribute('data-stats');
    if (key === 'axis') return false;
    if (key === 'days') { spark(el, data.days); return true; }
    if (typeof data[key] !== 'number') return false;
    var f = floorValue(data[key], parseInt(el.getAttribute('data-stats-floor') || '0', 10));
    animate(el, f.value, f.suffix);
    return true;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function label(mmdd) {
    var parts = String(mmdd).split('-');
    var m = parseInt(parts[0], 10);
    var d = parseInt(parts[1], 10);
    if (!m || !d || !MONTHS[m - 1]) return mmdd;
    return MONTHS[m - 1] + ' ' + d;
  }

  function spark(container, days) {
    if (!container || !days || !days.length) return;
    var max = 1;
    days.forEach(function (d) { if (d.v > max) max = d.v; });
    container.textContent = '';
    days.forEach(function (d, i) {
      var col = document.createElement('span');
      col.className = 'spark__col';
      col.title = label(d.d) + ' · ' + d.v + (d.v === 1 ? ' visitor' : ' visitors');
      var bar = document.createElement('i');
      bar.className = 'spark__bar';
      if (d.v === 0) {
        bar.classList.add('is-empty');
        bar.style.height = '3px';
      } else {
        bar.style.height = Math.max(12, Math.round((d.v / max) * 100)) + '%';
      }
      if (i === days.length - 1) bar.classList.add('is-today');
      col.appendChild(bar);
      container.appendChild(col);
    });

    var axis = document.querySelector('[data-stats="axis"]');
    if (axis) {
      axis.textContent = '';
      var first = document.createElement('span');
      first.textContent = label(days[0].d);
      var last = document.createElement('span');
      last.textContent = 'Today';
      axis.appendChild(first);
      axis.appendChild(last);
    }
  }

  /* Public widgets stay hidden until the number is worth showing.
     `data-stats-min="500"` on a block = do not reveal it below 500 visitors.
     The private dashboard sets no minimum, so it always shows the truth. */
  function render(data) {
    if (!data) return;

    Array.prototype.forEach.call(document.querySelectorAll('[data-stats-block]'), function (block) {
      var min = parseInt(block.getAttribute('data-stats-min') || '0', 10);
      if (min > 0 && (data.visitors || 0) < min) { block.hidden = true; return; }

      var painted = false;
      Array.prototype.forEach.call(block.querySelectorAll('[data-stats]'), function (el) {
        if (paint(el, data)) painted = true;
      });
      block.hidden = !painted;
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-stats]'), function (el) {
      if (el.closest('[data-stats-block]')) return;
      paint(el, data);
    });
  }

  /* --------------------------------------------------------------- fetch */

  function readCache() {
    var raw = ls('get', CACHE_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.data || typeof parsed.data.visitors !== 'number') return null;
      if (Date.now() - parsed.at > CACHE_TTL) return null;
      return parsed.data;
    } catch (e) { return null; }
  }

  function writeCache(data) {
    ls('set', CACHE_KEY, JSON.stringify({ at: Date.now(), data: data }));
  }

  /* Whoever owns the site is the one reading these numbers, so their own
     reading must not inflate them. Two cases go read-only instead of counting:

       · /stats/ itself — every dashboard view would otherwise be a "visitor"
       · the owner's browser, once they tick the opt-out on that page

     Both use a GET, which the API treats as a peek: same numbers back, nothing
     written. The opt-out is a flag in this browser's localStorage — the same
     place the visitor id already lives, no cookie, nothing sent anywhere. */
  function muted() {
    return ls('get', MUTE_KEY) === '1';
  }

  function readOnly() {
    if (muted()) return true;
    try { return /^\/stats(\/|$)/.test(window.location.pathname); } catch (e) { return false; }
  }

  function ping(force) {
    if (looksAutomated()) return Promise.resolve(null);

    var ro = readOnly();
    var last = parseInt(ls('get', SENT_KEY) || '0', 10);
    if (!force && !ro && last && Date.now() - last < MIN_GAP) return Promise.resolve(null);
    if (!(window.fetch && window.Request)) return Promise.resolve(null);

    var opts = { method: 'GET' };
    if (!ro) {
      opts = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: visitorId(), p: window.location.pathname }),
        keepalive: true
      };
      ls('set', SENT_KEY, String(Date.now()));
    }

    return fetch(API, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.reason) || 'unavailable');
      if (!ro) ls('set', SENT_KEY, String(Date.now()));
      writeCache(data);
      return data;
    }).catch(function () {
      return null;
    });
  }

  /* ---------------------------------------------------------------- boot */

  function boot() {
    /* Counting happens on every page even when nothing is displayed — the
       number has to be there by the time it is big enough to show. */
    var cached = readCache();
    if (cached) render(cached);

    ping().then(function (data) {
      if (data) render(data);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.LPTStats = {
    refresh: function (force) { return ping(force).then(function (d) { if (d) render(d); return d; }); },
    render: render,
    muted: muted,
    isReadOnly: readOnly,
    setMuted: function (on) {
      if (on) ls('set', MUTE_KEY, '1'); else ls('del', MUTE_KEY);
      ls('del', SENT_KEY);   // drop the throttle so the change takes effect at once
      return muted();
    }
  };
})();
