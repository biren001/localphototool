/* Measure what the compressor actually produces, for publishing.

   The FAQ promises "60–85% smaller" on photographs and claims WebP or AVIF
   beat JPEG by "25–50%". Those should come out of this engine on real encodes
   rather than out of habit — and if a published table ever contradicts them,
   the table is what needs fixing.

   Corpus, all in _dev/corpus and pinned by sha256:

     photo-N.jpg      an already-optimised JPEG, ~0.09–0.20 bytes/pixel.
                      This is what you get when a photo has been through a
                      CMS, a chat app or a previous compression pass.
     photo-N-hq.jpg   the same pixels re-encoded at Q96, ~0.18–0.44 B/px.
                      Stands in for a straight-out-of-camera or phone JPEG,
                      which is what most people actually upload.
     photo-N-lossless.png
                      the same pixels stored losslessly, ~0.8 B/px. This is the
                      "I exported my photo as PNG" case the FAQ talks about, and
                      the table quotes a real number for it instead of a range
                      nobody measured.
     screenshot.png   synthetic UI screenshot, generated here so it is
                      identical on every run.

   The two photo profiles exist because the honest answer to "how much will
   this shrink?" is completely different for each, and a table that only
   reports the flattering one is not worth citing. An earlier run used a
   synthetic smooth-gradient "photo" and reported 90.6% for JPEG: technically
   true, broadly misleading, because a real photograph has far more detail to
   spend bits on.

   Fidelity is measured, not assumed. Every row carries the PSNR of the output
   against the source, so a published "no visible difference" claim can be
   checked against the number next to it.

   Two passes per case. The first pays for the codec download and WASM
   instantiation; the second is the number worth publishing. Reporting the cold
   pass as typical would be a lie about the tool.

   Run: node _dev/measure-compression-matrix.cjs
*/
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const CORPUS = path.join(__dirname, 'corpus');
const PORT = 8817;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
/* Archive rather than scratch: these files are the evidence behind the table
   published on /compress/#measured, and a scratch directory that is cleared
   between runs is a poor place to keep evidence. */
const OUT = path.join(__dirname, 'measured', 'compression-matrix.json');
const OUT_MD = path.join(__dirname, 'measured', 'compression-matrix.md');

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

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}
function kb(n) {
  return Math.round(n / 1024) + ' KB';
}
function pct(from, to) {
  return Math.round((1 - to / from) * 1000) / 10;
}
function mean(list) {
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
}
function mean1(list) {
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length * 10) / 10;
}

/* photo-1.jpg -> 'optimised'; photo-1-hq.jpg -> 'camera'; *.png -> 'photo-png'. */
function profileOf(name) {
  if (/\.png$/i.test(name)) return 'photo-png';
  return /-hq\.jpe?g$/i.test(name) ? 'camera' : 'optimised';
}

/* Every file in _dev/corpus except the screenshot, which is generated here so
   it is byte-identical on every run. */
function loadSources() {
  return fs.readdirSync(CORPUS)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .filter((f) => f !== 'screenshot.png')
    .sort()
    .map((f) => {
      const buf = fs.readFileSync(path.join(CORPUS, f));
      return {
        name: f,
        mime: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg',
        buffer: buf,
        bytes: buf.length,
        hash: sha(buf),
        profile: profileOf(f)
      };
    });
}

