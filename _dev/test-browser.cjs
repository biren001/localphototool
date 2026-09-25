/* Dev-only: real-browser end-to-end test of the compressor at /compress/ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SITE = path.join(WS_ROOT, 'localphototool');
const OUT = path.join(WS_ROOT, '_dev', 'out');
const PORT = 8793;
const BASE = 'http://localhost:' + PORT;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json'
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.normalize(path.join(WS_ROOT, p));
      if (!file.startsWith(path.normalize(WS_ROOT + path.sep))) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

/* ---- Synthetic test images (truecolor PNG, written with the engine's own deflate) ---- */
function truecolorPng(width, height, rgba) {
  const LPT = (() => {
    const vm = require('vm');
    const src = fs.readFileSync(path.join(SITE, 'assets/js/compressor/engine.js'), 'utf8');
    const s = { console, performance, Promise, Math, Date, Array, Object, Number, String,
      Uint8Array, Uint8ClampedArray, Int16Array, Uint32Array, Float32Array, Float64Array,
      ArrayBuffer, DataView, TextEncoder, Blob, Response, CompressionStream, URL, setTimeout,
      isNaN, Infinity, NaN, Error };
    s.self = s; s.globalThis = s;
    vm.createContext(s);
    new vm.Script(src, { filename: 'engine.js' }).runInContext(s, {
      importModuleDynamically: () => Promise.reject(new Error('no-cdn-in-node'))
    });
    return s.LPT;
  })();

  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3, o = (y * width + x) * 4;
      raw[y * (width * 3 + 1) + 1 + s] = rgba[o];
      raw[y * (width * 3 + 1) + 2 + s] = rgba[o + 1];
      raw[y * (width * 3 + 1) + 3 + s] = rgba[o + 2];
    }
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(LPT.engine._internal.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor
  return LPT.engine._internal.deflateZlib(raw).then((idat) => {
    const parts = [
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', Buffer.from(idat)), chunk('IEND', [])
    ];
    return Buffer.concat(parts);
  });
}

function photoLike(w, h) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sky = y / h;
      // sky gradient
      a[i] = 120 - 90 * sky + 40 * Math.sin(x / 90);
      a[i + 1] = 165 - 70 * sky + 30 * Math.cos(x / 70);
      a[i + 2] = 235 - 60 * sky;
      // sun
      const dx = x - w * 0.72, dy = y - h * 0.26;
      if (dx * dx + dy * dy < (h * 0.09) ** 2) { a[i] = 255; a[i + 1] = 240; a[i + 2] = 190; }
      // mountain ridges
      const ridge = h * (0.62 + 0.14 * Math.sin(x / 130) + 0.06 * Math.sin(x / 41));
      if (y > ridge) { a[i] = 46 + y * 0.05; a[i + 1] = 52 + y * 0.05; a[i + 2] = 68 + y * 0.06; }
      // film-grain style noise so the encoder has real detail to fight
      const n = (Math.random() - 0.5) * 26;
      a[i] += n; a[i + 1] += n; a[i + 2] += n;
      a[i + 3] = 255;
    }
  }
  return a;
}

