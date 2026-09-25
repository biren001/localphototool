/* Codec warm-up — what the page downloads, and when.

   The WASM encoders are the only slow first step in the tool: they come from a
   CDN and AOM (AVIF) alone is ~1.7 MB. They used to be fetched the moment the
   page opened, which had two separate costs, and only one of them is about
   bandwidth:

     · every visitor paid it, including the ones who read the page and left.
       Measured on the old code: 24 CDN requests before anyone touched anything.
     · it raced the codec the visitor had explicitly asked for. Picking AVIF
       could mean watching its download lose to its own warm-up, miss the
       patience budget, and come back as WebP — the one outcome the format
       control exists to prevent.

   That second cost is why the engine now keeps two budgets per codec rather
   than one: WASM_FETCH_TIMEOUTS for the module, WASM_WARM_TIMEOUTS for the
   first encode that compiles it. A single budget could not tell "this host is
   dead" apart from "this codec is still compiling", and the measured numbers
   are nowhere near each other — MozJPEG needs 4.6s + 12.6s, AOM 2.8s + 8.7s
   (32.3s seen). Section D is what holds the falling-through honest.

   Codecs now start on intent (a tap on the drop zone, a format choice, a drag,
   a paste) and only for the formats the current settings can reach. Four
   passes, each with its own browser context so nothing leaks between them:

     A. the compressor — nothing on load, exactly what 'auto' can output on
        intent, once per worker, and a real compression still lands as WebP
     B. AVIF by hand — the encoder starts with no file in sight, and a file that
        arrives while it is still downloading is still served by that one
        download, then encoded as AVIF
     C. /heic-to-jpg/ — a pinned format means jpeg only, not the other two
     D. a codec source that hangs — engine.js keeps two URLs per codec so a
        rotted pin stays survivable, but a pin that rots usually *hangs* rather
        than 404s, and the fallback used to be reachable only when a source
        threw. Staged against a local endpoint that accepts and never answers.

   Why count requests instead of reading the source: the warm-up set, the saved
   settings and the pipeline all get a say in what is fetched, and the network
   log is the only place the result of that argument shows up.

   Run: node _dev/test-warmup.cjs
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8912, BASE = 'http://127.0.0.1:' + PORT;
const PORT2 = 8914, BASE2 = 'http://127.0.0.1:' + PORT2;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const FIXTURE = path.join(__dirname, 'fixtures', 'photo.jpg');
/* A real browser UA: the server's bot rules drop HeadlessChrome. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CODECS = ['jpeg', 'webp', 'avif'];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function info(msg) { console.log('  INFO  ' + msg); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Only the module's own entry URL counts. The transitive bits esm.sh pulls in
   (the es2022 wrapper, the .wasm itself) follow whatever the entry fetch did,
   so counting them would multiply one fact by three. */
function entryCodec(url) {
  const m = /esm\.sh\/@jsquash\/(jpeg|webp|avif)@[\d.]+$/.exec(url);
  return m ? m[1] : null;
}
const countOf = (list, codec) => list.filter((u) => entryCodec(u) === codec).length;
const cdnTotal = (list) => CODECS.reduce((n, c) => n + countOf(list, c), 0);
const isCdn = (url) => /esm\.sh\/|cdn\.jsdelivr\.net\//.test(url);

/* What the user actually receives. The obvious way to read a result would be
   fetch(img.src), but that is a blob: URL and the site's connect-src does not
   list blob: — the browser refuses, correctly. Downloading the file and looking
   at its magic bytes is both allowed and the more honest check. */
function sniff(buf) {
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (/avif|avis/.test(brand)) return 'image/avif';
    if (/heic|heif|mif1/.test(brand)) return 'image/heic';
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' &&
      buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  return 'unknown';
}

async function waitFor(fn, ms, every) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > (ms || 30000)) return false;
    await sleep(every || 250);
  }
}

/* Cleanup of our own scratch space is best-effort on purpose: some managed
   sandboxes refuse large recursive deletes, and a refused cleanup must never
   turn into a test failure. A leftover directory is harmless — the next run
   copies over it file by file. */
function dropScratch(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); }
  catch (e) { /* stale files remain; cpSync overwrites them */ }
}

/* A copy of the site whose first AVIF source never answers, so the fall-through
   from one source to the next is exercised for real. Copying rather than
   patching in place: the working tree is never a test fixture. */
