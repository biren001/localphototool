/* probe-pdfmerge — does the shipped merge module do what it claims?

   Runs /assets/js/pdfmerge.js in a real browser against the three seeded
   print-to-PDF fixtures, merged three ways, and writes every result to
   _dev/out/pdf/ so an independent parser can look at it afterwards:

     merge-plain.pdf        merged, nothing re-encoded
     merge-reencoded.pdf    merged, then the pictures re-encoded
     merge-two.pdf          two files merged, to check /Kids and /Parent

   pypdf (a completely separate implementation) does the final reading in
   _dev/verify-pdfmerge.py — nothing here trusts pdfmerge's own page count.

   Run: NODE_PATH=... node _dev/probe-pdfmerge.cjs
*/
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const WS = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS, 'localphototool');
const FIXDIR = path.join(WS, '_dev', 'out', 'pdf');
const PORT = 8873;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

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
        return res.end('<!doctype html><meta charset="utf-8"><title>pdfmerge probe</title>' +
          '<script src="/assets/js/compressor/engine.js"></script>' +
          '<script src="/assets/js/pdfcompress.js"></script>' +
          '<script src="/assets/js/pdfmerge.js"></script>');
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

(async function () {
  const srv = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_EXE ||
      'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const page = await browser.newPage();
  page.on('pageerror', function (e) { console.log('PAGEERROR ' + e.message); });
  await page.goto('http://127.0.0.1:' + PORT + '/__harness');
  await page.waitForFunction('window.LPT && window.LPT.pdfcompress && window.LPT.pdfmerge');

  const out = await page.evaluate(async function () {
    function grab(name) {
      return fetch('/__fixture/' + name).then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return new Uint8Array(ab); });
    }
    /* The harness has no disk, so every result comes back as base64 and is
       written by node on this side. */
    function pack(u8) {
      let s = '';
      const CH = 8192;
      for (let i = 0; i < u8.length; i += CH) {
        s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + CH));
      }
      return btoa(s);
    }
    const res = {};
    const three = await Promise.all([grab('photos.pdf'), grab('mixed.pdf'), grab('text-only.pdf')]);
    res.previews = three.map(function (u) { return window.LPT.pdfmerge.readPart(u); });

    const m = await window.LPT.pdfmerge.merge(three);
    res.mergedPages = m.pages;
    res.mergedHead = String.fromCharCode.apply(null, Array.prototype.slice.call(m.bytes.slice(0, 64), 0, 64));
    res.mergedBytes = m.bytes.length;
    res.mergedNotes = m.notes;
    res.mergedB64 = pack(m.bytes);

    const s = await window.LPT.pdfmerge.mergeAndShrink(three, { reencode: true, quality: 0.6 });
    res.smallBytes = s.bytes.length;
    res.smallReplaced = s.report ? s.report.imagesReplaced : -1;
    res.smallB64 = pack(s.bytes);

    const two = await window.LPT.pdfmerge.merge(three.slice(0, 2));
    res.twoPages = two.pages;
    res.twoBytes = two.bytes.length;
    res.twoB64 = pack(two.bytes);
    return res;
  });

  const lines = [
    'previews        ' + JSON.stringify(out.previews),
    'merged          ' + out.mergedPages + ' pages, ' + out.mergedBytes + ' bytes',
    'merged head     ' + JSON.stringify(out.mergedHead),
    'merged on disk  ' + Buffer.from(out.mergedB64, 'base64').length,
    'notes           ' + JSON.stringify(out.mergedNotes),
    're-encoded      ' + out.smallBytes + ' bytes (' + out.smallReplaced + ' images)',
    'two files       ' + out.twoPages + ' pages, ' + out.twoBytes + ' bytes'
  ];
  fs.writeFileSync(path.join(FIXDIR, 'merge-plain.pdf'), Buffer.from(out.mergedB64, 'base64'));
  fs.writeFileSync(path.join(FIXDIR, 'merge-reencoded.pdf'), Buffer.from(out.smallB64, 'base64'));
  fs.writeFileSync(path.join(FIXDIR, 'merge-two.pdf'), Buffer.from(out.twoB64, 'base64'));
  fs.writeFileSync(path.join(WS, '_dev', '.tmp', 'pdfmerge-probe.txt'), lines.join('\n'));
  console.log(lines.join('\n'));

  await browser.close();
  srv.close();
})().catch(function (e) { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