/* Deterministic, so a change in the table means the engine changed. */
async function screenshotBuffer(browser) {
  const page = await browser.newPage();
  const out = await page.evaluate(async () => {
    const s = document.createElement('canvas');
    s.width = 1440; s.height = 900;
    const x = s.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 1440, 900);
    x.fillStyle = '#f4f5f7'; x.fillRect(0, 0, 1440, 64);
    x.fillStyle = '#1f6feb'; x.fillRect(40, 20, 120, 24);
    x.fillStyle = '#e6e8eb';
    for (let i = 0; i < 6; i++) x.fillRect(40, 110 + i * 120, 1360, 92);
    x.fillStyle = '#111827';
    x.font = '600 28px system-ui, sans-serif';
    for (let i = 0; i < 6; i++) x.fillText('Row ' + (i + 1) + ' — a line of interface text', 64, 168 + i * 120);
    x.font = '400 18px system-ui, sans-serif';
    x.fillStyle = '#4b5563';
    for (let i = 0; i < 6; i++) x.fillText('Secondary label with flat colour behind it', 64, 196 + i * 120);
    x.fillStyle = '#10b981'; x.fillRect(1180, 110, 220, 92);
    const blob = await new Promise((r) => s.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let str = '';
    for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
    return btoa(str);
  });
  await page.close();
  const buffer = Buffer.from(out, 'base64');
  return { name: 'screenshot.png', mime: 'image/png', buffer: buffer, bytes: buffer.length, hash: sha(buffer), profile: 'screenshot' };
}

/* PSNR of the produced file against the source, on luma, at the smaller of the
   two dimensions. Same definition the engine's own fidelity search uses, so the
   published number and the advertised floor are directly comparable.

   This must be a real function, not a string: page.evaluate() treats a string
   as a bare expression and silently passes no arguments, which returned
   undefined and blew up the very first row. */
async function psnrOf(srcB64) {
  const rows = document.querySelectorAll('.result');
  const row = rows[rows.length - 1];
  const img = row.querySelector('img[src^="blob:"]');
  const outBlob = await (await fetch(img.src)).blob();
  const srcBlob = await (await fetch('data:' + window.__srcMime + ';base64,' + srcB64)).blob();
  const a = await createImageBitmap(srcBlob);
  const b = await createImageBitmap(outBlob);
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
  const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
  ca.getContext('2d').drawImage(a, 0, 0, w, h);
  cb.getContext('2d').drawImage(b, 0, 0, w, h);
  const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
  const db = cb.getContext('2d').getImageData(0, 0, w, h).data;
  let se = 0, n = 0;
  for (let i = 0; i < da.length; i += 4) {
    const la = 0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2];
    const lb = 0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2];
    se += (la - lb) * (la - lb); n++;
  }
  const mse = se / n;
  return {
    psnr: mse === 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / mse) * 10) / 10,
    outW: b.width, outH: b.height
  };
}

async function once(ctx, item, radio, withPsnr) {
  const page = await ctx.newPage();
  await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load', timeout: 90000 });
  if (radio) {
    await page.click(radio);
    await page.waitForTimeout(120);
  }
  await page.evaluate((m) => { window.__srcMime = m; }, item.mime);
  const t0 = Date.now();
  await page.setInputFiles('#fileInput', { name: item.name, mimeType: item.mime, buffer: item.buffer });
  await page.waitForFunction(() => !!document.querySelector('.result [data-act="download"]'),
    null, { timeout: 240000 });
  const ms = Date.now() - t0;
  const out = await page.evaluate(async () => {
    const rows = document.querySelectorAll('.result');
    const row = rows[rows.length - 1];
    const img = row.querySelector('img[src^="blob:"]');
    const blob = await (await fetch(img.src)).blob();
    return {
      mime: blob.type,
      bytes: blob.size,
      badge: (row.querySelector('.badge') || {}).textContent || ''
    };
  });
  let fid = { psnr: null, outW: null, outH: null };
  if (withPsnr) fid = await page.evaluate(psnrOf, item.buffer.toString('base64'));
  await page.close();
  return { ms: ms, ...out, ...fid };
}

const FORMATS = [
  ['JPEG', 'label[for="fmtJpeg"]'],
  ['WebP', 'label[for="fmtWebp"]'],
  ['AVIF', 'label[for="fmtAvif"]']
];

