const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.normalize(path.join(WS_ROOT, p)), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8802, run);
function run() {
  (async () => {
    const b = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
    const p = await b.newPage();
    p.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await p.goto('http://localhost:8802/localphototool/compress/', { waitUntil: 'load' });
    for (let i = 0; i < 10; i++) {
      await p.waitForTimeout(1500);
      console.log(i + 's:', (await p.textContent('#engineStatus')).replace(/\s+/g, ' ').slice(0, 120));
    }
    await b.close(); srv.close(); process.exit(0);
  })().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}
