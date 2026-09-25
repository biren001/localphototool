/* ==========================================================================
   LocalPhotoTool — service worker

   Goal: after the first visit the whole tool works with no network at all,
   which is the honest promise for a "nothing leaves your device" site.

   Rules
   - Pages (navigations): network first, cache as the offline fallback, so a
     new deploy is picked up immediately.
   - Same-origin static files: cache first, refreshed in the background.
   - The WASM codec bundles (esm.sh / jsDelivr): cached on first use, so AVIF
     and WebP encoding also work offline after one visit.
   - /api/count is never cached; if it is unreachable we answer with a valid
     "not available" payload so the page never throws.
   ========================================================================== */

/* The worker may live at the domain root or inside a sub-folder, so every
   path is derived from its own location instead of hard-coding "/". */
var ROOT = self.location.pathname.replace(/sw\.js$/, '');
var API_PATH = ROOT + 'api/count';
var OFFLINE = ROOT + 'offline.html';

/* Bumped whenever a file in SHELL changes: the old caches are dropped on
   activate, so returning visitors cannot keep running a stale shell.
   v4 — stats.js stopped counting the owner's own dashboard views.
   v5 — HEIC moved to a self-hosted decoder, and /heic-to-jpg/ joined the shell.
   v6 — every page's nav and footer gained the HEIC to JPG entry, the two tool
   pages stopped using depth-sensitive "./" links for their own blocks, and the
   nav's inline/hamburger breakpoint moved from 860px to 1080px to fit the
   wider row (see the measurement note in style.css).
   v7 — codecs load on intent instead of on page load, and each one is fetched
   at most once per worker (see the note in engine.js).
   v8 — the worker script is now registered with updateViaCache 'none', so a
   deploy reaches returning visitors instead of waiting out the four hours the
   CDN's Browser Cache TTL puts on /sw.js (see the note in pwa.js).
   v9 — the share page shows a 720x900 WebP preview of each poster instead of
   the 1080x1350 print PNG, and the footer column titles are <h2> rather than
   <h4> (they followed a page <h2>, so every page skipped a heading level).
   The decoder itself (assets/vendor/libheif-bundle.mjs, ~1.4 MB) is NOT in the
   list on purpose: it is cached at runtime for the people who actually convert
   a HEIC, and preloading it would put that download on every visitor.
   v10-v12 — the three long-tail landing pages (compress-to-100kb, png-to-jpg,
   jpg-to-webp) joined the shell, the FAQ answers were re-synced with their
   JSON-LD, and the compression figures were replaced with measured ones after
   the engine's Auto-quality search was fixed (see the note in engine.js).
   v13 — the secondary pages (about, privacy, terms) gained a complete share
   card, so a link posted anywhere renders a preview instead of a bare line,
   and the /compress/ title was trimmed to stop it truncating in search.
   v14 — the other three landing pages (compress-to-50kb, compress-to-200kb,
   compress-photos-for-email) joined the shell. They had been live and linked
   from every nav since the previous deploy while sitting outside the shell
   cache, the page tests and the live checker, so an installed copy dropped to
   the offline page when a visitor followed one of those links.
   v15 — two titles that still ran past the ~60 characters Google shows before
   truncating: /compress/ (61) and /compress-photos-for-email/ (63). The words
   that got cut were the ones that make the result worth clicking ("No Upload"),
   so both now fit with the differentiator intact.
   v16 — the homepage meta description stopped claiming "up to 90%". That figure
   was retired once it was measured false for photographs (it holds for PNG
   screenshots), but the ban only ever covered the distribution kit, so the last
   copy of it on the site sat in the tag every scraper reads. Confirmed to matter
   rather than suspected: the Tiny Startups wizard filled its tagline field by
   reading this tag and handed the retired sentence back to be published.
   check-listing-copy.cjs now scans the site files, not only the kit. The
   replacement is the same length (151), so nothing else about the snippet
   changes.
   v17 — /compress-without-uploading/ joined the site. The nav row grew by one
   entry ("No upload"), so every page's shell changed: an installed copy would
   otherwise render the new link from a cached nav that predates it. The page
   also had to enter the sitemap before it entered the shell — a page inside the
   shell but outside the sitemap is a page the offline copy serves to visitors
   while no crawler is ever told it exists. */
