/* Unit tests for the visit counter in localphototool/_worker.js
   Run: node _dev/test-counter.cjs                                          */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SITE = path.join(__dirname, '..', 'localphototool');
const TMP = path.join(__dirname, '.tmp');
fs.mkdirSync(TMP, { recursive: true });
const copy = path.join(TMP, 'worker-test.mjs');
fs.copyFileSync(path.join(SITE, '_worker.js'), copy);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

function makeKV() {
  const store = new Map();
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, String(v)); },
    delete: async (k) => { store.delete(k); },
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })) })
  };
}

function count(id, opts) {
  opts = opts || {};
  return new Request('https://localphototool.com/api/count', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': opts.ua || 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128 Safari/537.36' },
    body: JSON.stringify({ v: id, p: opts.path || '/' })
  });
}

(async () => {
  const kv = makeKV();
  const env = { LPT_STATS: kv };
  const mod = await import(pathToFileURL(copy).href);
  const handle = mod.handleCount;

  console.log('\nVisit counter — unit tests\n');

  // 1. first ever visitor
  let r = await (await handle(count('visitor-aaaa-1111'), env)).json();
  ok('first visit is counted', r.ok && r.visitors === 1 && r.today === 1 && r.isNew === true, JSON.stringify(r));
  ok('14 daily buckets returned', Array.isArray(r.days) && r.days.length === 14, String(r.days && r.days.length));

  // 2. same visitor again, same day → de-duplicated
  r = await (await handle(count('visitor-aaaa-1111'), env)).json();
  ok('reload does not double count', r.visitors === 1 && r.today === 1, JSON.stringify(r));
  ok('repeat is flagged as not-counted', r.counted === false && r.isNew === false, JSON.stringify(r));

  // 3. a second person
  r = await (await handle(count('visitor-bbbb-2222'), env)).json();
  ok('second visitor increments', r.visitors === 2 && r.today === 2, JSON.stringify(r));

  // 4. a third person, different day simulation (pretend b was seen yesterday)
  const seenKey = [...kv.store.keys()].find((k) => k.startsWith('lpt:v:'));
  ok('visitor hash stored, not the raw id', !!seenKey && !kv.store.has('visitor-aaaa-1111'));
  kv.store.set(seenKey, '2020-01-01');
  r = await (await handle(count('visitor-aaaa-1111'), env)).json();
  ok('returning on a new day counts for today only', r.visitors === 2 && r.today === 3, JSON.stringify(r));

  // 5. bots
  r = await (await handle(count('visitor-cccc-3333', { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }), env)).json();
  ok('crawlers are rejected', r.ok === false && r.reason === 'bot', JSON.stringify(r));
  r = await (await handle(count('visitor-dddd-4444', { ua: 'curl/8.4.0' }), env)).json();
  ok('curl is rejected', r.ok === false && r.reason === 'bot');
  r = await (await handle(count('visitor-eeee-5555', { ua: 'HeadlessChrome/128' }), env)).json();
  ok('headless automation is rejected', r.ok === false && r.reason === 'bot');

  // 6. malformed / missing id → never inflates the number
  const before = (await (await handle(count('visitor-ffff-6666'), env)).json()).visitors;
  r = await (await handle(count('x'), env)).json();
  ok('short id is ignored', r.ok === true && r.visitors === before, JSON.stringify(r));
  r = await (await handle(count(''), env)).json();
  ok('missing id still returns totals', r.ok === true && r.visitors === before);

  // 7. GET = peek, no counting
  const peek = new Request('https://localphototool.com/api/count', { method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 Chrome/128' } });
  r = await (await handle(peek, env)).json();
  ok('GET peek does not count', r.ok === true && r.visitors === before, JSON.stringify(r));

  // 8. no KV bound → silent, site keeps working
  r = await (await handle(count('visitor-gggg-7777'), { ASSETS: { fetch: async () => new Response('x') } })).json();
  ok('works without a KV binding (ok:false)', r.ok === false && r.reason === 'kv-not-bound', JSON.stringify(r));

  // 8b. the owner's own dashboard is a read-out, not a visit
  r = await (await handle(count('visitor-zzzz-0000', { path: '/stats/' }), env)).json();
  ok('a dashboard view adds no visitor', r.visitors === before && r.counted === false, JSON.stringify(r));
  r = await (await handle(count('visitor-zzzz-0000', { path: '/stats' }), env)).json();
  ok('the dashboard URL without a trailing slash is exempt too', r.visitors === before, JSON.stringify(r));
  r = await (await handle(count('visitor-zzzz-0000', { path: '/compress/' }), env)).json();
  ok('the same browser on a normal page still counts', r.visitors === before + 1, JSON.stringify(r));

  // 9. corrupted stored value must not break the page
  kv.store.set('lpt:main', '{not json');
  r = await (await handle(count('visitor-hhhh-8888'), env)).json();
  ok('recovers from corrupted counter', r.ok === true && r.visitors === 1, JSON.stringify(r));

  // 10. static pass-through + header safety net
  const assetEnv = {
    ASSETS: {
      fetch: async () => new Response('<html><body>hi</body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }
  };
  const page = await mod.default.fetch(new Request('https://localphototool.com/'), assetEnv);
  ok('static pages are served', page.status === 200 && (await page.text()).indexOf('hi') !== -1);
  ok('CSP is applied to HTML', (page.headers.get('content-security-policy') || '').indexOf('wasm-unsafe-eval') !== -1);
  const css = await mod.default.fetch(new Request('https://localphototool.com/assets/css/style.css'), {
    ASSETS: { fetch: async () => new Response('body{}', { headers: { 'content-type': 'text/css' } }) }
  });
  ok('assets without CSP are left alone', css.headers.get('content-security-policy') === null);
  ok('assets get the long cache header if _headers did not apply',
    /max-age=86400/.test(css.headers.get('cache-control') || ''), css.headers.get('cache-control') || 'none');

  /* The worker is the authoritative header layer, not a fill-in-the-blanks
     patch. Cloudflare Pages hands static files its own Cache-Control (seen
     live: JS/CSS/text get max-age=14400), and a service worker cached for
     hours means a deploy never reaches returning visitors — so ours must win. */
  const swRes = await mod.default.fetch(new Request('https://localphototool.com/sw.js'), {
    ASSETS: {
      fetch: async () => new Response('self.addEventListener("x",function(){})', {
        headers: { 'content-type': 'application/javascript', 'cache-control': 'max-age=14400, must-revalidate' }
      })
    }
  });
  ok('the worker overrides a platform cache header for /sw.js',
    /no-cache/.test(swRes.headers.get('cache-control') || ''), swRes.headers.get('cache-control'));
  ok('the service worker keeps a JavaScript content type',
    /javascript/.test(swRes.headers.get('content-type') || ''), swRes.headers.get('content-type'));

  const css2 = await mod.default.fetch(new Request('https://localphototool.com/assets/css/style.css'), {
    ASSETS: {
      fetch: async () => new Response('body{}', {
        headers: { 'content-type': 'text/css', 'cache-control': 'public, max-age=99' }
      })
    }
  });
  ok('a too-short asset cache header is raised by the worker',
    /max-age=86400/.test(css2.headers.get('cache-control') || ''), css2.headers.get('cache-control'));

  const statsPage = await mod.default.fetch(new Request('https://localphototool.com/stats/'), {
    ASSETS: {
      fetch: async () => new Response('<html><body>dash</body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }
  });
  ok('the private dashboard is never cached',
    /no-store/.test(statsPage.headers.get('cache-control') || ''), statsPage.headers.get('cache-control'));
  ok('the private dashboard stays out of search engines',
    /noindex/.test(statsPage.headers.get('x-robots-tag') || ''), statsPage.headers.get('x-robots-tag') || 'none');

  const icon = await mod.default.fetch(new Request('https://localphototool.com/favicon.ico'), {
    ASSETS: { fetch: async () => new Response('ico', { headers: { 'content-type': 'image/x-icon' } }) }
  });
  ok('icons get a week of cache', /max-age=604800/.test(icon.headers.get('cache-control') || ''),
    icon.headers.get('cache-control') || 'none');

  /* www is attached to the same Pages project, so it serves a duplicate copy of
     every page. Both the path and the query string must survive the hop. */
  let assetsAsked = 0;
  const wwwRes = await mod.default.fetch(new Request('https://www.localphototool.com/compress/?utm=1'), {
    ASSETS: { fetch: async () => { assetsAsked++; return new Response('x'); } }
  });
  ok('www is 301-redirected to the apex host',
    wwwRes.status === 301 && wwwRes.headers.get('location') === 'https://localphototool.com/compress/?utm=1',
    wwwRes.status + ' → ' + (wwwRes.headers.get('location') || 'no location'));
  ok('the redirect never reaches the asset store', assetsAsked === 0, 'asset fetches: ' + assetsAsked);

  const wwwRoot = await mod.default.fetch(new Request('https://www.localphototool.com/'), {
    ASSETS: { fetch: async () => new Response('x') }
  });
  ok('the www root redirects to the apex root',
    wwwRoot.headers.get('location') === 'https://localphototool.com/', wwwRoot.headers.get('location') || 'none');

  const apex = await mod.default.fetch(new Request('https://localphototool.com/'), assetEnv);
  ok('the canonical host is never redirected', apex.status === 200, 'status ' + apex.status);

  const home2 = await mod.default.fetch(new Request('https://localphototool.com/'), {
    ASSETS: {
      fetch: async () => new Response('<html></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'" }
      })
    }
  });
  ok('an existing CSP is not duplicated', home2.headers.get('content-security-policy') === "default-src 'self'");
  ok('HTML gets no forced cache-control (edge rules stay in charge)',
    home2.headers.get('cache-control') === null, home2.headers.get('cache-control'));

  // 10b. only this site may count
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36';
  const cross = new Request('https://localphototool.com/api/count', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://spam.example' },
    body: JSON.stringify({ v: 'visitor-spam-9999' })
  });
  r = await (await handle(cross, env)).json();
  ok('other origins cannot inflate the counter', r.ok === false && r.reason === 'cross-origin', JSON.stringify(r));

  const cur = (await (await handle(new Request('https://localphototool.com/api/count', {
    method: 'GET', headers: { 'user-agent': UA }
  }), env)).json()).visitors;
  const same = new Request('https://localphototool.com/api/count', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://localphototool.com' },
    body: JSON.stringify({ v: 'visitor-same-8888' })
  });
  r = await (await handle(same, env)).json();
  ok('same-origin POST is counted', r.ok === true && r.visitors === cur + 1, JSON.stringify(r));

  // 11. malformed request body must not throw
  const bad = new Request('https://localphototool.com/api/count', {
    method: 'POST', body: 'this-is-not-json',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/128' }
  });
  r = await (await handle(bad, env)).json();
  ok('malformed body is handled', r.ok === true && typeof r.visitors === 'number', JSON.stringify(r));

  // 12. /api/count never blocks other routes
  const viaWorker = await mod.default.fetch(new Request('https://localphototool.com/api/count', {
    method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 Chrome/128' }
  }), env);
  const viaWorkerBody = await viaWorker.json();
  ok('worker routes /api/count correctly', viaWorkerBody.ok === true && typeof viaWorkerBody.visitors === 'number');
  ok('CORS header present for reuse', viaWorker.headers.get('access-control-allow-origin') === '*');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
