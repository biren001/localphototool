/* measure-pdf-text — why can't the text in this PDF be selected?

   Every "PDF to text" tool in the search results is a browser widget that
   hands back a box of words. None of them says why the words are not there in
   the first place, so a person with a scanned form learns nothing they can act
   on. This measures the other half of the answer: what the file actually
   contains per page, and the reason each page gives up.

   The harness loads assets/js/pdftext.js — the module the page will ship — and
   calls extract() on it, so the printed numbers are the module's numbers and
   not a second implementation's. text is reported in full for the small
   fixtures as an exhibit, and page-by-page for the big ones.

   Nothing here ships. The numbers decide what /why-cant-i-select-the-text-in-
   this-pdf/ can claim.

   Run: NODE_PATH=... node _dev/measure-pdf-text.cjs
*/
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const WS = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS, 'localphototool');
const FIXDIR = path.join(WS, '_dev', 'out', 'pdf');
const REPDIR = path.join(WS, '_dev', 'measured');
const PORT = 8877;

const FIXTURES = [
  { name: 'mixed.in.pdf', exhibit: true },       /* words + pictures */
  { name: 'text-only.pdf', exhibit: true },      /* words only */
  { name: 'photos.in.pdf', exhibit: false },     /* pictures only */
  { name: 'encrypted.pdf', exhibit: false }      /* must report, not guess */
];

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
        return res.end('<!doctype html><meta charset="utf-8"><title>pdf text probe</title>' +
          '<script src="/assets/js/compressor/engine.js"></script>' +
          '<script src="/assets/js/pdfcompress.js"></script>' +
          '<script src="/assets/js/pdftext.js"></script>');
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
  await page.waitForFunction('window.LPT && window.LPT.pdftext');

  const out = await page.evaluate(async function (cfg) {
    const T = window.LPT.pdftext;

    async function grab(name) {
      const ab = await fetch('/__fixture/' + name).then(function (r) { return r.arrayBuffer(); });
      return new Uint8Array(ab);
    }

    const rows = [];
    for (const f of cfg.fixtures) {
      const input = await grab(f.name);
      const rep = await T.extract(input);
      const pages = rep.pages.map(function (p) {
        return {
          page: p.page, chars: p.chars, streams: p.streams || 0,
          notes: p.notes || [],
          /* The exhibit is what makes the page honest: the words themselves,
             not just a count of them. */
          text: f.exhibit ? p.text : p.text.slice(0, 120),
          diag: { streamLen: p._streamLen, fonts: p._fonts }
        };
      });
      rows.push({
        fixture: f.name, bytes: input.length, exhibit: !!f.exhibit,
        encrypted: rep.encrypted, objStm: rep.objStmCount || 0,
        totalChars: rep.totalChars, pagesWithText: rep.pagesWithText,
        readable: rep.readable, reasons: rep.reasons,
        pageCount: pages.length, pages: pages
      });
    }
    return rows;
  }, { fixtures: FIXTURES });

  await browser.close();
  srv.close();

  const stamp = new Date().toISOString().slice(0, 10);
  const json = path.join(REPDIR, 'pdf-text-' + stamp + '.json');
  fs.writeFileSync(json, JSON.stringify({ ran: stamp, rows: out }, null, 2));

  out.forEach(function (r) {
    console.log('== ' + r.fixture + '  ' + r.bytes + ' bytes  pages=' + r.pageCount +
      '  encrypted=' + r.encrypted + '  readable=' + r.readable);
    console.log('   totalChars=' + r.totalChars + '  pagesWithText=' + r.pagesWithText +
      '  objStm=' + r.objStm);
    r.pages.forEach(function (p) {
      console.log('   page ' + p.page + '  chars=' + p.chars + '  streams=' + p.streams +
        '  streamLen=' + (p.diag && p.diag.streamLen) + '  fonts=' + (p.diag && p.diag.fonts));
      if (p.notes.length) p.notes.forEach(function (n) { console.log('      note: ' + n); });
      if (p.text) console.log('      text: ' + JSON.stringify(p.text.slice(0, 160)));
    });
    r.reasons.forEach(function (x) { console.log('   reason: ' + x); });
  });
  console.log('\nwrote ' + json);
})().catch(function (e) { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
