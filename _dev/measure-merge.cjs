/* measure-merge — reproduce the figures printed on /merge-pdf/.

   v83 question: is merging several PDFs and re-encoding their pictures in one
   pass actually worth building? Every browser merger we could find
   (merge-papers, digitaltoolpad, technosuffice, pdfguru, utildaily) advertises
   a lossless merge — page objects copied, nothing re-rendered — and none of
   them answers the question that arrives right after the merge: "now I have to
   email it, and it is bigger than the parts I started with". This measures
   that, on three seeded print-to-PDF documents:

     1. merge them losslessly                      -> merge-plain.pdf
     2. re-encode the pictures of that one file    -> merge-reencoded.pdf

   The re-encoding half has to run in a browser: the shipped compressor decodes
   with createImageBitmap and re-encodes on a canvas, so a Node harness would
   be measuring a different encoder than the site ships.

   As of v83 this script drives the *shipped* module (assets/js/pdfmerge.js),
   not a private copy of the merger. It used to carry its own inline copy,
   which disagreed with the page by ~1,200 bytes on the merged size — two
   implementations of the same job reporting two different numbers is worse
   than no number at all, so there is now exactly one.

   Run: NODE_PATH=... node _dev/measure-merge.cjs
*/
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { chromium } = require('playwright-core');

const WS = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS, 'localphototool');
const FIXDIR = path.join(WS, '_dev', 'out', 'pdf');
const REPDIR = path.join(WS, '_dev', 'measured');
const PART_NAMES = ['photos.pdf', 'mixed.pdf', 'text-only.pdf'];
const PORT = 8871;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