function run() {
  (async () => {
    const browser = await chromium.launch({ executablePath: EXE });
    const photos = loadSources();
    const shot = await screenshotBuffer(browser);

    const rows = [];
    /* One context per source file: the codecs are then fetched once per file
       instead of once per measurement, which is most of the wall time. */
    const sources = photos.concat([shot]);
    for (const item of sources) {
      const isPhoto = item.profile !== 'screenshot';
      /* PNG is offered for everything. It is the wrong output for a photograph
         and the table should say so with a number instead of omitting it. */
      const formats = FORMATS.concat([['PNG', 'label[for="fmtPng"]']]);      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      for (const [label, radio] of formats) {
        /* The cold pass exists to pay for the download; its output is thrown
           away and only its wall time is kept. */
        await once(ctx, item, radio, false);
        const warm = await once(ctx, item, radio, true);
        const row = {
          source: item.name,
          hash: item.hash,
          profile: item.profile,
          kind: isPhoto ? 'photo' : 'screenshot',
          sourceBytes: item.bytes,
          format: label,
          outBytes: warm.bytes,
          outW: warm.outW,
          outH: warm.outH,
          savedPct: pct(item.bytes, warm.bytes),
          psnr: warm.psnr,
          warmMs: warm.ms,
          badge: (warm.badge || '').trim()
        };
        rows.push(row);
        if (typeof row.psnr !== 'number') {
          throw new Error('fidelity was not measured for ' + item.name + ' / ' + label
            + ' — refusing to publish a savings number without it');
        }
        console.log('  ' + item.name.padEnd(19) + label.padEnd(6)
          + kb(item.bytes).padStart(9) + ' -> ' + kb(warm.bytes).padStart(9)
          + '   ' + (row.savedPct + '%').padStart(7)
          + '   ' + (row.psnr.toFixed(1) + ' dB').padStart(8)
          + '   warm ' + (warm.ms + 'ms').padStart(7)
          + '  ' + row.badge);
      }
      await ctx.close();
    }

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));

    /* Aggregate per (profile, format) — this is the shape worth publishing. */
    const groups = [];
    const profiles = ['optimised', 'camera', 'photo-png', 'screenshot'];
    for (const prof of profiles) {
      const formatsHere = ['JPEG', 'WebP', 'AVIF', 'PNG'];
      for (const label of formatsHere) {
        const set = rows.filter((r) => r.profile === prof && r.format === label);
        if (!set.length) continue;
        groups.push({
          profile: prof,
          format: label,
          files: set.length,
          sourceBytes: mean(set.map((r) => r.sourceBytes)),
          outBytes: mean(set.map((r) => r.outBytes)),
          savedPct: mean1(set.map((r) => r.savedPct)),
          savedMin: Math.min.apply(null, set.map((r) => r.savedPct)),
          savedMax: Math.max.apply(null, set.map((r) => r.savedPct)),
          psnr: mean1(set.map((r) => r.psnr)),
          warmMs: mean(set.map((r) => r.warmMs))
        });
      }
    }

    const label = { optimised: 'Already-optimised JPEG', camera: 'Camera / phone JPEG (Q96)', 'photo-png': 'Photograph saved as PNG', screenshot: 'PNG screenshot' };
    let md = '| Source | Output | Before | After | Saved | PSNR | Time (warm) |\n';
    md += '| --- | --- | --- | --- | --- | --- | --- |\n';
    for (const g of groups) {
      md += '| ' + label[g.profile] + ' | ' + g.format + ' | ' + kb(g.sourceBytes) + ' | ' + kb(g.outBytes) + ' | '
        + g.savedPct + '% | ' + g.psnr + ' dB | ' + g.warmMs + ' ms |\n';
    }
    fs.writeFileSync(OUT_MD, md);

    console.log('\n--- averages (per source profile x output format) ---');
    for (const g of groups) {
      console.log('  ' + g.profile.padEnd(11) + g.format.padEnd(6)
        + kb(g.sourceBytes).padStart(9) + ' -> ' + kb(g.outBytes).padStart(9)
        + '   ' + (g.savedPct + '%').padStart(7)
        + '   ' + (g.psnr + ' dB').padStart(8)
        + '   ' + (g.warmMs + 'ms').padStart(8));
    }

    console.log('\nwrote ' + OUT);
    console.log('wrote ' + OUT_MD);
    await browser.close();
    srv.close();
  })().catch((e) => { console.error('FATAL', e.message); srv.close(); process.exit(1); });
}
