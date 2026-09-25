/* Dev-only: drive the real UI into Target Size mode and dump diagnostics. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8799;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(WS_ROOT, p));
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(PORT, run);

function run() {
  (async () => {
    const b = await chromium.launch({
      executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
    });
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
    await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
    await page.waitForTimeout(2500); // warm up + wasm

    console.log('engine status:', (await page.textContent('#engineStatus')).replace(/\s+/g, ' '));

    await page.setInputFiles('#fileInput', ['C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55/_dev/out/photo-2200x1500.png']);
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.result');
      return rows.length === 1 && Array.from(rows).every((r) => r.querySelector('[data-act="download"]'));
    }, { timeout: 120000 });
    console.log('AUTO row:', await page.$eval('.result__meta', (e) => e.innerText.replace(/\n/g, ' | ')));

    await page.click('label[for="modeTarget"]');
    await page.fill('#targetKB', '150');
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.result');
      return rows.length === 1 && Array.from(rows).every((r) => r.querySelector('[data-act="download"]'));
    }, { timeout: 120000 });
    await page.waitForTimeout(400);

    const row = await page.$eval('.result__meta', (e) => e.innerText.replace(/\n/g, ' | '));
    console.log('TARGET row:', row);

    await page.click('.result [data-act="compare"]');
    await page.waitForSelector('#compareModal:not([hidden])');
    console.log('compare stats:', await page.$eval('#compareStats', (e) => e.innerText.replace(/\n/g, ' | ')));
    console.log('badge:', await page.textContent('#compareBadge'));

    // What did the engine actually produce?
    const dl = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55/_dev/out/downloads';
    fs.mkdirSync(dl, { recursive: true });
    const [file] = await Promise.all([
      page.waitForEvent('download'), page.click('#compareSave')
    ]);
    const p2 = path.join(dl, 'target-debug-' + file.suggestedFilename());
    await file.saveAs(p2);
    console.log('downloaded:', path.basename(p2), (fs.statSync(p2).size / 1024).toFixed(1) + ' KB');

    await b.close(); srv.close(); process.exit(0);
  })().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}
