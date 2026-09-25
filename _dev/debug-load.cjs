const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8792;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(WS_ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { console.log('  404', req.url); res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, run);

function run() {
  (async () => {
    const browser = await chromium.launch({
      executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe',
      headless: true
    });
    const page = await browser.newPage();
    page.on('console', (m) => console.log('[console.' + m.type() + ']', m.text().slice(0, 300)));
    page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 500)));
    page.on('requestfailed', (r) => console.log('[requestfailed]', r.url().slice(0, 120), r.failure() && r.failure().errorText));
    page.on('response', (r) => { if (r.status() >= 400) console.log('[HTTP ' + r.status() + ']', r.url().slice(0, 120)); });

    const resp = await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load', timeout: 20000 });
    console.log('status', resp.status(), 'title:', await page.title());
    console.log('has #dropzone:', await page.$('#dropzone') ? 'yes' : 'no');
    console.log('visibility:', await page.$eval('#dropzone', (el) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return JSON.stringify({ w: r.width, h: r.height, display: cs.display, vis: cs.visibility, op: cs.opacity });
    }).catch((e) => 'ERR ' + e.message));
    console.log('body first 300 chars:', (await page.evaluate(() => document.body ? document.body.innerHTML.slice(0, 300) : 'NO BODY')));
    await browser.close();
    process.exit(0);
  })().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}