var VERSION = 'v24';
var SHELL_CACHE = 'lpt-shell-' + VERSION;
var PAGE_CACHE = 'lpt-pages-' + VERSION;
var VENDOR_CACHE = 'lpt-vendor-' + VERSION;
var KEEP = [SHELL_CACHE, PAGE_CACHE, VENDOR_CACHE];

var SHELL = [
  '',
  'compress/',
  'heic-to-jpg/',
  'compress-to-100kb/',
  'compress-to-50kb/',
  'compress-to-200kb/',
  'compress-to-500kb/',
  'remove-gps-from-photo/',
  'transfer/',
  'transfer/app.js',
  'transfer/vendor/peerjs.min.js',
  'transfer/vendor/qrcode.min.js',
  'compress-photos-for-email/',
  'compress-without-uploading/',
  'image-compressor-upload-test/',
  'png-to-jpg/',
  'jpg-to-webp/',
  'share/',
  'about/',
  'offline.html',
  'site.webmanifest',
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'maskable-512.png',
  'assets/css/style.css',
  'assets/js/site.js',
  'assets/js/pwa.js',
  'assets/js/stats.js',
  'assets/js/share.js',
  'assets/js/chime.js',
  'assets/js/compressor/app.js',
  'assets/js/compressor/engine.js',
  'assets/js/compressor/worker.js'
].map(function (p) { return ROOT + p; });

var VENDOR_HOSTS = ['esm.sh', 'cdn.jsdelivr.net'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      /* Add one by one: a single 404 must not abort the whole install. */
      return Promise.all(SHELL.map(function (url) {
        return fetch(new Request(url, { cache: 'reload' }))
          .then(function (res) { return store(cache, url, res); })
          .catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (KEEP.indexOf(n) === -1) return caches.delete(n);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isVendor(url) {
  for (var i = 0; i < VENDOR_HOSTS.length; i++) {
    if (url.hostname === VENDOR_HOSTS[i] || url.hostname.endsWith('.' + VENDOR_HOSTS[i])) return true;
  }
  return false;
}

function cacheable(res) {
  return res && res.status === 200 && (res.type === 'basic' || res.type === 'cors' || res.type === 'default');
}

/* Store a response, always as a clean 200 ("consumes res — pass a clone").

   Why this is not just cache.put(): a response that came back through a
   redirect carries the redirected flag, and a browser REFUSES to answer a
   navigation request with such a response. Cloudflare Pages does exactly this
   — it strips the .html extension, so /offline.html answers with a 308 to
   /offline. Caching that hop verbatim would leave the offline fallback
   unusable at the one moment it matters, so a redirected body is re-wrapped
   into a fresh response before it is stored. */
function store(cache, request, res) {
  if (!cacheable(res)) return Promise.resolve(null);
  if (!res.redirected) return cache.put(request, res).catch(function () { return null; });
  return res.arrayBuffer().then(function (buf) {
    return cache.put(request, new Response(buf, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': res.headers.get('content-type') || 'text/html; charset=utf-8' }
    }));
  }).catch(function () { return null; });
}

/* Serve from cache, then refresh in the background (stale-while-revalidate). */
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (hit) {
      var network = fetch(request).then(function (res) {
        store(cache, request, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    });
  });
}

/* Try the network, fall back to whatever we stored for offline use. */
function networkFirst(request, cacheName, fallbackUrl) {
  return fetch(request).then(function (res) {
    caches.open(cacheName).then(function (cache) { store(cache, request, res.clone()); });
    return res;
  }).catch(function () {
    return caches.match(request).then(function (hit) {
      if (hit) return hit;
      return caches.match(fallbackUrl || OFFLINE);
    }).then(function (page) {
      return page || new Response('Offline', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* The visitor counter must always be live; never answer it from a cache. */
  if (url.origin === self.location.origin && url.pathname === API_PATH) {
    event.respondWith(
      fetch(request).catch(function () {
        return new Response(JSON.stringify({ ok: false, reason: 'offline' }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      })
    );
    return;
  }

  /* Never let a stale owner-only dashboard linger in the cache. */
  if (url.pathname.indexOf(ROOT + 'stats') === 0) return;

  /* Cross-origin: only the codec CDNs are worth storing. */
  if (url.origin !== self.location.origin) {
    if (isVendor(url)) event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGE_CACHE, OFFLINE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
