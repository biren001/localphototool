/* Probe: what does the page actually produce with the maximum-edge control on?
   The e2e measured 1,689,943 -> 75,563 at a 1000 px cap, while the recorded
   measurement in _dev/measured/pdf-recompression.json says 242,999. Both runs
   use the same fixture and the same quality, so one of the two paths is lying
   and this prints the report the page itself receives. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS_ROOT, 'localphototool');
const FIXTURE = path.join(WS_ROOT, '_dev', 'out', 'pdf');
const PORT = 8897;
const EXE = process.env.CHROME_EXE ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.mjs': 'text/javascript', '.jpg': 'image/jpeg' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      fs.readFile(path.normalize(path.join(SERVE_ROOT, p)), (e, d) => {
        if (e) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(d);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

(async function () {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/compress-pdf/', { waitUntil: 'load' });

  await page.setInputFiles('#pdfInput', path.join(FIXTURE, 'photos.pdf'));
  await page.waitForSelector('#pdfResult:not([hidden])', { timeout: 60000 });

  const base = await page.evaluate(async () => {
    const a = document.getElementById('pdfDownload');
    const ab = await (await fetch(a.getAttribute('href'))).arrayBuffer();
    return { bytes: ab.byteLength, facts: document.getElementById('pdfResultFacts').innerText };
  });
  console.log('no cap          :', base.bytes);
  console.log(base.facts.split('\n').join('\n  '));

  /* Inspect the fixtures' image dimensions straight from the module. */
  const dims = await page.evaluate(async () => {
    const P = window.LPT.pdfcompress;
    const buf = await (await fetch('/assets/js/pdfcompress.js')).text();
    return P.inspect(new Uint8Array([1])).size;
  }).catch(() => -1);

  for (const cap of ['1600', '1000', '640']) {
    await page.evaluate(function () { document.getElementById('pdfResult').hidden = true; });
    await page.selectOption('#pdfMaxDim', cap);
    await page.waitForFunction(function () {
      const r = document.getElementById('pdfResult');
      return r && !r.hidden;
    }, null, { timeout: 60000 });
    const r = await page.evaluate(async function () {
      const a = document.getElementById('pdfDownload');
      const ab = await (await fetch(a.getAttribute('href'))).arrayBuffer();
      return { bytes: ab.byteLength, facts: document.getElementById('pdfResultFacts').innerText };
    });
    console.log('cap ' + cap + '       :', r.bytes);
    console.log('  ' + r.facts.split('\n').join('\n  '));
  }

  await browser.close();
  server.close();
})();
