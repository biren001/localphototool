/* Guard the one promise Auto mode makes: the result stays above the fidelity
   floor.

   The bug this exists for: autoQuality probed quality with `allowWasm:false`,
   so it measured the browser's native encoder. No browser encodes AVIF
   natively — the canvas silently handed back PNG, a lossless probe that clears
   any floor, and the binary search slid to the bottom of its range. Auto then
   shipped AVIF · Q31 at 33.5 dB while the UI advertised ~40 dB. Nothing crashed
   and nothing looked wrong on screen; the file was simply more degraded than
   promised.

   The guard measures the output that actually comes back, not the setting that
   was chosen, because that is the only thing that can catch a probe that
   measured the wrong codec.

   Run: node _dev/test-fidelity.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8825;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

/* PSNR_FLOOR in engine.js is 38 dB and the proxy adds 1.6 dB of headroom, so a
   genuinely correct Auto lands at 39.6 dB or better. Assert 38: that is the
   number the copy on the page actually quotes, and it leaves a little room for
   a different corpus without letting a 33 dB regression through. */
const FLOOR_DB = 38.0;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.normalize(path.join(WS_ROOT, p)), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(PORT, run);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + '  → ' + detail); }
}

/* The floor is quoted in the copy on several pages. Nothing ties that sentence
   to the constant, so lowering PSNR_FLOOR to win a few kilobytes would leave
   every page still promising "no visible difference" at a number it no longer
   meets. Read both and require agreement. Static, so it runs before the
   browser even starts. */
function checkCopyMatchesFloor() {
  const engineSrc = fs.readFileSync(path.join(WS_ROOT, 'localphototool/assets/js/compressor/engine.js'), 'utf8');
  const floor = /var PSNR_FLOOR\s*=\s*([0-9.]+)/.exec(engineSrc);
  const margin = /var PSNR_PROXY_MARGIN\s*=\s*([0-9.]+)/.exec(engineSrc);
  if (!floor || !margin) {
    check('engine declares a fidelity floor and a proxy margin', false, 'constant not found');
    return;
  }
  const effective = Math.round(Number(floor[1]) + Number(margin[1]));
  const pages = ['index.html', 'compress/index.html', 'heic-to-jpg/index.html'];
  let quoted = 0, seen = 0;
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(WS_ROOT, 'localphototool', rel), 'utf8');
    const m = /~?\s*(\d+)\s*dB (?:PSNR|fidelity)/.exec(html);
    if (!m) continue;
    seen++;
    quoted = Number(m[1]);
    if (quoted !== effective) {
      check(rel + ' quotes the floor the engine enforces', false,
        'page says ' + m[1] + ' dB, engine enforces ~' + effective + ' dB');
    }
  }
  check('every page that quotes a fidelity floor agrees with engine.js',
    seen > 0 && quoted === effective,
    'engine ' + floor[1] + ' + ' + margin[1] + ' margin ≈ ' + effective + ' dB across ' + seen + ' page(s)');
}

function run() {
  (async () => {
    checkCopyMatchesFloor();

    const corpusDir = path.join(__dirname, 'corpus');
    const files = fs.readdirSync(corpusDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
    if (!files.length) {
      console.log('  FAIL  corpus is empty — _dev/corpus needs at least one JPEG');
      srv.close();
      process.exit(1);
    }
    const file = files[0];
    const buffer = fs.readFileSync(path.join(corpusDir, file));

    const browser = await chromium.launch({ executablePath: EXE });
    console.log('source: ' + file + ' (' + Math.round(buffer.length / 1024) + ' KB)\n');

    for (const [label, radio] of [['AVIF', 'label[for="fmtAvif"]'], ['WebP', 'label[for="fmtWebp"]']]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      /* Playwright's default is 30s. A cold Chromium on a busy machine can
         spend most of that before the page is even parsed — this suite hit
         exactly that once, and a timeout here reads as a fidelity failure.
         The wait below is what actually needs to be generous (WASM warm-up). */
      await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load', timeout: 90000 });
      await page.click(radio);
      await page.evaluate(() => {
        const auto = document.querySelector('input[name="mode"][value="auto"]');
        auto.checked = true;
        auto.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(150);
      await page.setInputFiles('#fileInput', { name: file, mimeType: 'image/jpeg', buffer: buffer });
      await page.waitForFunction(() => !!document.querySelector('.result [data-act="download"]'),
        null, { timeout: 240000 });

      const info = await page.evaluate(async (srcB64) => {
        const rows = document.querySelectorAll('.result');
        const row = rows[rows.length - 1];
        const img = row.querySelector('img[src^="blob:"]');
        const outBlob = await (await fetch(img.src)).blob();
        const srcBlob = await (await fetch('data:image/jpeg;base64,' + srcB64)).blob();
        const a = await createImageBitmap(srcBlob);
        const b = await createImageBitmap(outBlob);
        const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
        const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
        const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
        ca.getContext('2d').drawImage(a, 0, 0, w, h);
        cb.getContext('2d').drawImage(b, 0, 0, w, h);
        const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
        const db = cb.getContext('2d').getImageData(0, 0, w, h).data;
        let se = 0, n = 0;
        for (let i = 0; i < da.length; i += 4) {
          const la = 0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2];
          const lb = 0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2];
          se += (la - lb) * (la - lb); n++;
        }
        const mse = se / n;
        return {
          mime: outBlob.type,
          bytes: outBlob.size,
          badge: (row.querySelector('.badge') || {}).textContent.trim() || '',
          psnr: mse === 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / mse) * 10) / 10
        };
      }, buffer.toString('base64'));
      await ctx.close();

      const isRealFormat = new RegExp(label, 'i').test(info.mime) || new RegExp(label, 'i').test(info.badge);
      if (!isRealFormat) {
        /* The codec never arrived, so there is no fidelity claim to test —
           the page already falls back and says so. */
        check('auto ' + label + ': codec unavailable, fallback declared',
          /Original kept|WEBP|JPG|PNG/i.test(info.badge), info.badge + ' / ' + info.mime);
        continue;
      }
      check('auto ' + label + ': output stays above the ' + FLOOR_DB + ' dB floor',
        info.psnr >= FLOOR_DB,
        info.psnr + ' dB at ' + Math.round(info.bytes / 1024) + ' KB — ' + info.badge);
    }

    await browser.close();
    srv.close();
    console.log('\n' + pass + ' / ' + (pass + fail) + ' fidelity checks passed');
    process.exit(fail ? 1 : 0);
  })().catch((e) => { console.error('FATAL', e.message); srv.close(); process.exit(1); });
}
