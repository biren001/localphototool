/* measure-pdf-target — can a PDF be pushed to an exact upload limit, and what
   happens to the words while it happens?

   v83 left /compress-pdf/ answering "make this smaller". The search for it
   showed a different shape of query, and one that SERP evidence says worth
   chasing: *"compress PDF to 100 KB"* — the government portal and the bank
   form limit. Five browser tools rank for it (compresspdfto100kb.com,
   textify.tools, resizepdf.in, kisspdf.net, scanpilot.ai) and every one of
   them renders each page to a canvas and re-encodes the page as one picture,
   which is why textify's own page admits the text stops being selectable.

   This site re-encodes the *images inside* the PDF and copies the fonts, the
   content streams and the page tree through untouched, so the same target may
   be reachable with the words still alive. That is a claim, not a fact, so
   this measures it.

   The search itself is deliberately *not* written here. The first version of
   this file carried its own binary search over quality, which meant it could
   disagree with the shipped module (v83's measure-merge.cjs failed the same
   way) and the page would have quoted a file the site never produces. So the
   harness loads assets/js/pdftarget.js and calls shrinkToFit(), exactly the
   function the page will call. If the two drift, the numbers drift with them
   instead of apart.

   Nothing here ships. The number decides whether a target-size page is worth
   building; if the pictures have to be destroyed to reach 100 KB on a document
   that is mostly text, the page has to say that rather than pretend.

   Run: NODE_PATH=... node _dev/measure-pdf-target.cjs
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
const PORT = 8874;

const FIXTURES = ['photos.pdf', 'mixed.pdf', 'text-only.pdf'];
const TARGETS = [100, 200, 500];            /* KB */

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
        return res.end('<!doctype html><meta charset="utf-8"><title>pdf target probe</title>' +
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
  await page.waitForFunction('window.LPT && window.LPT.pdfcompress && window.LPT.pdftarget');

  const out = await page.evaluate(async function (cfg) {
    const C = window.LPT.pdfcompress;
    const T = window.LPT.pdftarget;

    async function grab(name) {
      const ab = await fetch('/__fixture/' + name).then(function (r) { return r.arrayBuffer(); });
      return new Uint8Array(ab);
    }
    function pack(u8) {
      let s = ''; const CH = 8192;
      for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + CH));
      return btoa(s);
    }

    const rows = [];
    for (const name of cfg.fixtures) {
      const input = await grab(name);
      const info = C.inspect(input);
      const row = { fixture: name, bytes: input.length, pages: info.pages, images: info.images.length, encodable: info.encodableImages, targets: {} };

      /* Two codecs, because the answer moves with the codec. The engine prefers
         its WASM module whenever that module has loaded, and loading it is a
         network question — so one visitor is measured with the browser's own
         JPEG encoder and the next with the WASM one, and both are real. Both
         paths are forced here (allowWasm) so the printed numbers do not depend
         on what happened to be cached in the browser when the run happened. */
      let steps = 0;
      /* allowWasm:true only helps if the module is actually there, so the WASM
         pass waits for it first and the report says whether it arrived. */
      const warm = await window.LPT.engine.preload(['jpeg']);
      row.wasmLive = !!(warm && warm.jpeg);
      for (const codec of ['native', 'wasm']) {
        for (const kb of cfg.targets) {
          const r = await T.shrinkToFit(input, {
            targetKB: kb,
            dropMetadata: false,
            allowWasm: codec === 'wasm',
            onStep: function () { steps++; }
          });
          const u8 = new Uint8Array(await r.blob.arrayBuffer());
          row.targets[codec + ':' + kb] = {
            quality: r.quality,
            maxDim: r.maxDim,
            bytes: u8.length,
            encoder: r.encoder,
            sizeIn: r.sizeIn,
            passed: r.passed,
            replaced: r.replaced,
            skipped: r.skipped,
            kept: !!r.kept,
            floorBytes: r.floorBytes === undefined ? null : r.floorBytes,
            encodes: steps,
            b64: pack(u8)
          };
        }
      }
      rows.push(row);
    }
    return rows;
  }, { fixtures: FIXTURES, targets: TARGETS });

  const lines = [];
  lines.push('fixture                   size      pages images encodable');
  for (const r of out) {
    lines.push('  ' + r.fixture.padEnd(24) + String(r.bytes).padStart(8) + String(r.pages).padStart(7) + String(r.images).padStart(7) + String(r.encodable).padStart(10));
    for (const codec of ['native', 'wasm']) {
      for (const kb of TARGETS) {
        const t = r.targets[codec + ':' + kb];
        if (!t) { lines.push('     ' + codec + ' ' + kb + ' KB   -> no attempt'); continue; }
        lines.push('     ' + codec.padEnd(7) + String(kb).padStart(4) + ' KB -> ' + String(t.bytes).padStart(8) + ' bytes  q=' + t.quality +
          '  maxEdge=' + t.maxDim + '  replaced=' + t.replaced + '  encodes=' + t.encodes + '  codec=' + t.encoder +
          (t.passed ? '  fits' : '   OVER LIMIT (floor ' + t.floorBytes + ')'));
      }
    }
  }

  const files = [];
  for (const r of out) {
    for (const codec of ['native', 'wasm']) {
      for (const kb of TARGETS) {
        const t = r.targets[codec + ':' + kb];
        if (!t || !t.b64) continue;
        const base = r.fixture.replace(/\.pdf$/, '') + '-' + kb + 'kb-' + codec + '.pdf';
        fs.writeFileSync(path.join(FIXDIR, base), Buffer.from(t.b64, 'base64'));
        files.push(base);
      }
    }
  }

  fs.mkdirSync(REPDIR, { recursive: true });
  fs.writeFileSync(path.join(REPDIR, 'pdf-target.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows: out }, null, 2));
  fs.writeFileSync(path.join(WS, '_dev', '.tmp', 'pdf-target.txt'), lines.concat(['', 'written: ' + files.join(', ')]).join('\n'));
  console.log(lines.join('\n'));
  console.log('\nwritten: ' + files.join(', '));

  await browser.close();
  srv.close();
})().catch(function (e) { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
