/* test-pdfcompress — does the v80 PDF tool actually produce a PDF?
   _dev/test-pdfcompress.cjs  ·  run:  NODE_PATH=... node _dev/test-pdfcompress.cjs

   The module rewrites a cross-reference table, which is exactly the kind of
   change that can look fine and open blank pages in a viewer. So the contract
   here is not "did it get smaller" alone; it is "did it get smaller AND is the
   result still the same document". Checks:

     1. inspect() agrees with the measurement recorded in measure-pdf.cjs
     2. every byte went the right way (images replaced, everything else intact)
     3. the rebuilt xref resolves: startxref -> the xref keyword -> `N 0 obj`
        at each listed offset, for every object
     4. a PDF with nothing to re-encode comes back byte-identical
     5. encrypted / /SMask / /ImageMask input is refused or skipped, not broken
     6. the output is rendered and re-parsed by a library we did not write
        (_dev/verify-pdf.py, pypdfium2 + pypdf)

   The engine is the site's own (window.LPT.engine on /compress/, which already
   loads it); pdfcompress.js is injected as a script tag rather than shipped
   from a page that does not exist yet. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const WS = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS, 'localphototool');
const FIX = path.join(WS, '_dev', 'fixtures');
const OUTDIR = path.join(WS, '_dev', 'out', 'pdf');
const MEASURED = path.join(WS, '_dev', 'measured', 'pdf-recompression.json');
const PORT = 8861;
const EXE = process.env.CHROME_EXE ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

/* A harness page, not the real one: /compress/ pulls optional WASM codecs from
   esm.sh, and under a sandbox with no egress the load event never settles. The
   harness loads exactly the two scripts under test and nothing else. */