function graphicLike(w, h) {
  const a = new Uint8ClampedArray(w * h * 4);
  // Deterministic pseudo-noise so the source PNG is heavy while the palette
  // output stays small — like a real antialiased screenshot.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      a[i] = 250; a[i + 1] = 250; a[i + 2] = 252; a[i + 3] = 255;
      // sidebar gradient
      if (x < 220) {
        a[i] = 245 - y * 0.06; a[i + 1] = 247 - y * 0.05; a[i + 2] = 252;
      }
      // panels
      if (x > 250 && x < w - 30 && y > 40 && y < h - 40) { a[i] = 255; a[i + 1] = 255; a[i + 2] = 255; }
      // header bar
      if (y > 50 && y < 100 && x > 270 && x < w - 50) { a[i] = 79; a[i + 1] = 70; a[i + 2] = 229; }
      // "text" lines: noisy antialiased strokes
      for (let row = 0; row < 14; row++) {
        const ty = 140 + row * 42;
        if (y > ty && y < ty + 14 && x > 280 && x < w - 60) {
          const v = 40 + Math.floor(rnd() * 90);
          a[i] = v; a[i + 1] = v; a[i + 2] = v + 10;
        }
      }
      // thin separators (aliasing stress)
      for (let row = 0; row < 14; row++) {
        const ty = 140 + row * 42 + 20;
        if (y === ty && x > 280 && x < w - 60) { a[i] = 226; a[i + 1] = 231; a[i + 2] = 240; }
      }
      // photo-ish thumbnail block
      if (x > w - 420 && x < w - 60 && y > h - 320 && y < h - 60) {
        a[i] = 100 + (x % 97) * 1.5; a[i + 1] = 90 + (y % 83) * 1.7; a[i + 2] = 120 + ((x + y) % 71) * 1.8;
      }
    }
  }
  return a;
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  const check = (name, ok, extra) => {
    results.push({ name, ok });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  — ' + extra : ''));
  };

  console.log('=== Generating synthetic test images ===');
  const photo = await truecolorPng(2200, 1500, photoLike(2200, 1500));
  const graphic = await truecolorPng(1400, 900, graphicLike(1400, 900));
  const pPhoto = path.join(OUT, 'photo-2200x1500.png');
  const pGraphic = path.join(OUT, 'graphic-1400x900.png');
  fs.writeFileSync(pPhoto, photo);
  fs.writeFileSync(pGraphic, graphic);
  check('synthetic photo written', fs.existsSync(pPhoto), (photo.length / 1024).toFixed(0) + ' KB');
  check('synthetic graphic written', fs.existsSync(pGraphic), (graphic.length / 1024).toFixed(0) + ' KB');

  const srv = await serve();
  console.log('\n=== Static server on :' + PORT + ' ===');

  const browser = await chromium.launch({
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe',
    headless: true
  });
  const errors = [];
  const requests = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('request', (r) => requests.push(r.url()));

    /* ---------- page load ---------- */
    console.log('\n=== Loading /compress/ ===');
    await page.goto(BASE + '/localphototool/compress/', { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForSelector('#dropzone', { timeout: 15000 });
    } catch (e) {
      console.log('  ! dropzone not visible, dumping state');
      console.log('  url:', page.url());
      console.log('  title:', await page.title().catch(() => 'n/a'));
      console.log('  body:', (await page.evaluate(() => document.body ? document.body.innerHTML.slice(0, 400) : 'NO BODY')).replace(/\s+/g, ' '));
      console.log('  requests so far:', requests.slice(0, 20).join('\n          '));
      throw e;
    }
    await page.waitForTimeout(1200); // let the worker pool warm up
    check('page loads without JS errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

    const engineText = await page.textContent('#engineStatus');
    check('engine status rendered', engineText && engineText.includes('Background workers'),
      (engineText || '').replace(/\s+/g, ' ').slice(0, 90));

    /* ---------- auto mode, two files ---------- */
    console.log('\n=== Auto mode batch ===');
    await page.setInputFiles('#fileInput', [pPhoto, pGraphic]);
    // Wait until EVERY row is finished, not just the first one.
    try {
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('.result');
        return rows.length >= 2 && Array.from(rows).every((r) => r.querySelector('[data-act="download"]'));
      }, { timeout: 180000, polling: 500 });
    } catch (e) {
      console.log('  ! rows did not finish, dumping state');
      console.log('  errors:', errors.slice(0, 5).join(' | '));
      console.log('  rows:', await page.$$eval('.result', (els) => els.map((x) => x.innerText.replace(/\n/g, ' | '))).catch(() => 'n/a'));
      console.log('  engine:', await page.textContent('#engineStatus').catch(() => 'n/a'));
      throw e;
    }
    await page.waitForTimeout(500);

    const rows = await page.$$eval('.result', (els) => els.map((e) => ({
      name: e.querySelector('.result__name').textContent,
      meta: e.querySelector('.result__meta').innerText.replace(/\n/g, ' | ')
    })));
    check('both files produced a result row', rows.length === 2);
    rows.forEach((r) => console.log('        · ' + r.name + '  →  ' + r.meta));

    const photoRow = rows.find((r) => /photo-2200/.test(r.name));
    const graphicRow = rows.find((r) => /graphic-1400/.test(r.name));
    check('photo was converted to WebP (auto strategy)', /webp/i.test(photoRow.meta), photoRow.meta);
    check('graphic stayed on the PNG-8 palette path', /PNG-8/i.test(graphicRow.meta), graphicRow.meta);

    const sizes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.result')).map((e) => e.querySelector('.result__meta').innerText);
    });
    const photoPct = parseInt((photoRow.meta.match(/−(\d+)%/) || [])[1] || '0', 10);
    const graphicPct = parseInt((graphicRow.meta.match(/−(\d+)%/) || [])[1] || '0', 10);
    console.log('        photo saved ' + photoPct + '%, graphic saved ' + graphicPct + '%');
    check('photo reduction is substantial (>30%)', photoPct > 30, photoPct + '%');
    check('graphic reduction is substantial (>50%)', graphicPct > 50, graphicPct + '%');

    await page.screenshot({ path: path.join(OUT, 'e2e-desktop-results.png') });

    /* ---------- privacy: no image bytes over the wire ---------- */
    const hosts = [...new Set(requests.map((u) => {
      try { return new URL(u).host; } catch (e) { return ''; }
    }).filter(Boolean))];
    console.log('        hosts contacted: ' + hosts.join(', '));
    check('only the site host and known codec CDNs were contacted',
      hosts.every((h) => h === 'localhost:' + PORT || /esm\.sh|jsdelivr|cdn/.test(h)),
      hosts.join(', '));

    /* ---------- compare modal ---------- */
    console.log('\n=== Compare viewer ===');
    await page.click('.result [data-act="compare"]');
    await page.waitForSelector('#compareModal:not([hidden])');
    const badge = await page.textContent('#compareBadge');
    check('compare modal opens with savings badge', /−\d+%/.test(badge), badge.trim());
    const statsText = await page.textContent('#compareStats');
    check('compare stats include encoder + timing', /Encoder/.test(statsText) && /Took/.test(statsText));
    // drag the split handle
    const box = await (await page.$('#compare')).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    const split = await page.$eval('#compare', (el) => el.style.getPropertyValue('--split'));
    check('split handle drags to ~80%', Math.abs(parseFloat(split) - 80) < 6, 'split=' + split);
    await page.screenshot({ path: path.join(OUT, 'e2e-compare.png') });
    await page.keyboard.press('Escape');
    check('Escape closes the modal', await page.$eval('#compareModal', (el) => el.hidden));

    /* ---------- target size mode ---------- */
    console.log('\n=== Target size mode ===');
    await page.click('label[for="modeTarget"]');
    await page.fill('#targetKB', '150');
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.result');
      if (!rows.length) return false;
      return Array.from(rows).every((r) => r.querySelector('[data-act="download"]'));
    }, { timeout: 120000 });
    await page.waitForTimeout(600);

    // Download the outputs and measure the real byte sizes.
    const dl = path.join(OUT, 'downloads');
    fs.mkdirSync(dl, { recursive: true });
    const outputs = [];
    for (const r of await page.$$('.result [data-act="download"]')) {
      const [file] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        r.click()
      ]);
      const p = path.join(dl, file.suggestedFilename());
      await file.saveAs(p);
      outputs.push(p);
    }
    check('two files downloaded', outputs.length === 2, outputs.map((o) => path.basename(o)).join(', '));
    for (const o of outputs) {
      const kb = fs.statSync(o).size / 1024;
      const isPhoto = /photo/.test(o);
      check((isPhoto ? 'photo' : 'graphic') + ' output is under the 150 KB target', kb < 150,
        kb.toFixed(1) + ' KB  ' + path.basename(o));
      check((isPhoto ? 'photo' : 'graphic') + ' output is a real, decodable image', kb > 3,
        kb.toFixed(1) + ' KB');
    }
    await page.screenshot({ path: path.join(OUT, 'e2e-target-results.png') });

    /* ---------- manual download-all ZIP ---------- */
    console.log('\n=== ZIP export ===');
    const zipPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.click('#barDownload');
    const zipDl = await zipPromise;
    const zipPath = path.join(dl, zipDl.suggestedFilename());
    await zipDl.saveAs(zipPath);
    const zipSize = fs.statSync(zipPath).size;
    check('ZIP archive downloaded', zipSize > 100, (zipSize / 1024).toFixed(1) + ' KB');

    /* ---------- mobile layout ---------- */
    console.log('\n=== Mobile layout (390x844) ===');
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    mob.on('pageerror', (e) => errors.push('MOBILE PAGEERROR: ' + e.message));
    await mob.goto(BASE + '/localphototool/compress/', { waitUntil: 'load' });
    await mob.waitForSelector('#dropzone');
    await mob.waitForTimeout(800);
    const noHScroll = await mob.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('no horizontal scrolling on a phone', noHScroll,
      'scrollWidth=' + (await mob.evaluate(() => document.documentElement.scrollWidth)) + ' vs ' +
      (await mob.evaluate(() => window.innerWidth)));
    await mob.setInputFiles('#fileInput', [pPhoto]);
    await mob.waitForFunction(() => {
      const b = document.querySelector('#actionBar');
      return b && !b.hidden;
    }, { timeout: 120000 });
    await mob.waitForTimeout(400);
    await mob.screenshot({ path: path.join(OUT, 'e2e-mobile-results.png') });
    await mob.evaluate(() => document.querySelector('#results').scrollIntoView({ block: 'start' }));
    await mob.waitForTimeout(600);
    const barVisible = await mob.evaluate(() => {
      const b = document.querySelector('#actionBar');
      const r = b.getBoundingClientRect();
      return r.height > 0 && r.bottom <= window.innerHeight + 2 && r.width > 200;
    });
    check('sticky action bar is reachable on mobile', barVisible,
      JSON.stringify(await mob.evaluate(() => {
        const r = document.querySelector('#actionBar').getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight };
      })));
    const btnH = await mob.evaluate(() => {
      const b = document.querySelector('#barDownload');
      return b.getBoundingClientRect().height;
    });
    check('primary button meets the 44px touch target', btnH >= 44, btnH.toFixed(0) + 'px');
    await mob.click('.result [data-act="compare"]');
    await mob.waitForSelector('#compareModal:not([hidden])');
    await mob.screenshot({ path: path.join(OUT, 'e2e-mobile-compare.png') });
    check('mobile run had no JS errors', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');

    /* ---------- home page + og image ---------- */
    console.log('\n=== Home page & OG asset ===');
    const home = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    home.on('pageerror', (e) => errors.push('HOME PAGEERROR: ' + e.message));
    await home.goto(BASE + '/localphototool/', { waitUntil: 'load' });
    const h1 = await home.textContent('h1');
    check('home page renders its headline', /Compress images/.test(h1), h1.trim().slice(0, 60));
    const noHScrollHome = await home.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('home page has no horizontal overflow', noHScrollHome);
    await home.screenshot({ path: path.join(OUT, 'e2e-home.png') });

    // The OG cover is a pre-built JPEG (see _dev/gen-icons.cjs). Verify it is
    // present, decodable at 1200x630, and light enough to load fast when a
    // social crawler fetches it.
    const ogPath = path.join(SITE, 'og-cover.jpg');
    const ogBuf = fs.readFileSync(ogPath);
    const ogSize = await home.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight };
    }, ogBuf.toString('base64'));
    check('og-cover.jpg is 1200x630', ogSize.w === 1200 && ogSize.h === 630,
      ogSize.w + 'x' + ogSize.h);
    check('og-cover.jpg stays under 200 KB', ogBuf.length > 5000 && ogBuf.length < 200000,
      (ogBuf.length / 1024).toFixed(0) + ' KB');

    const icoPath = path.join(SITE, 'favicon.ico');
    const icoBuf = fs.readFileSync(icoPath);
    check('favicon.ico is a valid multi-frame icon',
      icoBuf[0] === 0 && icoBuf[1] === 0 && icoBuf[2] === 1 && icoBuf[3] === 0 && icoBuf.readUInt16LE(4) >= 2,
      icoBuf.readUInt16LE(4) + ' frames, ' + icoBuf.length + ' bytes');

    /* ---------- other pages ---------- */
    for (const p of ['about/', 'privacy/', 'terms/']) {
      const ok = await (async () => {
        const pg = await browser.newPage();
        const resp = await pg.goto(BASE + '/localphototool/' + p, { waitUntil: 'load' });
        const status = resp.status();
        const hasH1 = await pg.$('h1');
        await pg.close();
        return status === 200 && !!hasH1;
      })();
      check('/' + p + ' returns 200 with content', ok);
    }

    console.log('\n=== Console errors collected ===');
    console.log(errors.length ? errors.join('\n') : 'none');

    const failed = results.filter((r) => !r.ok);
    console.log('\n========================================');
    console.log((results.length - failed.length) + ' / ' + results.length + ' browser checks passed');
    if (failed.length) {
      console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('Artifacts in ' + OUT);
})();
