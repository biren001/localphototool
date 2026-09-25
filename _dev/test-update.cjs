/* Service-worker update path, end to end.

   The question this answers: once someone has the site installed — a phone
   that added it to the home screen, a desktop tab left open — does a new
   deploy ever reach them, or do they keep running the old version forever?

   Four links in that chain, each of which has a way to break silently:

     1. /sw.js must never be cached for long. A service worker script served
        with Cloudflare's 4-hour default means the browser keeps reading the
        OLD script, sees nothing new, and the deploy never lands. _worker.js
        asks for "no-cache" here — and the live site does NOT get it back, see
        the CACHE_MODE=prod note below.
     2. The new worker has to call skipWaiting() and clients.claim(), or it sits
        in "waiting" until every tab of the site is closed — which, for an
        installed app, may be never.
     3. activate has to delete the previous version's caches. Otherwise the old
        shell is still on disk and can still be served.
     4. The new shell has to be filled from the NETWORK, not the HTTP cache:
        /assets/* goes out with max-age=86400, so an ordinary re-fetch would
        hand back yesterday's bytes. The install handler asks for
        cache: 'reload' for exactly this reason.

   How the test runs: the site is copied to a scratch folder, served from
   there, and "shipped" twice — the copy exists so that bumping a version
   number never touches the working tree. One page plays the installed app and
   is never navigated; a second page is used to poke the registration.

   Caveat on coverage: this dev server answers every static file with no-cache
   unless CACHE_MODE=prod is set, and an optimistic run would not exercise the
   hazard cache: 'reload' exists to defeat. So this test asks for prod headers
   by default (set CACHE_MODE=dev to get the optimistic ones back). That is the
   opposite of the server's own default on purpose: every other suite wants a
   quiet, cache-free environment, while the only thing this one is about is
   caching.

       node _dev/test-update.cjs                 # prod headers (realistic)
       CACHE_MODE=dev node _dev/test-update.cjs  # blanket no-cache

   What this cannot tell you: iOS Safari is not testable here, and it is the
   one engine with a history of serving a stale service-worker script. Chromium
   is covered; treat iPhone behaviour as unverified.
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8903;
const BASE = 'http://127.0.0.1:' + PORT;
const SRC = path.join(__dirname, '..', 'localphototool');
const WORK = path.join(__dirname, '.tmp', 'upd');
const SITE = path.join(WORK, 'site');
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const MARK_A = 'BUILD-A';
const MARK_B = 'BUILD-B';
const VER_A = 'vTESTA';
const VER_B = 'vTESTB';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function info(msg) { console.log('  INFO  ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Best-effort: a sandbox that refuses large recursive deletes must not be able
   to fail the suite. Leftovers are harmless — the next run copies over them. */
