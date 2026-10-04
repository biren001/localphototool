/* measure-pdf — what is a PDF made of, and what a re-compress actually buys.
   v80 added /compress-pdf/; this is the measurement behind it.

   Two questions, both answered with bytes rather than opinions:
    1. In a real PDF, what fraction of the file is embedded images?
    2. If we re-encode those images at a lower quality, how much does the
       whole file shrink — and how much quality does it cost?

   Fixtures are generated here (Chromium's own print-to-PDF) with a seeded
   PRNG, so a re-run lands on the same numbers. They are dev-only: the fixtures
   live in _dev/fixtures/ and never reach localphototool/.

   Everything runs through the site's own engine (window.LPT.engine on the live
   /compress/ page), because that is the code the shipped tool uses. The PDF is
   handed in as base64 and comes back as a base64 blob of the new file. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const WS = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS, 'localphototool');
const FIX = path.join(WS, '_dev', 'fixtures');
const OUT = path.join(WS, '_dev', 'measured', 'pdf-recompression.json');
const PORT = 8823;
const EXE = process.env.CHROME_EXE ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

/* Seeded PRNG — without it the "photos" differ every run and the numbers do
   not survive a re-run, which the project does not accept as evidence.
   Installed as an init script so every page in the fixture build shares it. */
function seedRand() {
  window.__seed = 0x9e3779b9;
  window.__rnd = function () {
    window.__seed |= 0; window.__seed = (window.__seed + 0x6D2B79F5) | 0;
    var t = Math.imul(window.__seed ^ (window.__seed >>> 15), 1 | window.__seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/* ---------- 1. build the fixtures ---------- */

async function buildFixtures(browser) {
  const page = await browser.newPage();
  if (!fs.existsSync(FIX)) fs.mkdirSync(FIX, { recursive: true });

  await page.addInitScript(seedRand, 'mulberry32');

  await page.goto('about:blank');

  /* seeded photo -> data URL, printed at its native size so the embedded JPEG
     is the same bitstream every run */
  async function photo(w, h, q) {
    return page.evaluate(async (a) => {
      const c = document.createElement('canvas');
      c.width = a.w; c.height = a.h;
      const x = c.getContext('2d');
      const rnd = window.__rnd;
      const g = x.createLinearGradient(0, 0, a.w, a.h);
      g.addColorStop(0, 'hsl(' + (rnd() * 360 | 0) + ',72%,58%)');
      g.addColorStop(1, 'hsl(' + (rnd() * 360 | 0) + ',68%,32%)');
      x.fillStyle = g; x.fillRect(0, 0, a.w, a.h);
      for (let i = 0; i < 2500; i++) {
        x.fillStyle = 'hsla(' + (rnd() * 360 | 0) + ',' + (20 + rnd() * 60 | 0) + '%,' + (20 + rnd() * 60 | 0) + '%,.45)';
        x.fillRect(rnd() * a.w, rnd() * a.h, 4 + rnd() * 50, 4 + rnd() * 50);
      }
      return c.toDataURL('image/jpeg', a.q);
    }, { w: w, h: h, q: q });
  }

  /* text-only: no image at all */
  await page.setContent('<!doctype html><meta charset="utf-8">' +
    '<style>body{font:11pt serif;margin:1.7cm}p{margin:0 0 9pt;text-align:justify}</style>' +
    '<p>' + ('The quick brown fox jumps over the lazy dog. Sphinx of black quartz, judge my vow. ').repeat(9) + '</p>'.repeat(40));
  const textPdf = await page.pdf({ format: 'A4' });
  fs.writeFileSync(path.join(FIX, 'text-only.pdf'), textPdf);

  /* photos: four 2400x1600 JPEGs at q0.92, all native size */
  const urls = [];
  for (let i = 0; i < 4; i++) urls.push(await photo(2400, 1600, 0.92));
  await page.setContent('<!doctype html><meta charset="utf-8"><style>' +
    'body{margin:0}figure{margin:0;page-break-after:always}img{width:100%;display:block}' +
    '</style>' + urls.map(function (u, i) {
      return '<figure><img src="' + u + '"><figcaption style="font:10pt sans-serif;padding:4pt">plate ' + (i + 1) + '</figcaption></figure>';
    }).join(''));
  const photoPdf = await page.pdf({ format: 'A4', printBackground: true });
  fs.writeFileSync(path.join(FIX, 'photos.pdf'), photoPdf);

  /* mixed: body text around one photo, the everyday case */
  const mix = await photo(1600, 1000, 0.92);
  await page.setContent('<!doctype html><meta charset="utf-8"><style>' +
    'body{font:11pt serif;margin:1.5cm}p{margin:0 0 8pt}img{width:100%;display:block;margin:6pt 0}' +
    '</style><p>' + ('Paragraph of ordinary body text. ').repeat(38) + '</p>' +
    '<img src="' + mix + '">' +
    '<p>' + ('Another stretch of body text after the image. ').repeat(38) + '</p>');
  const mixedPdf = await page.pdf({ format: 'A4', printBackground: true });
  fs.writeFileSync(path.join(FIX, 'mixed.pdf'), mixedPdf);

  await page.close();
  return {
    'text-only.pdf': textPdf,
    'photos.pdf': photoPdf,
    'mixed.pdf': mixedPdf
  };
}

/* ---------- 2. census + re-compress, inside the site page ---------- */

async function measure(page, name, buf) {
  return page.evaluate(async (a) => {
    const bin = atob(a.b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

    /* -- census: walk `N 0 obj … endobj`, read only what we need -- */
    const s = new TextDecoder('latin1').decode(u8);
    const objs = [];
    const re = /(\d+)\s+0\s+obj\b/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const start = m.index + m[0].length;
      const end = s.indexOf('endobj', start);
      if (end === -1) continue;
      const body = s.slice(start, end);
      const o = {
        num: Number(m[1]),
        type: (body.match(/\/Type\s*\/(\w+)/) || [])[1] || '',
        subtype: (body.match(/\/Subtype\s*\/(\w+)/) || [])[1] || '',
        filter: (body.match(/\/Filter\s*\/(\w+)/) || [])[1] || '',
        masked: /\/SMask|\/Mask\b/.test(body),
        imageMask: /\/ImageMask\s+true/.test(body),
        encrypted: /\/Encrypt\b/.test(s.slice(0, 4096))
      };
      const sm = body.indexOf('stream');
      if (sm !== -1) {
        let sd = sm + 6;
        if (body[sd] === '\r') sd += 1;
        if (body[sd] === '\n') sd += 1;
        const de = body.indexOf('endstream');
        o.streamBytes = Math.max(0, de - sd);
        o.streamStart = a.byteBase + start + sd;
      }
      objs.push(o);
    }
    const images = objs.filter(function (o) { return o.subtype === 'Image'; });
    const imgBytes = images.reduce(function (t, o) { return t + (o.streamBytes || 0); }, 0);
    const byFilter = {};
    images.forEach(function (o) { byFilter[o.filter] = (byFilter[o.filter] || 0) + (o.streamBytes || 0); });

    /* -- the part that matters: re-encode every DCTDecode image with OUR
          engine at the quality the shipped tool uses, and price it -- */
    const q = 0.6;
    const maxDim = 0; // 0 = no downscale, matching the default tool setting
    const E = window.LPT.engine;
    let before = 0, after = 0, qualityErrors = 0;
    const rows = [];
    for (const img of images) {
      if (img.filter !== 'DCTDecode' || img.masked || img.imageMask) {
        rows.push({ skipped: true, filter: img.filter, masked: img.masked || img.imageMask, bytes: img.streamBytes || 0 });
        continue;
      }
      before += img.streamBytes || 0;
      const off = img.streamStart;
      const endIdx = s.indexOf('endstream', off);
      const raw = u8.slice(off, endIdx);
      let srcBmp;
      try {
        srcBmp = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }));
      } catch (err) {
        qualityErrors++;
        rows.push({ skipped: true, filter: img.filter, bytes: img.streamBytes || 0, reason: 'decode failed' });
        continue;
      }
      let cw = srcBmp.width, ch = srcBmp.height;
      if (maxDim && Math.max(cw, ch) > maxDim) {
        const k = maxDim / Math.max(cw, ch);
        cw = Math.round(cw * k); ch = Math.round(ch * k);
      }
      /* drawResized needs all six arguments; with sw/sh/dw/dh undefined it
         draws nothing at all and the re-encode lands on an empty canvas. */
      const canvas = E.createCanvas(cw, ch);
      if (maxDim && (srcBmp.width !== cw || srcBmp.height !== ch)) {
        E.drawResized(canvas, srcBmp, srcBmp.width, srcBmp.height, cw, ch);
      } else {
        canvas.getContext('2d').drawImage(srcBmp, 0, 0);
      }
      const enc = await E.encodeCanvas(canvas, 'jpeg', q, {});
      after += enc.blob.size;
      rows.push({ before: raw.length, after: enc.blob.size, w: srcBmp.width, h: srcBmp.height, encoder: enc.encoder });
    }

    return {
      file: a.name,
      totalBytes: u8.length,
      pageCount: objs.filter(function (o) { return o.type === 'Page'; }).length,
      objectCount: objs.length,
      imageCount: images.length,
      imageBytes: imgBytes,
      imageShareOfFile: u8.length ? imgBytes / u8.length : 0,
      imageBytesByFilter: byFilter,
      objStmCount: objs.filter(function (o) { return o.type === 'ObjStm'; }).length,
      encrypted: objs.some(function (o) { return o.encrypted; }),
      recompressedImageBytesBefore: before,
      recompressedImageBytesAfter: after,
      imageShrink: before ? 1 - after / before : 0,
      wholeFileProjection: u8.length - (before - after),
      qualityErrors: qualityErrors,
      images: rows
    };
  }, { name: name, b64: buf.toString('base64'), byteBase: 0 });
}

(async function () {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const fixtures = await buildFixtures(browser);

  /* the rewrite happens on the real /compress/ page, which already loads
     engine.js — no second copy of the encoder */
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/compress/', { waitUntil: 'load' });
  await page.waitForFunction('!!(window.LPT && window.LPT.engine)');

  const report = {};
  for (const k of Object.keys(fixtures)) {
    report[k] = await measure(page, k, fixtures[k]);
    delete report[k].__x;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    taken: new Date().toISOString(),
    method: 'Chromium print-to-PDF fixtures, seeded PRNG; images re-encoded with window.LPT.engine at quality 0.60, no downscale.',
    fixtures: (fs.readdirSync(FIX)).map(function (f) { return '_dev/fixtures/' + f; }),
    engine: await page.evaluate(() => ({ wasm: window.LPT.engine.currentWasm ? String(window.LPT.engine.currentWasm()) : 'none' })),
    results: report
  }, null, 2));

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
})();
