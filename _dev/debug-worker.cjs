const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const p = await b.newPage();
  // Serve a real worker from the local server via a blob-free approach: use the site itself.
  const http = require('http'); const fs = require('fs'); const path = require('path');
  const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
  const srv = http.createServer((req, res) => {
    const file = path.normalize(path.join(WS_ROOT, decodeURIComponent(req.url)));
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': /\.[jt]s$/.test(file) ? 'text/javascript' : 'text/html' });
      res.end(d);
    });
  }).listen(8797, () => {});

  await p.goto('http://localhost:8797/localphototool/index.html', { waitUntil: 'load' });
  const r = await p.evaluate(() => new Promise((resolve) => {
    const w = new Worker('/localphototool/assets/js/compressor/worker.js');
    const log = [];
    let done = false;
    w.onmessage = (ev) => {
      log.push(ev.data.type);
      if (ev.data.type === 'caps') {
        done = true;
        resolve({ caps: ev.data.payload, log });
      }
    };
    w.onerror = (e) => { if (!done) resolve({ error: e.message, log }); };
    setTimeout(() => { if (!done) resolve({ timeout: true, log }); }, 30000);
    w.postMessage({ type: 'warmup' });
  }));
  console.log(JSON.stringify(r, null, 1).replace(/\n\s*/g, ' '));
  await b.close(); srv.close(); process.exit(0);
})();