const HARNESS = '<!doctype html><meta charset="utf-8"><title>pdf harness</title>' +
  '<body><script src="/assets/js/compressor/engine.js"></script>' +
  '<script src="/assets/js/pdfcompress.js"></script></body>';

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/__pdfharness') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HARNESS);
      }
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
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/__pdfharness', { waitUntil: 'load' });
  await page.waitForFunction('!!(window.LPT && window.LPT.engine && window.LPT.pdfcompress)', null, { timeout: 15000 });
  const hasMod = await page.evaluate(() => !!(window.LPT && window.LPT.pdfcompress && window.LPT.pdfcompress.inspect));
  check('pdfcompress.js exposes inspect/compress in the page', hasMod, String(hasMod));
  if (!hasMod) { await browser.close(); server.close(); process.exit(1); }

  /* load the fixtures the measurement script produced */
  const names = ['photos.pdf', 'mixed.pdf', 'text-only.pdf'];
  const b64s = {};
  names.forEach((n) => { b64s[n] = fs.readFileSync(path.join(FIX, n)).toString('base64'); });

  let measured = null;
  try { measured = JSON.parse(fs.readFileSync(MEASURED, 'utf8')).results; } catch (e) { measured = null; }

  const R = await page.evaluate(async (a) => {
    const P = window.LPT.pdfcompress;
    const unb64 = (str) => {
      const bin = atob(str); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    };
    const toB64 = (u8) => {
      let s = '';
      for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
      return btoa(s);
    };

    function validate(u8) {
      const s = new TextDecoder('latin1').decode(u8);
      const res = { header: s.slice(0, 5), eof: /%%EOF\s*$/.test(s) };
      const m = s.match(/startxref\s+(\d+)/);
      res.startxref = m ? Number(m[1]) : -1;
      if (m) {
        const at = res.startxref;
        res.startxrefAtXref = s.slice(at, at + 4) === 'xref';
        const sub = s.slice(s.indexOf('xref', at));
        const f = sub.match(/xref\s+0\s+(\d+)\s/);
        res.size = f ? Number(f[1]) : 0;
        const lines = sub.slice(sub.indexOf('\n') + 1).split('\n')
          .filter((l) => /^\d{10} \d{5} [nf] $/.test(l));
        res.entries = lines.length;
        res.inUse = lines.filter((l) => l[17] === 'n').length;
        let bad = 0, firstBad = '';
        lines.forEach((l, i) => {
          if (l[17] !== 'n') return;
          const off = Number(l.slice(0, 10));
          const hm = s.slice(off, off + 32).match(/^(\d+)\s+0\s+obj/);
          if (!hm || Number(hm[1]) !== i) { bad++; if (!firstBad) firstBad = 'entry ' + i; }
        });
        res.bad = bad; res.firstBad = firstBad;
        /* A table with zero entries proves nothing, so say so out loud. This
           check exists because an earlier version passed with entries === 0
           === size while the file had been truncated right before the xref. */
        res.entries = res.entries || 0;
        res.sane = res.entries > 0 && res.size > 0 && res.inUse > 0;
      } else {
        res.sane = false;
      }
      return res;
    }

    const res = {};
    for (const n of Object.keys(a.fixtures)) {
      const input = unb64(a.fixtures[n]);
      res[n] = { inspect: P.inspect(input), bytes: input.length };
    }

    /* -- photos: the real work -- */
    const photos = unb64(a.fixtures['photos.pdf']);
    const pr = await P.compress(photos, { quality: 0.6, maxDim: 0 });
    const pOut = pr.blob ? new Uint8Array(await pr.blob.arrayBuffer()) : photos;
    res.photosRun = {
      wasm: window.LPT.engine.currentWasm ? window.LPT.engine.currentWasm() : null,
      report: { imagesReplaced: pr.imagesReplaced, imagesSkipped: pr.imagesSkipped, bytesIn: pr.bytesIn, bytesOut: pr.bytesOut, encoder: pr.encoder, encrypted: pr.encrypted, images: pr.images },
      out: toB64(pOut), v: validate(pOut),
      reparse: P.inspect(pOut),
      jpegsStillInside: (new TextDecoder('latin1').decode(pOut).match(/\xff\xd8\xff/g) || []).length
    };

    /* -- mixed: one photo in a text document -- */
    const mixed = unb64(a.fixtures['mixed.pdf']);
    const mr = await P.compress(mixed, { quality: 0.6, maxDim: 0 });
    const mOut = mr.blob ? new Uint8Array(await mr.blob.arrayBuffer()) : mixed;
    res.mixedRun = {
      report: { imagesReplaced: mr.imagesReplaced, bytesIn: mr.bytesIn, bytesOut: mr.bytesOut },
      out: toB64(mOut), v: validate(mOut), reparse: P.inspect(mOut)
    };

    /* -- text only: nothing to do, must come back unchanged -- */
    const text = unb64(a.fixtures['text-only.pdf']);
    const tr = await P.compress(text, { quality: 0.6, maxDim: 0 });
    const tOut = tr.blob ? new Uint8Array(await tr.blob.arrayBuffer()) : text;
    const identical = tOut.length === text.length && tOut.every((b, i) => b === text[i]);
    const trCopy = Object.assign({}, tr); delete trCopy.blob;
    res.textRun = { report: trCopy, identical: identical, out: toB64(tOut) };

    /* -- downscale -- */
    const small = await P.compress(photos, { quality: 0.6, maxDim: 1000 });
    const sOut = small.blob ? new Uint8Array(await small.blob.arrayBuffer()) : photos;
    res.downscale = { bytesOut: small.bytesOut, replaced: small.imagesReplaced, v: validate(sOut), outB64: toB64(sOut) };

    /* -- keep metadata -- */
    const keep = await P.compress(photos, { quality: 0.6, maxDim: 0, dropMetadata: false });
    const kOut = keep.blob ? new Uint8Array(await keep.blob.arrayBuffer()) : photos;
    res.keepMeta = { bytesOut: keep.bytesOut, reparse: P.inspect(kOut), v: validate(kOut), outB64: toB64(kOut) };

    /* -- edge cases: synthetic -- */
    function synth(opts) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const x = c.getContext('2d');
      x.fillStyle = 'rgb(30,180,220)'; x.fillRect(0, 0, 16, 16);
      const jpg = b64toU8(c.toDataURL('image/jpeg', 0.9));
      /* The JPEG has to live in its final position BEFORE the offsets are
         taken — splicing it in afterwards shifts every object that follows
         and the table would point at the wrong bytes. */
      let jpgText = '';
      for (let i = 0; i < jpg.length; i++) jpgText += String.fromCharCode(jpg[i]);
      const objs = [];
      objs.push('<</Type/Catalog/Pages 2 0 R>>');
      objs.push('<</Type/Pages/Kids[3 0 R]/Count 1>>');
      objs.push('<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 400]/Contents 4 0 R/Resources<</XObject<</Im0 5 0 R>>>>>>');
      /* draw the image for real: with an empty content stream the page renders
         blank whatever the image does, so a blankness check proves nothing */
      /* no CTM: at its natural 16x16 pt the image lands inside the 200x200
         page instead of being scaled out of view */
      /* scaled so the 16x16 image fills most of the page — left at its natural
         size it is a few percent of the width and "is it blank?" cannot tell */
      const content = 'q 20 0 0 20 0 0 cm /Im0 Do Q';
      objs.push('<</Length ' + content.length + '>>\nstream\n' + content + '\nendstream');
      objs.push('<</Type/XObject/Subtype/Image/Width 16/Height 16/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + jpg.length + '>>\nstream\n' + jpgText + '\nendstream');
      objs.push('<</Type/XObject/Subtype/Image/Width 16/Height 16/ColorSpace/DeviceGray/BitsPerComponent 1/ImageMask true/Filter/CCITTFaxDecode/Length 4>>\nstream\n\x00\x00\x00\x00\nendstream');
      objs.push('<</Type/XObject/Subtype/Image/Width 16/Height 16/SMask 5 0 R/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + jpg.length + '>>\nstream\n' + jpgText + '\nendstream');
      objs.push('<</Type/Metadata/Subtype/XML/Length 4>>\nstream\nabcd\nendstream');
      let body = '%PDF-1.4\n';
      if (opts.encrypt) body += '%/Encrypt\n';
      const offsets = []; let total = body.length;
      objs.forEach((o, i) => { offsets.push(total); body += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; total = body.length; });
      const max = objs.length + 1;
      let xref = 'xref\n0 ' + (max + 1) + '\n0000000000 65535 f \n';
      for (let i = 1; i <= objs.length; i++) xref += ('0000000000' + offsets[i - 1]).slice(-10) + ' 00000 n \n';
      body += xref + 'trailer\n<< /Size ' + (max + 1) + ' /Root 1 0 R >>\nstartxref\n' + body.length + '\n%%EOF\n';
      /* latin1 by hand: TextEncoder would turn 0x80-0xFF into two bytes and
         every offset taken above would be off by the length of the JPEG */
      const u8 = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) u8[i] = body.charCodeAt(i) & 0xff;
      return { bytes: u8 };
    }
    /* atob rejects the data: prefix outright, so take the payload only */
    function b64toU8(str) {
      const bin = atob(String(str).split(',')[1]); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }

    const synthU8 = synth({}).bytes;
    const si = P.inspect(synthU8);
    const sr = await P.compress(synthU8, { quality: 0.4 });
    res.synth = {
      inspect: { images: si.images.length, encodable: si.encodableImages, skippable: si.skippableImages, objStm: si.objStmCount },
      report: { imagesReplaced: sr.imagesReplaced, imagesSkipped: sr.imagesSkipped, encrypted: sr.encrypted, detail: sr.images }
    };
    if (sr.blob) {
      const so = new Uint8Array(await sr.blob.arrayBuffer());
      res.synth.outB64 = toB64(so);
      res.synth.v = validate(so);
      res.synth.reparse = P.inspect(so);
    } else {
      res.synth.outB64 = toB64(synthU8);
    }

    const encU8 = synth({ encrypt: true }).bytes;
    const er = await P.compress(encU8, { quality: 0.4 });
    res.encrypted = { report: { encrypted: er.encrypted, imagesReplaced: er.imagesReplaced, bytesIn: er.bytesIn, bytesOut: er.bytesOut }, inB64: toB64(encU8) };

    /* the synthetic is the only fixture that carries a /Metadata object, so
       this is where "keep the metadata or not" can actually be checked */
    const noMeta = P.inspect(synthU8);
    res.metaDrop = { before: noMeta.metadataObjects, beforeBytes: noMeta.metadataBytes };
    const dropped = await P.compress(synthU8, { quality: 0.4, dropMetadata: true });
    const keptOne = await P.compress(synthU8, { quality: 0.4, dropMetadata: false });
    if (dropped.blob) {
      const d = new Uint8Array(await dropped.blob.arrayBuffer());
      res.metaDrop.afterDrop = P.inspect(d).metadataObjects;
      res.metaDrop.catalogStillPointsAtMetadata = /\/Metadata\s+\d+\s+0\s+R/.test(new TextDecoder('latin1').decode(d).slice(0, 4000));
    }
    if (keptOne.blob) {
      const k = new Uint8Array(await keptOne.blob.arrayBuffer());
      res.metaDrop.afterKeep = P.inspect(k).metadataObjects;
      res.metaDrop.outB64 = toB64(k);
    }
    return res;
  }, { fixtures: b64s });

  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

  console.log('\n[1] inspect() agrees with the recorded measurement');
  for (const n of names) {
    const got = R[n].inspect;
    const ref = measured && measured[n];
    check(n + ' imageShare ~ ' + (ref ? ref.imageShareOfFile.toFixed(4) : '?'), near(got.imageShare || 0, ref ? ref.imageShareOfFile : -1, 0.02),
      got.imageShare.toFixed(4) + ' vs ' + (ref ? ref.imageShareOfFile : '?'));
    check(n + ' imageCount = ' + ref.imageCount, got.images.length === ref.imageCount, got.images.length + ' vs ' + ref.imageCount);
    check(n + ' page count = ' + ref.pageCount, got.pages === ref.pageCount, got.pages + ' vs ' + ref.pageCount);
  }

  console.log('\n[2] photos.pdf: four images re-encoded, whole file smaller');
  const ph = R.photosRun;
  check('all four images replaced', ph.report.imagesReplaced === 4, String(ph.report.imagesReplaced));
  check('nothing skipped', ph.report.imagesSkipped === 0, String(ph.report.imagesSkipped));
  check('output is smaller than input', ph.report.bytesOut < ph.report.bytesIn, ph.report.bytesIn + ' -> ' + ph.report.bytesOut);
  const ref = measured && measured['photos.pdf'];
  if (ref) check('shrink matches the measurement (' + ref.wholeFileProjection + ')', near(ph.report.bytesOut, ref.wholeFileProjection, ref.wholeFileProjection * 0.12),
    ph.report.bytesOut + ' vs ' + ref.wholeFileProjection);

  console.log('\n[3] the rebuilt cross-reference table resolves');
  check('starts with %PDF-', ph.v.header === '%PDF-', JSON.stringify(ph.v.header));
  check('ends with %%EOF', ph.v.eof === true);
  check('startxref points at the xref keyword', ph.v.startxrefAtXref === true, String(ph.v.startxrefAtXref));
  check('every xref entry lands on its own object', ph.v.bad === 0, ph.v.firstBad);
  check('entry count === /Size', ph.v.entries === ph.v.size, ph.v.entries + ' vs ' + ph.v.size);
  check('objects still parse out of the output', ph.reparse.objects === R['photos.pdf'].inspect.objects && ph.reparse.objects > 0,
    ph.reparse.objects + ' vs ' + R['photos.pdf'].inspect.objects);
  check('re-parse sees the same four images', ph.reparse.images.length === 4, String(ph.reparse.images.length));

  console.log('\n[4] mixed.pdf keeps its text and its page');
  const mx = R.mixedRun;
  check('one image replaced', mx.report.imagesReplaced === 1, String(mx.report.imagesReplaced));
  check('smaller', mx.report.bytesOut < mx.report.bytesIn, mx.report.bytesIn + ' -> ' + mx.report.bytesOut);
  check('page count unchanged', mx.reparse.pages === R['mixed.pdf'].inspect.pages && mx.reparse.pages > 0,
    mx.reparse.pages + ' vs ' + R['mixed.pdf'].inspect.pages);
  check('xref resolves', mx.v.bad === 0 && mx.v.startxrefAtXref === true, JSON.stringify(mx.v));

  console.log('\n[5] a PDF with nothing to re-encode comes back untouched');
  console.log('     text-only report: ' + JSON.stringify(R.textRun.report));
  check('no images touched', R.textRun.report.imagesReplaced === 0 && R.textRun.report.imagesSkipped === 0);
  check('byte-identical', R.textRun.identical === true);

  console.log('\n[6] settings and edge cases behave');
  check('downscale also shrinks the file', R.downscale.bytesOut > 0 && R.downscale.bytesOut < ph.report.bytesIn, String(R.downscale.bytesOut));
  check('downscale output has a valid xref', R.downscale.v.bad === 0 && R.downscale.v.startxrefAtXref === true, JSON.stringify(R.downscale.v));
  check('keeping metadata keeps the metadata object', R.keepMeta.reparse.metadataObjects === R['photos.pdf'].inspect.metadataObjects,
    R.keepMeta.reparse.metadataObjects + ' vs ' + R['photos.pdf'].inspect.metadataObjects);
  check('keeping metadata still produces a valid PDF', R.keepMeta.v.bad === 0, JSON.stringify(R.keepMeta.v));
  check('synthetic /SMask and /ImageMask are skipped, the plain JPEG is not',
    R.synth.inspect.encodable === 1 && R.synth.inspect.skippable === 2,
    JSON.stringify(R.synth.inspect));
  console.log('     synthetic report: ' + JSON.stringify(R.synth.report) + ' inspect ' + JSON.stringify(R.synth.inspect));
  check('synthetic compress replaced exactly one image', R.synth.report.imagesReplaced === 1, JSON.stringify(R.synth.report));
  check('synthetic output has a sane xref', R.synth.v && R.synth.v.sane === true, JSON.stringify(R.synth.v));
  check('encrypted file is refused, not rebuilt', R.encrypted.report.encrypted === true && R.encrypted.report.bytesOut === R.encrypted.report.bytesIn,
    JSON.stringify(R.encrypted.report));
  check('the fixture really does carry a metadata object', R.metaDrop.before === 1, JSON.stringify(R.metaDrop));
  check('dropping metadata removes the object', R.metaDrop.afterDrop === 0, JSON.stringify(R.metaDrop));
  check('dropping metadata also cuts the reference', R.metaDrop.catalogStillPointsAtMetadata === false, JSON.stringify(R.metaDrop));
  check('keeping metadata keeps the object', R.metaDrop.afterKeep === 1, JSON.stringify(R.metaDrop));

  /* hand the outputs to an independent parser */
  fs.writeFileSync(path.join(OUTDIR, 'photos.in.pdf'), fs.readFileSync(path.join(FIX, 'photos.pdf')));
  fs.writeFileSync(path.join(OUTDIR, 'keepmeta.out.pdf'), Buffer.from(R.keepMeta.outB64, 'base64'));
  /* the baselines the verifier compares against, under their plain names */
  names.forEach(function (n) {
    fs.copyFileSync(path.join(FIX, n), path.join(OUTDIR, n));
  });
  fs.writeFileSync(path.join(OUTDIR, 'photos.out.pdf'), Buffer.from(R.photosRun.out, 'base64'));
  fs.writeFileSync(path.join(OUTDIR, 'mixed.in.pdf'), fs.readFileSync(path.join(FIX, 'mixed.pdf')));
  fs.writeFileSync(path.join(OUTDIR, 'mixed.out.pdf'), Buffer.from(R.mixedRun.out, 'base64'));
  fs.writeFileSync(path.join(OUTDIR, 'text.out.pdf'), Buffer.from(R.textRun.out, 'base64'));
  fs.writeFileSync(path.join(OUTDIR, 'downscale.out.pdf'), Buffer.from(R.downscale.outB64 || '', 'base64'));
  fs.writeFileSync(path.join(OUTDIR, 'synth.out.pdf'), Buffer.from(R.synth.outB64 || '', 'base64'));
  fs.writeFileSync(path.join(OUTDIR, 'encrypted.pdf'), Buffer.from(R.encrypted.inB64, 'base64'));

  console.log('\n[7] pass ' + pass + ' / fail ' + fail);
  console.log('outputs written to _dev/out/pdf/ for _dev/verify-pdf.py');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
