/* Dev-only preview server rooted at the site folder.
   Serves static files AND a real /api/count backed by an in-memory KV,
   so the visitor counter can be exercised locally exactly as in production. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

/* SITE lets a test serve a throw-away copy of the site instead of the real
   folder — the update path needs to "ship a new version" without touching the
   working tree. Defaults to the real site, so every existing caller is
   unaffected. */
const SITE = process.env.SITE
  ? path.resolve(process.env.SITE)
  : path.join(__dirname, '..', 'localphototool');
const PORT = process.env.PORT || 8877;

/* CACHE_MODE=prod serves the headers the LIVE site actually sends, instead of
   a blanket no-cache. That blanket is convenient but it hides a whole class of
   bug: caching behaviour is the one thing a local preview otherwise never
   reproduces, which is how a service-worker update can look fine in dev and
   be broken in production.

   These values were captured from https://localphototool.com, and they are NOT
   the same as what _worker.js asks for. The worker sets /sw.js to
   "no-cache, must-revalidate"; Cloudflare's zone-level Browser Cache TTL treats
   its own value as a FLOOR and raises anything lower, so the live header comes
   back as "max-age=14400, must-revalidate". Emulating the observed result
   rather than the intent is the whole point — the intent is what is broken. */
const CACHE_MODE = process.env.CACHE_MODE || 'dev';
const ALLOW_HANG = process.env.ALLOW_HANG === '1';
function prodCacheHeader(p) {
  if (p.indexOf('/assets/') === 0) {
    return 'public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800';
  }
  if (p === '/sw.js') return 'max-age=14400, must-revalidate';
  if (/\.(ico|svg|png)$/.test(p)) return 'public, max-age=604800';
  if (p === '/sitemap.xml' || p === '/robots.txt' || p === '/site.webmanifest') return 'public, max-age=3600';
  return 'public, max-age=0, must-revalidate';          // HTML, incl. the clean URLs
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

/* ---------------------------- in-memory KV (dev stand-in) ---------------- */
const store = new Map();
const mockKV = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  put: async (k, v) => { store.set(k, String(v)); },
  delete: async (k) => { store.delete(k); },
  list: async () => ({ keys: [...store.keys()].map((name) => ({ name })) })
};

/* Cloudflare requires the file to be named _worker.js; Node needs .mjs to
   treat it as an ES module, so we import a throw-away copy. The name is keyed
   to the served root, otherwise two preview servers running at once would
   clobber each other's copy mid-import. */
const TMP = path.join(__dirname, '.tmp');
fs.mkdirSync(TMP, { recursive: true });
const workerCopy = path.join(TMP, 'worker-' +
  crypto.createHash('sha1').update(SITE).digest('hex').slice(0, 8) + '.mjs');

let workerPromise = null;
function loadWorker() {
  if (!workerPromise) {
    fs.copyFileSync(path.join(SITE, '_worker.js'), workerCopy);
    workerPromise = import(pathToFileURL(workerCopy).href + '?t=' + Date.now());
  }
  return workerPromise;
}

/* Production applies its security headers in _worker.js, so a dev server that
   omits them hides a whole class of bug: code that is green locally and dies
   under Content-Security-Policy once deployed. That is not hypothetical — a
   HEIC decoder whose Emscripten glue calls `new Function` runs fine here and
   throws live, and the only place it shows is the browser console of a paying
   visitor.

   Rather than copy the policy, we ask the real worker for it and cache the
   answer, so the two can never drift apart. */
let headerPromise = null;
function securityHeaders() {
  if (!headerPromise) {
    headerPromise = (async () => {
      try {
        const mod = await loadWorker();
        const res = await mod.default.fetch(new Request('http://localhost/'), {
          ASSETS: {
            fetch: async () => new Response('<html></html>', {
              headers: { 'content-type': 'text/html' }
            })
          }
        });
        const out = {};
        ['content-security-policy', 'x-content-type-options', 'x-frame-options',
          'referrer-policy', 'permissions-policy'].forEach((k) => {
          const v = res.headers.get(k);
          if (v) out[k] = v;
        });
        if (!out['content-security-policy']) {
          console.warn('!! no CSP came back from _worker.js — dev headers are NOT faithful');
        }
        return out;
      } catch (e) {
        console.warn('could not derive headers from _worker.js: ' + (e && e.message));
        return {};
      }
    })();
  }
  return headerPromise;
}

