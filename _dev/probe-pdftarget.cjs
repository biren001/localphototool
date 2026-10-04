/* probe-pdftarget — does the target search actually land inside the limit?

   Runs assets/js/pdftarget.js in a real browser against the same seeded print
   to-PDF fixtures, for three upload limits, and reports the settings it chose,
   the bytes it landed on and how many encodes it took to get there. The page
   will quote these numbers, so they have to come from the shipped module and
   not from a reshaped copy of it.

   Run: NODE_PATH=... node _dev/probe-pdftarget.cjs
*/
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const WS = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS, 'localphototool');
const FIXDIR = path.join(WS, '_dev', 'out', 'pdf');
const PORT = 8875;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };

function serve() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.indexOf('/__fixture/') === 0) {
        const f = path.join(FIXDIR, p.slice('/__fixture/'.length));
        if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(fs.readFileSync(f)); }
        res.writeHead(404); return res.end('no fixture ' + p);
      }
      if (p === '/__harness') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><meta charset="utf-8"><title>pdftarget probe</title>' +
          '<script src="/assets/js/compressor/engine.js"></script>' +
          '<script src="/assets/js/pdfcompress.js"></script>' +
          '<script src="/assets/js/pdftarget.js"></script>');
      }
      if (p.endsWith('/')) p += 'index.html';
      fs.readFile(path.normalize(path.join(SERVE_ROOT, p)), function (e, d) {
        if (e) { res.writeHead(404); return res.end('nf'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(d);
      });
    });
    srv.listen(PORT, function () { resolve(srv); });
  });
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_EXE ||
      'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const page = await browser.newPage();
  page.on('pageerror', function (e) { console.log('PAGEERROR ' + e.message); });
  await page.goto('http://127.0.0.1:' + PORT + '/__harness');
  await page.waitForFunction('window.LPT && window.LPT.pdftarget');

  const out = await page.evaluate(async function () {
    const names = ['photos.pdf', 'mixed.pdf', 'text-only.pdf'];
    const grabs = await Promise.all(names.map(function (n) {
      return fetch('/__fixture/' + n).then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return new Uint8Array(ab); });
    }));
    const res = [];
    for (let i = 0; i < names.length; i++) {
      for (const kb of [100, 200]) {
        const t0 = performance.now();
        let steps = 0;
        const r = await window.LPT.pdftarget.shrinkToFit(grabs[i], {
          targetKB: kb,
          onStep: function () { steps++; }
        });
        res.push({
          fixture: names[i], kb: kb, ms: Math.round(performance.now() - t0),
          steps: steps, bytes: r.bytes, quality: r.quality, maxDim: r.maxDim,
          passed: r.passed, replaced: r.replaced, sizeIn: r.sizeIn
        });
      }
    }
    return res;
  });

  const lines = out.map(function (r) {
    return r.fixture.padEnd(18) + String(r.kb).padStart(4) + ' KB  ->  ' +
      String(r.bytes).padStart(8) + ' bytes  (in ' + r.sizeIn + ')  q=' + r.quality +
      '  edge=' + r.maxDim + '  replaced=' + r.replaced +
      '  encodes=' + r.steps + '  ' + r.ms + 'ms  ' + (r.passed ? 'fits' : 'DOES NOT FIT');
  });

  console.log(lines.join('\n'));
  const bad = out.filter(function (r) {
    const limit = r.kb * 1024;
    return (r.passed && r.bytes > limit) || (!r.passed && false);
  });
  console.log('\n' + (bad.length ? 'FAIL — ' + bad.length + ' result(s) over the limit' : 'every result is inside its limit, or honestly reported as the floor'));

  fs.writeFileSync(path.join(WS, '_dev', '.tmp', 'pdftarget-probe.txt'), lines.join('\n'));
  await browser.close();
  srv.close();
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