function siteWithHangingFirstSource() {
  const root = path.join(__dirname, '.tmp', 'fallback');
  dropScratch(root);
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'localphototool'), root, { recursive: true });
  const eng = path.join(root, 'assets', 'js', 'compressor', 'engine.js');
  const src = fs.readFileSync(eng, 'utf8');
  const patched = src.replace(/avif: \[[^\]]*\]/,
    "avif: ['" + BASE2 + "/__hang/avif-never.mjs', 'https://esm.sh/@jsquash/avif@2.1.1']");
  if (patched === src) throw new Error('could not patch WASM_URLS.avif — its shape changed');
  fs.writeFileSync(eng, patched);
  return root;
}

(async () => {
  const servers = [];
  const spawnSite = async (port, env) => {
    const s = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
      env: Object.assign({}, process.env, { PORT: String(port) }, env || {}),
      stdio: 'ignore'
    });
    servers.push(s);
    await sleep(900);
    return s;
  };
  await spawnSite(PORT);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  /* Open a page and watch every request it makes. Resolves only once the tool
     has booted — an empty #engineStatus would let "no requests" pass for the
     wrong reason (a page that never started). */
  async function open(url, base) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: UA });
    const page = await ctx.newPage();
    const cdn = [];
    const all = [];
    const errors = [];
    page.on('request', (r) => { all.push(r.url()); if (isCdn(r.url())) cdn.push(r.url()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto((base || BASE) + url, { waitUntil: 'load' });
    const booted = await waitFor(async () => {
      const t = await page.textContent('#engineStatus').catch(() => '');
      return !!t && t.trim().length > 0;
    }, 20000, 150);
    if (!booted) errors.push('the tool never booted (' + url + ')');
    return { ctx, page, cdn, all, errors, url };
  }

  async function poolSize(page) {
    const m = /Background workers ×(\d+)/.exec(await statusText(page));
    return m ? Number(m[1]) : 0;
  }
  async function statusText(page) {
    return (await page.textContent('#engineStatus').catch(() => '')) || '';
  }
  const resultSrc = (page) => page.evaluate(() => {
    const img = document.querySelector('.result img[src^="blob:"]');
    return img ? img.getAttribute('src') : null;
  });
  async function save(page) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 25000 }),
      page.click('.result [data-act="download"]')
    ]);
    return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
  }
  async function deliver(page, waitMs) {
    if (!await waitFor(async () => (await resultSrc(page)) !== null, waitMs || 150000, 300)) return 'no result appeared';
    try { return sniff((await save(page)).bytes); } catch (e) { return 'download failed: ' + e.message; }
  }

  console.log('\nCodec loading — what is fetched, and when\n');

  try {
    ok('the test fixture exists', fs.existsSync(FIXTURE), FIXTURE);

    /* ---- A. the compressor ------------------------------------------ */
    console.log('\n  [A] /compress/, format "auto"');
    const a = await open('/compress/');
    await sleep(2500);   // a page-load warm-up would have fired long before this

    ok('the tool boots and reports its engine',
      (await statusText(a.page)).indexOf('Processing') >= 0, a.errors[0] || 'no status rendered');
    ok('reading the page downloads no codec at all', cdnTotal(a.cdn) === 0,
      a.cdn.length + ' CDN request(s) before any interaction' +
        (a.cdn.length ? ': ' + a.cdn.slice(0, 2).join(', ') : ''));

    const na = await poolSize(a.page);
    info('worker pool size reported by the page: ' + na);
    ok('the pool reports at least one worker', na >= 1, 'got ' + na);

    await a.page.dispatchEvent('#dropzone', 'pointerdown');
    const warmed = await waitFor(() => countOf(a.cdn, 'webp') >= na && countOf(a.cdn, 'jpeg') >= na, 30000);
    ok('reaching for the tool starts the codecs "auto" can output', warmed,
      'webp=' + countOf(a.cdn, 'webp') + ' jpeg=' + countOf(a.cdn, 'jpeg') + ' (expected >= ' + na + ' each)');
    ok('and nothing beyond those', countOf(a.cdn, 'avif') === 0,
      'avif=' + countOf(a.cdn, 'avif') + ' — "auto" cannot select AVIF, so warming it is dead weight');

    await sleep(2000);   // give a duplicate fetch time to show up if there is one
    ok('each codec is fetched exactly once per worker',
      countOf(a.cdn, 'webp') === na && countOf(a.cdn, 'jpeg') === na,
      'webp=' + countOf(a.cdn, 'webp') + ' jpeg=' + countOf(a.cdn, 'jpeg') + ' for ' + na + ' worker(s)');

    /* Waited out to the engine's own worst case rather than to a guess: the
       panel flips once the probe encode finishes, and a cold MozJPEG compiles
       for 12.6s here. A shorter wait would fail the engine for being honest. */
    ok('the engine panel reflects a codec as it lands',
      await waitFor(async () => /MozJPEG \(WASM\)/.test(await statusText(a.page)), 45000, 500),
      (await statusText(a.page)).replace(/\s+/g, ' ').slice(0, 120));

    await a.page.setInputFiles('#fileInput', FIXTURE);
    ok('a compression still completes',
      await waitFor(async () => !!(await a.page.$('.result [data-act="download"]')), 120000, 400));
    const auto = await save(a.page);
    ok('...as WebP, which is what "auto" picks for a photo',
      sniff(auto.bytes) === 'image/webp', auto.name + ' → ' + sniff(auto.bytes) + ' (' + auto.bytes.length + ' B)');
    ok('no page errors along the way', a.errors.length === 0, a.errors.slice(0, 2).join(' | '));

    /* ---- B. AVIF chosen by hand ------------------------------------- */
    console.log('\n  [B] /compress/, AVIF chosen before any file exists');
    const b = await open('/compress/');
    await sleep(2500);
    const nb = await poolSize(b.page);

    await b.page.click('label[for="fmtAvif"]');
    const avifStarted = await waitFor(() => countOf(b.cdn, 'avif') >= 1, 20000, 150);
    ok('picking AVIF starts its encoder with no file in sight', avifStarted,
      'avif=' + countOf(b.cdn, 'avif') + ' after the click');
    ok('choosing AVIF does not drag in the other codecs',
      countOf(b.cdn, 'webp') === 0 && countOf(b.cdn, 'jpeg') === 0,
      'webp=' + countOf(b.cdn, 'webp') + ' jpeg=' + countOf(b.cdn, 'jpeg'));

    /* For the race below to mean anything the codec must still be missing when
       the file lands — otherwise everything after this is a cache hit and
       proves nothing. The status panel is the only view of worker codec state,
       so it doubles as the guard: not "AOM (WASM)" yet means still loading. */
    const stillLoading = !/AOM \(WASM\)/.test(await statusText(b.page));
    ok('the encoder is still downloading when the file arrives', avifStarted && stillLoading,
      stillLoading ? 'ok' : 'already warm — this pass would be vacuous');

    /* Drop a file in while that download is in flight. The pipeline wants the
       same codec at the same moment — the exact race the shared promise in
       loadWasm exists for. Without it, each caller runs its own probe encode. */
    await b.page.setInputFiles('#fileInput', FIXTURE);
    ok('the encode finishes while that download was still running',
      await waitFor(async () => (await resultSrc(b.page)) !== null, 150000, 300),
      'no result appeared');

    let avifType = 'no download', avifBytes = null;
    try {
      const f = await save(b.page);
      avifBytes = f.bytes;
      avifType = sniff(f.bytes) + ' · ' + f.name;
    } catch (e) { avifType = 'download failed: ' + e.message; }
    /* When this does come out as WebP the panel already says which half of the
       load ran out of road ("encoder download timed out" vs "too slow to
       start"), so carry it into the failure line — "unavailable" on its own
       sends the reader hunting through timeouts. */
    ok('...and the file it hands over is AVIF', /^image\/avif/.test(avifType),
      avifType + '   [engine] ' + (await statusText(b.page)).replace(/\s+/g, ' ').slice(0, 110));
    if (avifBytes) {
      info('handed to the user: ' + auto.bytes.length + ' B as WebP → ' + avifBytes.length + ' B as AVIF');
    }

    /* Guards the outcome, not the mechanism: one codec, one download per
       worker, however many callers wanted it at that instant. The browser's
       module map does most of that on its own; the shared promise in loadWasm
       covers the rest (probe encodes, the fallback walk). The assertion is here
       because "AVIF is warmed early" is a claim about the wire. */
    ok('two callers wanting one codec still means one download per worker',
      countOf(b.cdn, 'avif') === nb,
      'avif=' + countOf(b.cdn, 'avif') + ' for ' + nb + ' worker(s)');
    ok('the encoder that arrived is the one actually used',
      await waitFor(async () => /AOM \(WASM\)/.test(await statusText(b.page)), 20000, 500),
      (await statusText(b.page)).replace(/\s+/g, ' ').slice(0, 120));
    ok('no page errors during the race', b.errors.length === 0, b.errors.slice(0, 2).join(' | '));

    /* ---- C. the converter page pins its own format ------------------- */
    console.log('\n  [C] /heic-to-jpg/, format pinned to jpeg');
    const c = await open('/heic-to-jpg/');
    await sleep(2500);
    ok('the converter page loads nothing up front either', cdnTotal(c.cdn) === 0,
      'CDN requests before interaction: ' + c.cdn.length);

    await c.page.dispatchEvent('#dropzone', 'pointerdown');
    const nc = await poolSize(c.page);
    const jpegOnly = await waitFor(() => countOf(c.cdn, 'jpeg') >= nc, 30000);
    await sleep(2000);
    ok('it warms only the format its page pins — jpeg, not the others',
      jpegOnly && countOf(c.cdn, 'jpeg') === nc && countOf(c.cdn, 'webp') === 0 && countOf(c.cdn, 'avif') === 0,
      'jpeg=' + countOf(c.cdn, 'jpeg') + ' webp=' + countOf(c.cdn, 'webp') + ' avif=' + countOf(c.cdn, 'avif') +
        ' for ' + nc + ' worker(s)');

    /* ---- D. a codec source that rots -------------------------------- */
    console.log('\n  [D] /compress/ with a first AVIF source that never answers');
    await spawnSite(PORT2, { SITE: siteWithHangingFirstSource(), ALLOW_HANG: '1' });
    const d = await open('/compress/', BASE2);
    await sleep(2000);
    await d.page.click('label[for="fmtAvif"]');
    ok('the first source really is tried first',
      await waitFor(() => d.all.some((u) => u.indexOf('/__hang/') >= 0), 20000, 200),
      'nothing ever requested the hanging endpoint');
    ok('the second source is fetched as well, not instead of giving up',
      await waitFor(() => countOf(d.cdn, 'avif') >= 1, 60000, 300),
      'avif entry requests: ' + countOf(d.cdn, 'avif') + ' — the fall-through never ran');
    /* Only now hand over a file: the two assertions above are about what the
       format choice alone kicked off, and the fall-through has to happen while
       the pipeline is watching. */
    await d.page.setInputFiles('#fileInput', FIXTURE);
    const fallbackType = await deliver(d.page, 180000);
    /* The guard this replaces was `output must be AVIF`. That is too absolute:
       the hanging source legitimately burns a whole fetch budget first, and what
       is left may not be enough to download, instantiate and encode AVIF — so
       the engine does what it is designed to do and hands back WebP. A
       permanently dead AVIF still fails, because the fall-through assertion
       above would never have passed. What must never happen is a silent
       downgrade: no AVIF and nothing telling the visitor why.

       Read the panel, not capabilities(): the work happens in a worker, so the
       main thread's copy of wasmState stays "unknown" and a perfectly explained
       fallback looks unexplained. */
    const engineState = await d.page.evaluate(() => {
      const box = document.querySelector('#engineStatus');
      return box ? box.innerText.replace(/\s+/g, ' ').trim() : '(no engine panel)';
    });
    const deliveredAvif = /^image\/avif/.test(fallbackType);
    const explained = /timed out|too slow|no reachable encoder|download failed|produced nothing|nothing usable|self-test/i.test(engineState);
    ok('a hanging source leaves AVIF working, or explained to the visitor',
      deliveredAvif || explained,
      deliveredAvif ? fallbackType : 'fell back to ' + fallbackType + ' — panel says: ' + engineState);
    ok('no page errors while falling through', d.errors.length === 0, d.errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++;
    console.log('  FAIL  unexpected error → ' + ((e && e.stack) || e));
  } finally {
    await browser.close();
    servers.forEach((s) => { try { s.kill(); } catch (e) {} });
    dropScratch(path.join(__dirname, '.tmp', 'fallback'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
