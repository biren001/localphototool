/* ==========================================================================
   LocalPhotoTool — /_worker.js  (Cloudflare Pages, Advanced Mode)

   What this file does
   1. Serves the static site exactly as before (falls through to env.ASSETS).
   2. Adds /api/count — an anonymous, cookie-free visit counter that
      de-duplicates visitors server side.

   Setup needed in the dashboard (one time):
   - Workers & Pages → KV → Create namespace (any name, e.g. lpt-stats)
   - Pages project → Settings → Functions → KV namespace bindings → Add
     (any variable name works, this file auto-detects it)

   If no KV namespace is bound the site still works normally; the counter
   simply reports ok:false and the homepage hides the widget.
   ========================================================================== */

var CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://esm.sh https://cdn.jsdelivr.net https://cloudflareinsights.com https://static.cloudflareinsights.com wss://0.peerjs.com; worker-src 'self' blob:; font-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'";

var SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Content-Security-Policy': CSP
};

var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

var MAIN_KEY = 'lpt:main';        // { v: <total unique visitors>, d: { 'YYYY-MM-DD': n } }
var SEEN_PREFIX = 'lpt:v:';       // 'lpt:v:<hash>' -> 'YYYY-MM-DD' (last day this visitor counted)
var KEEP_DAYS = 60;               // how many daily buckets to keep
var SPARK_DAYS = 14;
var SALT = 'localphototool|v1';
var ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
var APEX = 'localphototool.com';

/* One canonical hostname.

   www is attached to the same Pages project, so it serves a full copy of the
   site — classic duplicate content. A Redirect Rule in the dashboard does the
   same job, but keeping it here means it is version-controlled, reviewable and
   testable locally instead of being invisible configuration. */
function canonicalRedirect(url) {
  if (url.hostname !== 'www.' + APEX) return null;
  return new Response(null, {
    status: 301,
    headers: { location: 'https://' + APEX + url.pathname + url.search }
  });
}

/* Crawlers, uptime robots, link previews and script kiddies — not people. */
var BOT_RE = /bot|crawler|crawl|spider|slurp|curl|wget|python|headless|preview|monitor|scanner|lighthouse|pingdom|uptime|feedfetcher|facebookexternal|embedly|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|validator|scrapy|http_?client|go-http|axios|node-fetch/i;

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, must-revalidate'
    }
  });
}

function withCORS(res) {
  var out = new Response(res.body, res);
  Object.keys(CORS_HEADERS).forEach(function (k) { out.headers.set(k, CORS_HEADERS[k]); });
  return out;
}

/* Accept any KV binding name — avoids "variable name mismatch" breakage. */
function pickKV(env) {
  if (!env) return null;
  var preferred = ['LPT_STATS', 'STATS', 'KV', 'COUNTER', 'VISITS'];
  var i;
  for (i = 0; i < preferred.length; i++) {
    var b = env[preferred[i]];
    if (b && typeof b.get === 'function' && typeof b.put === 'function') return b;
  }
  var keys = Object.keys(env);
  for (i = 0; i < keys.length; i++) {
    var c = env[keys[i]];
    if (c && typeof c.get === 'function' && typeof c.put === 'function' && typeof c.list === 'function') return c;
  }
  return null;
}

function dayStamp(offsetDays) {
  var d = new Date();
  if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function lastDays(n) {
  var out = [];
  for (var i = n - 1; i >= 0; i--) out.push(dayStamp(-i));
  return out;
}

async function sha256(str) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.prototype.map.call(new Uint8Array(buf), function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('').slice(0, 32);
}

function readMain(raw) {
  var main = { v: 0, d: {} };
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        main.v = parseInt(parsed.v, 10) || 0;
        main.d = (parsed.d && typeof parsed.d === 'object') ? parsed.d : {};
      }
    } catch (e) { /* corrupted value — start from what we can trust */ }
  }
  return main;
}

function pruneDays(days) {
  var keep = {};
  var allowed = lastDays(KEEP_DAYS);
  var i;
  for (i = 0; i < allowed.length; i++) {
    if (days[allowed[i]] != null) keep[allowed[i]] = parseInt(days[allowed[i]], 10) || 0;
  }
  return keep;
}

function sumSince(main, n) {
  var days = lastDays(n);
  var total = 0;
  for (var i = 0; i < days.length; i++) total += parseInt(main.d[days[i]], 10) || 0;
  return total;
}

/* -------------------------------------------------------------------------- */
/* /api/count                                                                 */
/* -------------------------------------------------------------------------- */

