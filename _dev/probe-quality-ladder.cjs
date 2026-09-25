/* Why does Auto keep the original on an already-compressed photo?

   The matrix run said JPEG and WebP saved 0–5% on three real photographs while
   AVIF saved 75–85%. AVIF reached Q31; WebP stopped at Q84, which is nearly
   lossless. Two very different readings of "the lowest quality that clears the
   fidelity floor" should not come out of the same search, so walk the quality
   ladder by hand and see where the bytes actually land.

   Run: node _dev/probe-quality-ladder.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8819;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

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

function kb(n) { return Math.round(n / 1024) + ' KB'; }

async function runAt(page, item, formatRadio, quality) {
  await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
  await page.click(formatRadio);
  await page.evaluate((q) => {
    const qual = document.querySelector('input[name="mode"][value="quality"]');
    qual.checked = true;
    qual.dispatchEvent(new Event('change', { bubbles: true }));
    const slider = document.querySelector('#quality');
    slider.value = String(Math.round(q * 100));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, quality);
  await page.waitForTimeout(150);
  await page.setInputFiles('#fileInput', { name: item.name, mimeType: 'image/jpeg', buffer: item.buffer });
  await page.waitForFunction(() => !!document.querySelector('.result [data-act="download"]'),
    null, { timeout: 240000 });
  return await page.evaluate(async () => {
    const rows = document.querySelectorAll('.result');
    const row = rows[rows.length - 1];
    const img = row.querySelector('img[src^="blob:"]');
    const blob = await (await fetch(img.src)).blob();
    return {
      bytes: blob.size,
      badge: (row.querySelector('.badge') || {}).textContent.trim() || '',
      quality: (document.querySelector('#quality') || {}).value
    };
  });
}

async function psnrOf(page, originalBuf, outBlobUrl) {
  /* Reuse the page to score the result against the source the same way the
     engine does: decode both and compute PSNR on the luma plane. */
  return await page.evaluate(async ({ srcB64, outUrl }) => {
    async function load(b64) {
      const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob();
      return await createImageBitmap(blob);
    }
    const a = await load(srcB64);
    const b = await createImageBitmap(await (await fetch(outUrl)).blob());
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
      se += (la - lb) * (la - lb);
      n++;
    }
    const mse = se / n;
    return mse === 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / mse) * 10) / 10;
  }, { srcB64: originalBuf.toString('base64'), outUrl: outBlobUrl });
}

function run() {
  (async () => {
    const browser = await chromium.launch({ executablePath: EXE });
    const dir = path.join(__dirname, 'corpus');
    const file = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort()[0];
    const buffer = fs.readFileSync(path.join(dir, file));
    const item = { name: file, buffer: buffer, bytes: buffer.length };
    console.log('source: ' + file + '  ' + kb(buffer.length) + '\n');

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    for (const [label, radio] of [['WebP', 'label[for="fmtWebp"]'], ['JPEG', 'label[for="fmtJpeg"]']]) {
      console.log('--- ' + label + ' quality ladder (mode = Quality) ---');
      for (const q of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
        const out = await runAt(page, item, radio, q);
        console.log('  q=' + q.toFixed(2) + '  ' + kb(out.bytes).padStart(9)
          + '  saved ' + (Math.round((1 - out.bytes / item.bytes) * 1000) / 10 + '%').padStart(7)
          + '  badge: ' + out.badge + '  (slider reads ' + out.quality + ')');
      }
    }

    console.log('\n--- auto, for comparison ---');
    for (const [label, radio] of [['WebP', 'label[for="fmtWebp"]'], ['AVIF', 'label[for="fmtAvif"]']]) {
      await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
      await page.click(radio);
      await page.waitForTimeout(120);
      await page.setInputFiles('#fileInput', { name: item.name, mimeType: 'image/jpeg', buffer: item.buffer });
      await page.waitForFunction(() => !!document.querySelector('.result [data-act="download"]'),
        null, { timeout: 240000 });
      const out = await page.evaluate(async () => {
        const rows = document.querySelectorAll('.result');
        const row = rows[rows.length - 1];
        const img = row.querySelector('img[src^="blob:"]');
        const blob = await (await fetch(img.src)).blob();
        return { url: img.src, bytes: blob.size, badge: (row.querySelector('.badge') || {}).textContent.trim() };
      });
      const db = await psnrOf(page, item.buffer, out.url);
      console.log('  auto ' + label.padEnd(5) + kb(out.bytes).padStart(9) + '  ' + out.badge
        + '  measured PSNR vs source: ' + db + ' dB');
    }

    await browser.close();
    srv.close();
  })().catch((e) => { console.error('FATAL', e.message); srv.close(); process.exit(1); });
}