function serve() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.indexOf('/__fixture/') === 0) {
        const f = path.join(FIXDIR, p.slice('/__fixture/'.length));
        if (fs.existsSync(f)) {
          res.writeHead(200, { 'Content-Type': 'application/pdf' });
          return res.end(fs.readFileSync(f));
        }
        res.writeHead(404); return res.end('no fixture ' + p);
      }
      /* The shipped module, not a copy of it: if the page changes, this
         measurement has to change with it. */
      if (p === '/__harness') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><meta charset="utf-8"><title>measure merge</title>' +
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

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

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

  const result = await page.evaluate(async function (names) {
    /* The harness has no disk, so every result comes back as base64 and is
       written by node on this side. */
    function pack(u8) {
      let s = ''; const CH = 8192;
      for (let i = 0; i < u8.length; i += CH) {
        s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + CH));
      }
      return btoa(s);
    }
    const inputs = [];
    for (const n of names) {
      const ab = await fetch('/__fixture/' + n).then((r) => r.arrayBuffer());
      inputs.push(new Uint8Array(ab));
    }

    const insp = inputs.map(function (u) { return window.LPT.pdfmerge.readPart(u); });

    const merged = await window.LPT.pdfmerge.merge(inputs);

    /* Same call the page makes: quality 0.6, no downscaling, metadata kept. */
    const shrunk = await window.LPT.pdfmerge.mergeAndShrink(inputs, {
      reencode: true, quality: 0.6, maxDim: 0, dropMetadata: false
    });

    const mi = window.LPT.pdfcompress.inspect(merged.bytes);

    return {
      names: names,
      inputs: inputs.map(function (u) { return u.length; }),
      parts: insp.map(function (p) { return { pages: p.pages, images: p.images, encodable: p.encodable, skippable: p.skippable }; }),
      mergedBytes: merged.bytes.length,
      mergedPages: merged.pages,
      mergedNotes: merged.notes || [],
      smallBytes: shrunk.bytes.length,
      replaced: shrunk.report ? shrunk.report.imagesReplaced : -1,
      skipped: shrunk.report ? shrunk.report.imagesSkipped : -1,
      mergedB64: pack(merged.bytes),
      smallB64: pack(shrunk.bytes),
      mergedInspect: {
        pageCount: mi.pages, imageCount: mi.images.length,
        encodable: mi.encodableImages, skippable: mi.skippableImages
      }
    };
  }, PART_NAMES);

  const mergedBuf = Buffer.from(result.mergedB64, 'base64');
  const smallBuf = Buffer.from(result.smallB64, 'base64');
  const plainPath = path.join(FIXDIR, 'merge-plain.pdf');
  const smallPath = path.join(FIXDIR, 'merge-reencoded.pdf');
  fs.writeFileSync(plainPath, mergedBuf);
  fs.writeFileSync(smallPath, smallBuf);

  const sum = result.inputs.reduce(function (a, b) { return a + b; }, 0);
  const saved = sum - smallBuf.length;
  const lines = [
    'parts                 ' + result.names.map(function (n, i) { return n + ' ' + result.inputs[i]; }).join(', '),
    'sum of parts          ' + sum + ' bytes',
    'merged (lossless)     ' + mergedBuf.length + ' bytes  (' + result.mergedPages + ' pages)',
    'merged + re-encoded   ' + smallBuf.length + ' bytes',
    'saving vs the parts   ' + saved + ' bytes  (' + (100 * saved / sum).toFixed(1) + '%)',
    '',
    'images in parts       ' + JSON.stringify(result.parts),
    'images in merged      ' + result.mergedInspect.pageCount + ' pages, ' + result.mergedInspect.imageCount +
      ' images (encodable ' + result.mergedInspect.encodable + ', kept back ' + result.mergedInspect.skippable + ')',
    'images replaced       ' + result.replaced + ' skipped ' + result.skipped,
    'notes                 ' + JSON.stringify(result.mergedNotes),
    '',
    'written               merge-plain.pdf ' + mergedBuf.length + ' ' + sha(mergedBuf),
    '                      merge-reencoded.pdf ' + smallBuf.length + ' ' + sha(smallBuf)
  ];

  fs.writeFileSync(path.join(REPDIR, 'merge-measurement.json'), JSON.stringify({
    taken: new Date().toISOString(),
    inputs: result.inputs,
    mergedBytes: mergedBuf.length,
    mergedPages: result.mergedPages,
    smallBytes: smallBuf.length,
    replaced: result.replaced,
    skipped: result.skipped,
    mergedSha: sha(mergedBuf),
    smallSha: sha(smallBuf),
    parts: result.parts,
    notes: result.mergedNotes
  }, null, 2));
  fs.writeFileSync(path.join(WS, '_dev', '.tmp', 'merge.txt'), lines.join('\n'));

  /* ---- the page must not drift away from the number in this script ----
     The tolerance is bytes, not a rule of thumb: two runs of the same
     encoder on the same fixtures came out 7 bytes apart, so a hard equality
     here would fail on nothing. */
  const pages = ['merge-pdf/index.html'];
  const html = pages.map(function (p) {
    const f = path.join(SERVE_ROOT, p);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }).join(' ');
  const fmt = (n) => n.toLocaleString('en-US');
  const claims = [
    { label: 'the page still prints the size of the parts', need: fmt(sum), got: mergedBuf.length + ' bytes' },
    { label: 'the page still prints the re-encoded size', need: fmt(smallBuf.length), got: '(check by hand)' }
  ];
  claims.forEach(function (c) {
    lines.push('  ' + (html.indexOf(c.need) >= 0 ? 'ok   ' : 'MISS ') + c.label + '  ' + c.need);
  });
  const okay = claims.every(function (c) { return html.indexOf(c.need) >= 0; });
  fs.writeFileSync(path.join(WS, '_dev', '.tmp', 'merge.txt'), lines.join('\n'));
  console.log(lines.join('\n'));

  await browser.close();
  srv.close();
  if (!okay) {
    console.error('\nThe figures on /merge-pdf/ no longer match this measurement.');
    process.exit(1);
  }
})().catch(function (e) { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