export async function handleCount(request, env) {
  var kv = pickKV(env);

  if (BOT_RE.test(request.headers.get('user-agent') || '')) {
    return json({ ok: false, reason: 'bot' });
  }

  /* Only this site may add to the tally (a browser always sends Origin on POST). */
  var origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return json({ ok: false, reason: 'cross-origin' });
      }
    } catch (e) { /* malformed Origin — fall through and treat as a peek */ }
  }

  var body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  /* A read-out must never move the needle it reports. The owner's dashboard
     posts nothing (see assets/js/stats.js), but a stale cached copy of that
     script still could — so the rule lives here as well, where no outdated
     client can talk its way around it. */
  var onDashboard = typeof body.p === 'string' && /^\/stats(\/|$)/.test(body.p);
  var peek = request.method === 'GET' || body.peek === true || onDashboard;
  var vid = typeof body.v === 'string' ? body.v.trim() : '';
  var today = dayStamp(0);

  /* No KV bound: stay silent instead of showing a broken number. */
  if (!kv) return json({ ok: false, reason: 'kv-not-bound' });

  var isNew = false;      // never seen before
  var newToday = false;   // not counted yet today

  if (!peek && ID_RE.test(vid)) {
    var hash = await sha256(SALT + '|' + vid);
    var seenKey = SEEN_PREFIX + hash;
    var last = await kv.get(seenKey);
    isNew = !last;
    newToday = last !== today;
    if (isNew || newToday) {
      await kv.put(seenKey, today);
    }
  }

  var main = readMain(await kv.get(MAIN_KEY));
  if (isNew) main.v += 1;
  if (newToday) main.d[today] = (parseInt(main.d[today], 10) || 0) + 1;
  main.d = pruneDays(main.d);

  if (isNew || newToday) {
    await kv.put(MAIN_KEY, JSON.stringify(main));
  }

  var spark = lastDays(SPARK_DAYS).map(function (d) {
    return { d: d.slice(5), v: parseInt(main.d[d], 10) || 0 };
  });

  return json({
    ok: true,
    visitors: main.v,
    today: parseInt(main.d[today], 10) || 0,
    week: sumSince(main, 7),
    days: spark,
    counted: isNew || newToday,
    isNew: isNew,
    serverTime: new Date().toISOString()
  });
}

/* -------------------------------------------------------------------------- */
/* static assets (unchanged behaviour, plus a header safety net)              */
/* -------------------------------------------------------------------------- */

var ASSETS_CACHE = 'public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800';
var ICON_CACHE = 'public, max-age=604800';
var META_CACHE = 'public, max-age=3600';

function cacheHeaderFor(path) {
  if (path.indexOf('/assets/') === 0) return ASSETS_CACHE;
  if (path === '/sw.js') return 'no-cache, must-revalidate';   // updates must be seen
  if (path === '/favicon.ico' || path === '/favicon.svg' || path === '/apple-touch-icon.png'
    || path === '/icon-192.png' || path === '/icon-512.png' || path === '/maskable-512.png') return ICON_CACHE;
  if (path === '/sitemap.xml' || path === '/robots.txt' || path === '/llms.txt'
    || path === '/site.webmanifest') return META_CACHE;
  return null;
}

/* Mirrors _headers and is deliberately the AUTHORITATIVE layer.

   Why override instead of "only fill in the blanks": Cloudflare Pages hands
   static files its own Cache-Control (JS/CSS/text get `max-age=14400`,
   images get their own), and in Advanced Mode it is not reliable that the
   _headers file wins — observed live: /assets/* and /favicon.ico kept our
   values, while /sw.js and /robots.txt silently fell back to the 4-hour
   default. A service worker cached for 4 hours means users do not get the new
   shell after a deploy, so the worker must set this itself. */
function finalize(request, response) {
  try {
    var out = response;
    var path = new URL(request.url).pathname;
    var isHtml = (out.headers.get('content-type') || '').indexOf('text/html') !== -1;
    var isStats = path.indexOf('/stats') === 0;                 // owner-only page
    var cache = isHtml ? (isStats ? 'no-store, must-revalidate' : null) : cacheHeaderFor(path);
    /* Always overwrite, never "fill if missing": asset responses come back
       carrying the CSP from the _headers file, so a fill-if-missing patch
       would leave a stale policy in place after the worker's CSP changes
       (measured 2026-09-25: the transfer page shipped with the old policy
       because of exactly that). The two files must stay in sync, but this
       one wins. */
    var patchSecurity = isHtml;
    var patchCache = !!cache;
    /* A module served with the wrong Content-Type cannot be imported at all —
       the browser refuses a module whose MIME type is not a JavaScript one, and
       the page only sees a rejected promise. The HEIC decoder is loaded as a
       module, so its type is pinned here instead of trusting the platform's
       extension table. */
    var patchType = /\.mjs$/.test(path) && !/javascript/i.test(out.headers.get('content-type') || '');
    if (!patchSecurity && !patchCache && !patchType && !isStats) return out;

    out = new Response(out.body, out);
    if (patchSecurity) {
      Object.keys(SECURITY_HEADERS).forEach(function (k) {
        out.headers.set(k, SECURITY_HEADERS[k]);
      });
    }
    if (patchCache) out.headers.set('cache-control', cache);
    if (patchType) out.headers.set('content-type', 'text/javascript; charset=utf-8');
    if (isStats) out.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return out;
  } catch (e) {
    return response;
  }
}

export default {
  async fetch(request, env) {
    try {
      var url = new URL(request.url);
      if (url.hostname === 'www.' + APEX) {
        var moved = canonicalRedirect(url);
        if (moved) return moved;
      }
      if (url.pathname === '/api/count') {
        if (request.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        return withCORS(await handleCount(request, env));
      }
    } catch (e) {
      /* anything unexpected → behave like a plain static site */
    }

    try {
      if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        return finalize(request, await env.ASSETS.fetch(request));
      }
    } catch (e) {
      /* fall through */
    }
    return fetch(request);
  }
};
