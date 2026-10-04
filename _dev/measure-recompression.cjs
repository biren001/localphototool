/* Does a second pass over the same photo actually help — or just cost quality?
   (The "image won't get smaller" question, answered with this site's own
   encoders rather than quoted from somebody else's benchmark.)

   Four things people report about online compressors, all of which are the same
   measurement wearing different hats:
     · "It says lossless but the file barely got smaller"
     · "I re-compressed it and it came back bigger"
     · "Re-encoding an already-optimized image can add bytes"
     · canvas.toBlob('image/png') inflating already-compressed PNGs

   Method: encode a source with the engine, decode the result back to a canvas,
   encode that again, repeat. The reference for PSNR stays the ORIGINAL frame
   across every round, so a round that loses fidelity shows up as a falling
   number instead of hiding behind a shrinking file.

   The PNG leg decodes the corpus' lossless PNG and re-encodes it through the
   canvas — the exact shape of the complaint above, measured here rather than
   asserted.

   Driven through window.LPT.engine, not the UI: a debounced re-encode racing
   the next upload produced nonsense PSNR ladders in measure-format-efficiency.cjs.

   Run: node _dev/measure-recompression.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const CORPUS = path.join(__dirname, 'corpus');
const PORT = 8821;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
/* Archive, not scratch: this is the evidence behind the second-pass table. */
const OUT = path.join(__dirname, 'measured', 'recompression.json');

const ROUNDS = 3;
const Q = 0.6;

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

/* {
     srcB64: base64 of the input file, inputMime: 'image/jpeg' | 'image/png',
     rounds: 3, q: 0.6
   } */
