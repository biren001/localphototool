/* ==========================================================================
   LocalPhotoTool — shared site behaviour (theme, nav, misc)
   ========================================================================== */
(function () {
  'use strict';

  var THEME_KEY = 'lpt.theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0d18' : '#ffffff');
  }

  function currentTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function initTheme() {
    applyTheme(currentTheme());
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (ev) {
        var stored = null;
        try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
        if (!stored) applyTheme(ev.matches ? 'dark' : 'light');
      });
    }
  }

  function initNav() {
    var toggle = document.getElementById('navToggle');
    var links = document.getElementById('navLinks');
    if (toggle && links) {
      toggle.addEventListener('click', function () {
        var open = links.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      links.addEventListener('click', function (ev) {
        if (ev.target.tagName === 'A') {
          links.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    var header = document.querySelector('.site-header');
    if (header) {
      var onScroll = function () {
        header.classList.toggle('is-scrolled', window.scrollY > 6);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  function initYear() {
    var nodes = document.querySelectorAll('[data-year]');
    var year = String(new Date().getFullYear());
    Array.prototype.forEach.call(nodes, function (n) { n.textContent = year; });
  }

  /* ======================================================================
     Pinned tools

     Remembering which tools a visitor opens is the whole point: the homepage
     then puts them at the top of the toolkit instead of making somebody hunt
     through a grid. The list lives in localStorage on the visitor's own
     machine — it is never sent, never counted and never shared, and it is the
     same kind of local storage the theme toggle already uses.
     ====================================================================== */
  var PIN_KEY = 'lpt.tools';
  var PIN_MAX = 8;
  var PIN_SHOW = 6;
  /* Pages that are not tools. Anything else that ends in a slash counts as
     one, so new tools are remembered without touching this list. */
  var NOT_A_TOOL = {
    about: 1, privacy: 1, terms: 1, share: 1, stats: 1, report: 1, faq: 1,
    sitemap: 1, 'image-compressor-upload-test': 1, 'compress-without-uploading': 1,
    'why-my-image-wont-get-smaller': 1
  };
  var PIN_ICON = 'M12 3l2.2 5.4 5.8.5-4.4 3.9 1.3 5.7L12 15.9 7.1 18.5l1.3-5.7L4 8.9l5.8-.5L12 3z';
  var PIN_X = 'M6 6l12 12M18 6L6 18';

  function pinLoad() {
    try {
      var raw = JSON.parse(localStorage.getItem(PIN_KEY) || '[]');
      return Object.prototype.toString.call(raw) === '[object Array]' ? raw : [];
    } catch (e) { return []; }
  }

  function pinSave(list) {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(list.slice(0, PIN_MAX))); } catch (e) { /* private mode */ }
  }

  /* Everywhere a tool is identified — from location.pathname or from a link —
     it comes out as a bare slug, "compress", never "/compress". */
  function pinSlug(raw) {
    return String(raw || '').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  function pinLabel(slug, text) {
    var t = (text || '').replace(/\s+/g, ' ').trim().slice(0, 42);
    if (t.length > 1) return t;
    return slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function pinRemember(raw, label) {
    var slug = pinSlug(raw);
    if (!slug || NOT_A_TOOL[slug]) return;
    var list = pinLoad().filter(function (e) { return e && e.p !== slug; });
    list.unshift({ p: slug, n: label });
    pinSave(list);
  }

  function pinSvg(d) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    /* Without the class the svg falls back to its intrinsic size and squeezes
       the label it sits next to. */
    svg.setAttribute('class', 'pin__icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function pinRender() {
    var mine = document.getElementById('pinMine');
    var holder = document.getElementById('pinMineList');
    var clear = document.getElementById('pinClear');
    if (!mine || !holder) return;

    var list = pinLoad().filter(function (e) { return e && e.p; });
    if (!list.length) {
      mine.hidden = true;
      if (clear) clear.hidden = true;
      return;
    }
    mine.hidden = false;
    if (clear) clear.hidden = false;
    holder.textContent = '';

    list.slice(0, PIN_SHOW).forEach(function (entry) {
      var slug = entry.p;
      var name = entry.n || pinLabel(slug, '');
      var li = document.createElement('li');
      li.className = 'pin-wrap pin-wrap--mine';

      var a = document.createElement('a');
      a.className = 'pin__main';
      a.href = '/' + slug + '/';
      a.appendChild(pinSvg(PIN_ICON));
      var span = document.createElement('span');
      span.className = 'pin__label';
      span.textContent = name;
      a.appendChild(span);
      li.appendChild(a);

      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'pin__x';
      x.title = 'Forget ' + name;
      x.setAttribute('aria-label', 'Forget ' + name);
      x.appendChild(pinSvg(PIN_X));
      x.addEventListener('click', function (ev) {
        ev.preventDefault();
        pinSave(pinLoad().filter(function (e) { return !e || e.p !== slug; }));
        pinRender();
      });
      li.appendChild(x);

      holder.appendChild(li);
    });
  }

  function initPinned() {
    pinRender();

    var here = pinSlug(location.pathname);
    if (here) pinRemember(here, pinLabel(here, ''));

    document.addEventListener('click', function (ev) {
      if (ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var el = ev.target;
      if (!el || !el.closest) return;
      var a = el.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      var url;
      try { url = new URL(a.href, location.href); } catch (e) { return; }
      if (url.origin !== location.origin) return;
      var slug = pinSlug(url.pathname);
      if (!slug) return;
      pinRemember(slug, pinLabel(slug, a.textContent));
      pinRender();
    });

    var clear = document.getElementById('pinClear');
    if (clear) {
      clear.addEventListener('click', function () {
        try { localStorage.removeItem(PIN_KEY); } catch (e) { /* ignore */ }
        pinRender();
      });
    }
  }

  function boot() {
    initTheme();
    initNav();
    initYear();
    initPinned();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
