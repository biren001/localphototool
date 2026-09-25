/* Does the "25-50% smaller than JPEG at the same visual quality" claim survive
   measurement?

   That sentence is on /compress/ and in llms.txt, and it is the kind of number
   an AI assistant will happily repeat. It is also the kind of number that is
   easy to inherit from a vendor blog post and never check. This measures it on
   this site's own encoders.

   Method: hold one source canvas fixed, sweep quality for each format through
   the engine's own encodeCanvas(), and record (bytes, PSNR) for every point.
   Then interpolate each format's size at a common fidelity target. Comparing
   sizes at *equal* PSNR is the only way the comparison means anything —
   comparing Auto output to Auto output compares two different quality
   decisions, not two codecs.

   Driven through window.LPT.engine rather than the UI. The first version of
   this script clicked the DOM instead, and reported JPEG at Q75 as 57.1 dB —
   higher than Q90's 49.9 dB. PSNR cannot rise as quality falls; the numbers
   were a race between the debounced re-encode and the next upload, and they
   would have been published. Talking to the engine directly removes the
   timing question, and MONOTONIC below refuses to report a ladder that does not
   behave like a ladder.

   Only the camera-profile photos are swept: they are the inputs people
   actually upload, and at that bitrate the formats genuinely differ.

   Run: node _dev/measure-format-efficiency.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const CORPUS = path.join(__dirname, 'corpus');
const PORT = 8819;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
/* Archive, not scratch: this is the evidence behind the equal-fidelity table on
   /compress/#measured. */
const OUT = path.join(__dirname, 'measured', 'format-efficiency.json');

/* The fidelity target to compare at. 40 dB is the number the site quotes, so
   the comparison is made exactly where the product makes its promise. */
const TARGET_DB = 40.0;
const SWEEP = [50, 60, 70, 80, 90];

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.normalize(path.join(WS_ROOT, p)), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(PORT, run);

/* Everything below runs inside the page, against the real engine.

   One object parameter, not two: page.evaluate() hands the page function a
   single argument, so a two-parameter signature silently binds the whole
   payload to the first name. */
async function sweepOne({ srcB64, sweep }) {
  const E = window.LPT.engine;
  /* Built by hand rather than fetched from a data: URL — the CSP on this site
     does not allow one, and "Failed to fetch" from inside an evaluator is a
     needlessly obscure way to find that out. */
  const bin = atob(srcB64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const srcBlob = new Blob([u8], { type: 'image/jpeg' });
  const bmp = await createImageBitmap(srcBlob);
  const c = E.createCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  const ref = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const out = [];
  for (const format of ['jpeg', 'webp', 'avif']) {
    await E.preload([format]);
    for (const q of sweep) {
      const r = await E.encodeCanvas(c, format, q / 100, {});
      const ib = await createImageBitmap(r.blob);
      /* Decode back onto a canvas of exactly the source size: engine.psnr
         indexes both arrays at the same stride, so a size mismatch does not
         error, it silently compares the wrong pixels. */
      const dc = E.createCanvas(c.width, c.height);
      dc.getContext('2d').drawImage(ib, 0, 0, c.width, c.height);
      const dec = dc.getContext('2d').getImageData(0, 0, c.width, c.height);
      out.push({
        format: format,
        q: q,
        bytes: r.blob.size,
        psnr: E.psnr(ref.data, dec.data, c.width, c.height),
        encoder: r.encoder,
        outW: ib.width,
        outH: ib.height,
        srcW: c.width,
        srcH: c.height
      });
    }
  }
  return out;
}

/* Size at TARGET_DB by linear interpolation in log(bytes) vs dB space. Null
   when the target falls outside the swept range, rather than extrapolating a
   number nobody measured. */
function sizeAt(points, target) {
  const pts = points.slice().sort((x, y) => x.psnr - y.psnr);
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1], hi = pts[i];
    if (target >= lo.psnr && target <= hi.psnr && hi.psnr > lo.psnr) {
      const t = (target - lo.psnr) / (hi.psnr - lo.psnr);
      const lg = Math.log(lo.bytes) + t * (Math.log(hi.bytes) - Math.log(lo.bytes));
      return Math.round(Math.exp(lg));
    }
  }
  return null;
}