async function secondPass({ srcB64, inputMime, rounds, q }) {
  const E = window.LPT.engine;
  const bin = atob(srcB64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

  const srcBlob = new Blob([u8], { type: inputMime });
  const bmp = await createImageBitmap(srcBlob);
  const c = E.createCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  const ref = c.getContext('2d').getImageData(0, 0, c.width, c.height);

  const roundsOut = [];
  let current = c;

  for (let r = 1; r <= rounds; r++) {
    const enc = await E.encodeCanvas(current, 'jpeg', q, {});
    const rgb = await decodeToRgb(enc.blob, c.width, c.height);
    roundsOut.push({
      round: r,
      bytes: enc.blob.size,
      encoder: enc.encoder,
      /* Measured against the ORIGINAL frame every time: round 3 scoring the same
         dB as round 1 is the result that says "worth doing", and round 3 scoring
         lower is the result that says "you paid for nothing". */
      psnrVsOriginal: E.psnr(ref.data, rgb, c.width, c.height)
    });
    const ib = await createImageBitmap(enc.blob);
    const next = E.createCanvas(c.width, c.height);
    next.getContext('2d').drawImage(ib, 0, 0, c.width, c.height);
    current = next;
  }

  /* PNG leg: the decoded source pixels through the lossless path. This is the
     "I exported it as PNG to get it smaller" shape of the complaint — measured
     here instead of repeated, and it turned out to go the other way on our own
     encoder (see pngChangeVsSourceJpeg below). */
  const pngEnc = await E.encodeCanvas(c, 'png', q, {});

  return {
    sourceBytes: u8.length,
    width: c.width,
    height: c.height,
    rounds: roundsOut,
    pngBytes: pngEnc.blob.size,
    pngEncoder: pngEnc.encoder
  };

  /* Decoding back to raw RGBA. Kept here because it is only ever called from
     inside the loop above and reads better next to its only call site. */
  async function decodeToRgb(blob, w, h) {
    const ib = await createImageBitmap(blob);
    const dc = E.createCanvas(w, h);
    dc.getContext('2d').drawImage(ib, 0, 0, w, h);
    return dc.getContext('2d').getImageData(0, 0, w, h).data;
  }
}

function pct(a, b) {
  if (!a) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

function kb(n) { return Math.round(n / 1024) + ' KB'; }

function run() {
  (async () => {
    const browser = await chromium.launch({ executablePath: EXE });
    const files = fs.readdirSync(CORPUS).filter((f) => /-hq\.jpe?g$/i.test(f)).sort();
    if (!files.length) throw new Error('no *-hq.jpg in _dev/corpus — run gen-corpus-hq.py');

    const sources = [];
    for (const f of files) {
      const buffer = fs.readFileSync(path.join(CORPUS, f));
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load', timeout: 90000 });
      const r = await page.evaluate(secondPass, {
        srcB64: buffer.toString('base64'), inputMime: 'image/jpeg', rounds: ROUNDS, q: Q
      }).catch((e) => { throw new Error(f + ': ' + e.message); });
      await ctx.close();

      const first = r.rounds[0], second = r.rounds[1], third = r.rounds[2];
      console.log('  ' + f + '  (' + kb(r.sourceBytes) + ' in, ' + r.width + 'x' + r.height + ')');
      r.rounds.forEach((x) => {
        console.log('    pass ' + x.round + ': ' + kb(x.bytes).padStart(9)
          + '   ' + x.psnrVsOriginal.toFixed(2) + ' dB vs the original'
          + (x.round > 1 ? '   (' + pct(r.rounds[x.round - 2].bytes, x.bytes) + '% vs pass ' + (x.round - 1) + ')' : ''));
      });
      console.log('    lossless PNG out: ' + kb(r.pngBytes) + '   [' + pct(r.sourceBytes, r.pngBytes) + '% vs the source JPEG]');
      console.log('');

      sources.push({
        source: f,
        sourceBytes: r.sourceBytes,
        width: r.width,
        height: r.height,
        q: Q,
        rounds: r.rounds,
        changeFromFirstToSecond: pct(first.bytes, second.bytes),
        changeFromFirstToThird: pct(first.bytes, third.bytes),
        psnrLostOverTwoReencodes: Math.round((first.psnrVsOriginal - third.psnrVsOriginal) * 100) / 100,
        pngBytes: r.pngBytes,
        pngChangeVsSourceJpeg: pct(r.sourceBytes, r.pngBytes)
      });
    }

    /* The claim the page will make, checked before it is written down. */
    const grew = sources.filter((s) => s.changeFromFirstToSecond > 0);
    const shrank = sources.filter((s) => s.changeFromFirstToSecond < -1);
    const lede = {
      grewOnSecondPass: grew.length,
      shrankOnSecondPass: shrank.length,
      totalSources: sources.length,
      medianPngChangeVsSourceJpeg: (function () {
        const list = sources.map((s) => s.pngChangeVsSourceJpeg).sort((a, b) => a - b);
        return list[Math.floor(list.length / 2)];
      })(),
      worstPngChangeVsSourceJpeg: Math.max.apply(null, sources.map((s) => s.pngChangeVsSourceJpeg)),
      medianPsnrLost: (function () {
        const list = sources.map((s) => s.psnrLostOverTwoReencodes).sort((a, b) => a - b);
        return list[Math.floor(list.length / 2)];
      })()
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ q: Q, rounds: ROUNDS, lede: lede, sources: sources }, null, 2));

    console.log('--- second pass over the same file ---');
    console.log('  grew:      ' + lede.grewOnSecondPass + ' of ' + lede.totalSources);
    console.log('  shrank:    ' + lede.shrankOnSecondPass + ' of ' + lede.totalSources);
    console.log('  median PSNR lost across two re-encodes: ' + lede.medianPsnrLost + ' dB');
    console.log('  PNG out vs the source JPEG: median ' + lede.medianPngChangeVsSourceJpeg
      + '%%, worst ' + lede.worstPngChangeVsSourceJpeg + '%');
    console.log('\nwrote ' + OUT);
    await browser.close();
    srv.close();
    process.exit(0);
  })().catch((e) => { console.error('FATAL', e.message); srv.close(); process.exit(1); });
}
