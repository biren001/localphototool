/* Where does the 40 dB fidelity floor actually land?

   The quality ladder showed WebP Q40 turns a 394 KB photo into 163 KB — a 58%
   saving the engine refuses to take in Auto mode. Either that refusal is right
   (Q40 is genuinely below the floor) or the floor is miscalibrated and Auto is
   leaving most of the saving on the table. Scoring each rung settles it.

   Run: node _dev/probe-fidelity-floor.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8821;
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

function run() {
  (async () => {
    const browser = await chromium.launch({ executablePath: EXE });
    const dir = path.join(__dirname, 'corpus');
    const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();

    for (const file of files.slice(0, 2)) {
      const buffer = fs.readFileSync(path.join(dir, file));
      console.log('\nsource: ' + file + '  ' + kb(buffer.length));
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();

      for (const [label, radio] of [['WebP', 'label[for="fmtWebp"]'], ['AVIF', 'label[for="fmtAvif"]']]) {
        console.log('  --- ' + label + ' ---');
        for (const q of [30, 40, 50, 60, 70, 80]) {
          await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
          await page.click(radio);
          await page.evaluate((qq) => {
            const qual = document.querySelector('input[name="mode"][value="quality"]');
            qual.checked = true;
            qual.dispatchEvent(new Event('change', { bubbles: true }));
            const slider = document.querySelector('#quality');
            slider.value = String(qq);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
          }, q);
          await page.waitForTimeout(120);
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
              bytes: outBlob.size,
              badge: (row.querySelector('.badge') || {}).textContent.trim() || '',
              psnr: mse === 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / mse) * 10) / 10
            };
          }, buffer.toString('base64'));
          console.log('    q=' + String(q).padStart(2) + '  ' + kb(info.bytes).padStart(9)
            + '  saved ' + (Math.round((1 - info.bytes / buffer.length) * 1000) / 10 + '%').padStart(7)
            + '   PSNR ' + String(info.psnr).padStart(5) + ' dB'
            + (info.psnr >= 40 ? '   <- clears 40 dB' : '')
            + '   ' + info.badge);
        }
      }
      await ctx.close();
    }

    await browser.close();
    srv.close();
  })().catch((e) => { console.error('FATAL', e.message); srv.close(); process.exit(1); });
}