/* Mirrors _worker.js: the security headers go on HTML only, everything else
   keeps the local no-cache so tests always re-read the file under test. */
function extraHeaders(type) {
  return /text\/html/.test(type || '') ? securityHeaders() : Promise.resolve({});
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

async function handleApi(req, res, url) {
  if (url.searchParams.get('reset') === '1') {
    store.clear();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true,"reset":true}');
  }
  /* dev only: seed plausible history so the chart can be eyeballed */
  if (url.searchParams.get('demo') === '1') {
    var d = {};
    var shape = [6, 9, 14, 7, 3, 11, 18, 22, 16, 12, 25, 31, 19, 8];
    for (var i = 13; i >= 0; i--) {
      var day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      d[day] = shape[i];
    }
    store.set('lpt:main', JSON.stringify({ v: 1284, d: d }));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true,"demo":true}');
  }
  const raw = req.method === 'POST' ? await readBody(req) : undefined;
  const mod = await loadWorker();
  const request = new Request('http://localhost' + url.pathname + url.search, {
    method: req.method,
    headers: { 'content-type': 'application/json', 'user-agent': req.headers['user-agent'] || 'dev' },
    body: raw
  });
  const out = await mod.handleCount(request, { LPT_STATS: mockKV });
  const text = await out.text();
  res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

/* ---------------------------------- server ------------------------------- */
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/count') {
    handleApi(req, res, url).catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: String(err && err.message || err) }));
    });
    return;
  }

  /* A source that accepts the connection and never answers. Only reachable when
     a test asks for it (ALLOW_HANG=1) and only useful to one: engine.js keeps
     two URLs per codec so a rotted pin stays survivable, and "rotted" mostly
     means "hangs" rather than "404s". A 404 is already easy to stage with any
     bogus path; this is the case that needs a real socket. */
  if (ALLOW_HANG && url.pathname.startsWith('/__hang')) return;

  let p = decodeURIComponent(url.pathname);

  /* Cloudflare Pages strips the .html extension and 308-redirects to the clean
     URL (/offline.html → /offline). Mirroring that here is not cosmetic: a
     response that arrives through a redirect may not be replayed for a
     navigation request, so the difference only ever shows up in production —
     precisely where it is expensive to find. */
  const cleaned = p.endsWith('/index.html') ? p.slice(0, -'index.html'.length)
    : p.endsWith('.html') ? p.slice(0, -'.html'.length)
      : null;
  if (cleaned !== null && fs.existsSync(path.join(SITE, p))) {
    res.writeHead(308, { Location: cleaned || '/', 'Cache-Control': 'no-cache' });
    return res.end();
  }

  /* /foo → foo.html, and /dir → /dir/ (Pages serves the same pair of URLs). */
  if (p.endsWith('/')) {
    p += 'index.html';
  } else if (!path.extname(p) && fs.existsSync(path.join(SITE, p + '.html'))) {
    p += '.html';
  }

  const file = path.normalize(path.join(SITE, p));
  if (!file.startsWith(path.normalize(SITE + path.sep))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      return fs.readFile(path.join(SITE, '404.html'), (e2, d2) => {
        extraHeaders('text/html').then((extra) => {
          res.writeHead(404, Object.assign(
            { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, extra));
          res.end(e2 ? 'Not found' : d2);
        });
      });
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const cache = CACHE_MODE === 'prod' ? prodCacheHeader(p) : 'no-cache';
    extraHeaders(type).then((extra) => {
      res.writeHead(200, Object.assign(
        { 'Content-Type': type, 'Cache-Control': cache }, extra));
      res.end(data);
    });
  });
}).listen(PORT, () => console.log('localphototool preview → http://localhost:' + PORT + '/'));