function dropScratch(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* Ship a new version into the scratch copy: bump sw.js, restamp a file the
   shell precaches, and stamp the HTML so a page can report which build it is
   showing. Idempotent, so the test can be re-run without accumulating marks. */
function deploy(version, marker) {
  const swPath = path.join(SITE, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  if (!/var VERSION = '[^']+';/.test(sw)) throw new Error('no VERSION found in sw.js');
  fs.writeFileSync(swPath, sw.replace(/var VERSION = '[^']+';/, "var VERSION = '" + version + "';"));

  const jsPath = path.join(SITE, 'assets/js/chime.js');
  const js = fs.readFileSync(jsPath, 'utf8').replace(/\n\/\* BUILD:[^*]*\*\/\n?/g, '');
  fs.writeFileSync(jsPath, js + '\n/* BUILD:' + marker + ' */\n');

  const htmlPath = path.join(SITE, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8').replace(/<meta name="x-build"[^>]*>\s*/g, '');
  fs.writeFileSync(htmlPath, html.replace('<head>', '<head>\n<meta name="x-build" content="' + marker + '">'));
}

/* Poll until a shell cache for `version` exists on the page's origin. */
async function waitForShell(page, version, ms) {
  const until = Date.now() + ms;
  const want = 'lpt-shell-' + version;
  while (Date.now() < until) {
    const keys = await page.evaluate(() => caches.keys()).catch(() => null);
    if (keys && keys.indexOf(want) !== -1) return true;
    await sleep(150);
  }
  return false;
}

const build = (page) => page.evaluate(
  () => (document.querySelector('meta[name="x-build"]') || {}).content || null);

(async () => {
  dropScratch(WORK);
  copyDir(SRC, SITE);
  deploy(VER_A, MARK_A);          // the build the visitor "already has installed"

  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      SITE: SITE,
      CACHE_MODE: process.env.CACHE_MODE || 'prod'
    }),
    stdio: 'ignore'
  });
  await sleep(900);

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  try {
    console.log('\nService worker update path — browser tests\n');
    const cacheMode = process.env.CACHE_MODE || 'prod';
    info('cache mode: ' + (cacheMode === 'prod'
      ? 'prod — the headers the live site really sends'
      : 'dev — blanket no-cache, optimistic about caching bugs'));

    /* ---- static: the two invariants the whole chain rests on ---------- */
    const worker = fs.readFileSync(path.join(SRC, '_worker.js'), 'utf8');
    const swSrc = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');

    ok('/sw.js is sent as revalidating, never as a long-lived asset',
      /path === '\/sw\.js'\) return 'no-cache/.test(worker),
      'a cached sw.js means the browser never reads the new script and the deploy never lands');
    ok('the new worker skips the waiting phase', /self\.skipWaiting\(\)/.test(swSrc));
    ok('the new worker takes over pages that are already open', /self\.clients\.claim\(\)/.test(swSrc));
    ok('activate drops the previous versions caches', /caches\.delete\(n\)/.test(swSrc));

    /* cache: 'reload' is what keeps the precache off the HTTP cache; without
       it a bumped version could still be filled with stale bytes. */
    ok('the precache bypasses the HTTP cache', /cache: 'reload'/.test(swSrc),
      'assets/* is served with max-age=86400 in production');

    /* A typo in SHELL is a silent hole: the file simply never gets cached and
       the site is broken offline for one page only. */
    const from = swSrc.indexOf('var SHELL = [');
    const shellBlock = swSrc.slice(from, swSrc.indexOf('].map(', from));
    const shellPaths = (shellBlock.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1));
    const missing = shellPaths.filter((p) => {
      if (p === '') return !fs.existsSync(path.join(SITE, 'index.html'));
      if (p.endsWith('/')) return !fs.existsSync(path.join(SITE, p, 'index.html'));
      return !fs.existsSync(path.join(SITE, p));
    });
    ok('every path the shell precaches exists', shellPaths.length > 10 && missing.length === 0,
      missing.length ? 'missing: ' + missing.join(', ') : 'only ' + shellPaths.length + ' entries');

    /* ---- 1. the installed copy, before any deploy --------------------- */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const app = await ctx.newPage();          // never navigated: it stands in for the open app
    await app.goto(BASE + '/', { waitUntil: 'load' });
    await app.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 })
      .catch(() => {});
    await sleep(600);

    /* The static check above reads the INTENT out of _worker.js. What the
       browser actually receives is what decides, and the two do not match in
       production: Cloudflare's zone-level Browser Cache TTL is a floor, so the
       "no-cache" the worker asks for for /sw.js comes back as
       "max-age=14400, must-revalidate". Print the real value so the gap is
       visible on every run, and fail only if it stops revalidating at all —
       Chromium fetches the worker script past the HTTP cache, so a max-age
       alone does not block an update, but an immutable or no-revalidate header
       would. */
    const swCache = String((await app.request.get(BASE + '/sw.js')).headers()['cache-control'] || '');
    info('/sw.js cache-control as served: "' + swCache + '"');
    ok('/sw.js at least revalidates',
      /must-revalidate|no-cache|no-store/.test(swCache) && !/immutable/.test(swCache),
      swCache);
    if (cacheMode === 'prod' && !/^no-cache/.test(swCache)) {
      info('the live floor wins over the worker: set Browser Cache TTL to "Respect Existing Headers" to get the no-cache _worker.js asks for');
    }

    const before = await app.evaluate(async () => ({
      controlled: !!navigator.serviceWorker.controller,
      caches: await caches.keys()
    }));
    ok('the visited site is controlled by a service worker', before.controlled === true);
    ok('the open page is running build A', (await build(app)) === MARK_A, String(await build(app)));
    ok('the shell is precached under the current version',
      before.caches.indexOf('lpt-shell-' + VER_A) !== -1, before.caches.join(', '));

    /* ---- 2. ship build B and let an ordinary navigation find it ------- */
    deploy(VER_B, MARK_B);

    const t0 = Date.now();
    const helper = await ctx.newPage();
    await helper.goto(BASE + '/about/', { waitUntil: 'load' });
    const natural = await waitForShell(helper, VER_B, 6000);
    info('an ordinary page load ' + (natural
      ? 'picked up the new version in ' + (Date.now() - t0) + ' ms'
      : 'did NOT pick up the new version within 6 s — falling back to an explicit update()'));

    if (!natural) {
      await app.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      ok('an explicit update() still installs the new version',
        await waitForShell(helper, VER_B, 10000));
    }

    /* ---- 3. it activates and cleans up, with the tab still open ------ */
    const purged = await (async () => {
      const until = Date.now() + 12000;
      while (Date.now() < until) {
        const keys = await helper.evaluate(() => caches.keys()).catch(() => []);
        const hasNew = keys.some((k) => k === 'lpt-shell-' + VER_B);
        const hasOld = keys.some((k) => k.indexOf('lpt-shell-' + VER_A) === 0);
        if (hasNew && !hasOld) return keys;
        await sleep(150);
      }
      return null;
    })();

    ok('the new version activates without closing the tab', purged !== null,
      purged === null ? 'old caches still present: ' + (await helper.evaluate(() => caches.keys())).join(', ') : '');
    ok('the caches of the previous version are gone',
      purged !== null && !purged.some((k) => k.indexOf('lpt-shell-' + VER_A) === 0));
    ok('exactly one shell cache is kept',
      purged !== null && purged.filter((k) => k.indexOf('lpt-shell-') === 0).length === 1,
      purged === null ? '' : purged.join(', '));

    /* ---- 4. the page that was left open ----------------------------- */
    const live = await app.evaluate(async () => {
      const text = await fetch('/assets/js/chime.js').then((r) => r.text());
      return {
        build: (document.querySelector('meta[name="x-build"]') || {}).content || null,
        fresh: text.indexOf('BUILD-B') !== -1,
        stale: text.indexOf('BUILD-A') !== -1
      };
    });
    ok('the open session is not interrupted mid-task',
      live.build === MARK_A,
      'the page keeps its DOM until it is reloaded — never yank the tool out from under someone converting');
    ok('but its cached assets are already the new ones',
      live.fresh === true && live.stale === false,
      'fresh=' + live.fresh + ' stale=' + live.stale);

    await app.reload({ waitUntil: 'load' });
    ok('a reload brings the new build into the page', (await build(app)) === MARK_B, String(await build(app)));

    /* ---- 5. the freshly installed shell still works offline ---------- */
    await ctx.setOffline(true);
    const reached = await app.goto(BASE + '/compress/', { waitUntil: 'load' })
      .then(() => true).catch(() => false);
    await sleep(500);
    const hasDropzone = reached && (await app.$('#dropzone')) !== null;
    ok('the newly installed shell still works with the network off', hasDropzone === true,
      'a version bump that leaves the shell half-filled breaks offline use for exactly one deploy');
    await ctx.setOffline(false);

    await ctx.close();
  } catch (err) {
    fail++;
    console.log('  FAIL  the update run threw  → ' + (err && err.stack || err));
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    dropScratch(WORK);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
