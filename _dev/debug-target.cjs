/* Dev-only: debug target-size search and format routing directly on the engine. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8795;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(WS_ROOT, p));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, run);

function run() {
  (async () => {
    const b = await chromium.launch({
      executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
    });
    const page = await b.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
    await page.waitForTimeout(500);

    // Wait for the wasm probes to settle so we can see which codecs are live.
    const caps = await page.evaluate(async () => {
      const c = await window.LPT.engine.capabilities();
      return c;
    });
    console.log('caps:', JSON.stringify(caps));

    const out = await page.evaluate(async () => {
      const E = window.LPT.engine;
      const res = await fetch('/_dev/out/photo-2200x1500.png');
      const file = new File([await res.blob()], 'photo.png', { type: 'image/png' });

      const t = await E.compress(file, { mode: 'target', format: 'auto', targetKB: 150, sharpen: 'off' }, {
        caps: { webp: true, avif: false, jpeg: true, png: true },
        report: () => {}
      });
      return {
        size: t.blob.size, kb: (t.blob.size / 1024).toFixed(1), type: t.blob.type,
        q: t.quality, downscales: t.downscales, overshoot: t.overshoot,
        encoder: t.encoder, w: t.width, h: t.height,
        attempts: t.attempts.map(a => ({ q: +a.q.toFixed(3), size: (a.size / 1024).toFixed(0) + 'KB', resized: a.resized || '' })),
        analysis: t.analysis
      };
    });
    console.log('TARGET 150KB →', JSON.stringify(out, null, 1).replace(/\n\s*/g, ' '));

    // Format routing on a clean flat graphic
    const out2 = await page.evaluate(async () => {
      const E = window.LPT.engine;
      const res = await fetch('/_dev/out/graphic-1400x900.png');
      const file = new File([await res.blob()], 'graphic.png', { type: 'image/png' });
      const r = await E.compress(file, { mode: 'auto', format: 'auto', sharpen: 'off' }, {
        caps: { webp: true, avif: false, jpeg: true, png: true },
        report: () => {}
      });
      return { size: r.blob.size, type: r.blob.type, strategy: r.strategy, palette: r.palette,
        analysis: r.analysis, kb: (r.blob.size / 1024).toFixed(0) };
    });
    console.log('AUTO GRAPHIC →', JSON.stringify(out2).replace(/\n\s*/g, ' '));

    await b.close();
    process.exit(0);
  })().catch((e) => { console.error('FATAL', e); process.exit(1); });
}