function run() {
  (async () => {
    const browser = await chromium.launch({ executablePath: EXE });
    const files = fs.readdirSync(CORPUS).filter((f) => /-hq\.jpe?g$/i.test(f)).sort();
    if (!files.length) throw new Error('no *-hq.jpg in _dev/corpus — run gen-corpus-hq.py');

    const points = [];
    let monotonic = true;

    for (const f of files) {
      const buffer = fs.readFileSync(path.join(CORPUS, f));
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load', timeout: 90000 });
      const rows = await page.evaluate(sweepOne, { srcB64: buffer.toString('base64'), sweep: SWEEP })
        .catch(async (e) => { throw new Error(f + ': ' + e.message); });
      await ctx.close();

      const native = rows.filter((r) => r.encoder !== 'wasm').map((r) => r.format + '@Q' + r.q);
      console.log('  ' + f + (native.length ? '   [native fallback: ' + native.join(', ') + ']' : ''));

      for (const format of ['jpeg', 'webp', 'avif']) {
        const set = rows.filter((r) => r.format === format).sort((a, b) => a.q - b.q);
        for (const r of set) {
          points.push(Object.assign({ source: f }, r));
          console.log('    ' + format.toUpperCase().padEnd(5) + ('Q' + r.q).padEnd(5)
            + (Math.round(r.bytes / 1024) + ' KB').padStart(9)
            + '   ' + r.psnr.toFixed(1).padStart(5) + ' dB'
            + '   ' + r.outW + 'x' + r.outH
            + (r.encoder === 'wasm' ? '' : '   NATIVE'));
        }
        for (let i = 1; i < set.length; i++) {
          if (set[i].psnr < set[i - 1].psnr - 0.05) {
            monotonic = false;
            console.log('    !! ' + format + ' PSNR fell from Q' + set[i - 1].q + ' (' + set[i - 1].psnr.toFixed(1)
              + ' dB) to Q' + set[i].q + ' (' + set[i].psnr.toFixed(1) + ' dB) — measurement is not trustworthy');
          }
        }
      }
    }

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ target: TARGET_DB, sweep: SWEEP, monotonic: monotonic, points: points }, null, 2));

    console.log('\n--- PSNR is monotonic in quality: ' + (monotonic ? 'yes' : 'NO — results below are void') + ' ---');

    console.log('\n--- bytes needed to reach ' + TARGET_DB + ' dB (interpolated per source) ---');
    const perFormat = { jpeg: [], webp: [], avif: [] };
    const bySource = {};
    for (const p of points) {
      bySource[p.source] = bySource[p.source] || {};
      (bySource[p.source][p.format] = bySource[p.source][p.format] || []).push({ psnr: p.psnr, bytes: p.bytes });
    }
    for (const src of Object.keys(bySource).sort()) {
      const line = [];
      for (const format of ['jpeg', 'webp', 'avif']) {
        const s = sizeAt(bySource[src][format] || [], TARGET_DB);
        line.push(format.toUpperCase() + '=' + (s === null ? 'n/a' : Math.round(s / 1024) + 'KB'));
        if (s !== null) perFormat[format].push(s);
      }
      console.log('  ' + src.padEnd(16) + line.join('   '));
    }

    console.log('\n--- averaged over ' + files.length + ' photographs ---');
    const avg = {};
    for (const format of ['jpeg', 'webp', 'avif']) {
      const list = perFormat[format];
      avg[format] = list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
      console.log('  ' + format.toUpperCase().padEnd(6) + (avg[format] === null ? 'n/a'
        : Math.round(avg[format] / 1024) + ' KB').padStart(9)
        + (list.length < files.length ? '   (only ' + list.length + ' of ' + files.length + ' sources)' : ''));
    }
    for (const format of ['webp', 'avif']) {
      if (avg[format] && avg.jpeg) {
        const smaller = Math.round((1 - avg[format] / avg.jpeg) * 1000) / 10;
        console.log('  ' + format.toUpperCase() + ' vs JPEG at equal fidelity: ' + smaller + '% smaller');
      }
    }

    console.log('\nwrote ' + OUT);
    await browser.close();
    srv.close();
    process.exit(monotonic ? 0 : 1);
  })().catch((e) => { console.error('FATAL', e.message); srv.close(); process.exit(1); });
}
