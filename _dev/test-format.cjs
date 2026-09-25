/* Verify that an explicit output-format choice is actually honoured.
   The bug being hunted: AVIF selection silently produced WebP, because
   format resolution only looked at *native* browser encoders and every
   browser reports "cannot encode AVIF", even though the WASM codec can. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8813;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

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

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

/* A noisy gradient the analyser reads as a photograph. */
async function makePhotoBuffer(browser) {
  const p = await browser.newPage();
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 750;
    const x = c.getContext('2d');
    const img = x.createImageData(1000, 750);
    const d = img.data;
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < 750; y++) {
      for (let xx = 0; xx < 1000; xx++) {
        const i = (y * 1000 + xx) * 4;
        const base = 40 + 170 * (xx / 1000) + 55 * Math.sin(y / 45);
        const v = base + (rnd() - 0.5) * 34;
        d[i] = Math.max(0, Math.min(255, v));
        d[i + 1] = Math.max(0, Math.min(255, v * 0.86 + 18));
        d[i + 2] = Math.max(0, Math.min(255, v * 0.72 + 48));
        d[i + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  });
  await p.close();
  return Buffer.from(b64, 'base64');
}

/* Compress one photo with the given format radio checked, then read back
   what the *actual output bytes* are — not what the UI claims. */
async function compressAs(browser, radio, photo) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const cdn = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (/esm\.sh|jsdelivr/.test(r.url())) cdn.push(r.url().replace(/\?.*$/, '')); });
  await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
  if (radio) {
    await page.click(radio);
    await page.waitForTimeout(150);
    const on = await page.evaluate((sel) => {
      const id = document.querySelector(sel).getAttribute('for');
      return document.getElementById(id).checked;
    }, radio);
    if (!on) throw new Error('format radio did not switch: ' + radio);
  }
  await page.setInputFiles('#fileInput', { name: 'photo.png', mimeType: 'image/png', buffer: photo });
  /* waitForFunction(fn, arg, options): the timeout has to travel as the THIRD
     argument. Passed second it silently became the page function's argument, so
     the intended 180s was really Playwright's 30s default — which is how a
     cold-AVIF run turned into "page.waitForFunction: Timeout 30000ms exceeded". */
  await page.waitForFunction(() => !!document.querySelector('.result [data-act="download"]'),
    null, { timeout: 180000 });
  await page.waitForTimeout(500);

  /* What the page did on the way here. Without this an AVIF case that quietly
     came back as WebP says nothing about why: whether its encoder was ever
     requested, and whether the panel ever saw it, is the difference between
     "the codec failed" and "the format was never really selected". */
  const wentFor = cdn.filter((u) => /@jsquash|esm\.sh\/[^/]*avif|\.wasm/.test(u));
  console.log('    [net] cdn=' + cdn.length + ' avif=' +
    cdn.filter((u) => /avif/i.test(u)).length + '  ' +
    (wentFor.slice(0, 2).join(' | ') || 'no codec requested'));
  console.log('    [engine] ' + (await page.textContent('#engineStatus')).replace(/\s+/g, ' ').trim().slice(0, 110));

  const out = await page.evaluate(async () => {
    const img = document.querySelector('.result img[src^="blob:"]');
    const res = await fetch(img.src);
    const blob = await res.blob();
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    /* A file with the right magic bytes can still be unopenable — re-decode
       it, because AVIF is exactly where that tends to show up. */
    let decoded = { ok: false, err: 'not attempted' };
    try {
      const bmp = await createImageBitmap(blob);
      decoded = { ok: true, w: bmp.width, h: bmp.height };
    } catch (e) { decoded = { ok: false, err: String(e && e.message || e).slice(0, 90) }; }
    return {
      mime: blob.type,
      bytes: blob.size,
      decoded: decoded,
      badge: (document.querySelector('.result .badge') || {}).textContent || '',
      magic: Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join('')
    };
  });
  await ctx.close();
  return { ...out, errors };
}

/* AVIF boxes start with ....ftypavif / JPEG starts with ffd8 / PNG 89504e47 / RIFF+WEBP */
function looksLike(bytes, key) {
  const m = bytes.magic;
  if (key === 'avif') return m.indexOf('66747970') >= 0 && /61766966|61766973/.test(m.slice(0, 40));
  if (key === 'jpeg') return m.indexOf('ffd8') === 0;
  if (key === 'png') return m.indexOf('89504e47') === 0;
  if (key === 'webp') return m.indexOf('52494646') === 0;
  return false;
}

function run() {
  (async () => {
    const browser = await chromium.launch({ executablePath: EXE });
    const photo = await makePhotoBuffer(browser);

    const cases = [
      ['label[for="fmtAvif"]', 'avif', 'AVIF'],
      ['label[for="fmtWebp"]', 'webp', 'WebP'],
      ['label[for="fmtJpeg"]', 'jpeg', 'JPEG'],
      ['label[for="fmtPng"]', 'png', 'PNG']
    ];

    for (const [radio, key, label] of cases) {
      console.log('\n=== ' + label + ' selected ===');
      const out = await compressAs(browser, radio, photo);
      check(label + ': output mime is image/' + key, out.mime === 'image/' + key,
        out.mime + '  (' + out.bytes + ' bytes)');
      check(label + ': file magic matches ' + key.toUpperCase(), looksLike(out, key),
        out.magic);
      /* An explicit PNG on a photograph is legitimately bigger than the
         source, and the app then keeps the original — still a PNG. */
      check(label + ': the badge agrees',
        new RegExp(key === 'jpeg' ? 'JPG' : key, 'i').test(out.badge) || /Original kept/.test(out.badge),
        out.badge.trim());

      check(label + ': the output actually decodes', out.decoded.ok,
        out.decoded.ok ? out.decoded.w + '×' + out.decoded.h : out.decoded.err);
      check(label + ': no JS errors', out.errors.length === 0, out.errors[0] || 'clean');
    }

    console.log('\n=== auto on a photograph ===');
    const auto = await compressAs(browser, null, photo);
    check('auto picks a modern lossy format', /webp|avif/.test(auto.mime), auto.mime + ' — ' + auto.badge.trim());

    await browser.close();
    srv.close();
    const passed = results.filter(Boolean).length;
    console.log('\n' + passed + ' / ' + results.length + ' format checks passed');
    process.exit(passed === results.length ? 0 : 1);
  })().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}
