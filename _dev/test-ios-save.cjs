/* Verify the phone save flow:
   A. iPhone with file sharing  -> "Save to Photos", hands files to the share sheet
   B. iPhone without sharing    -> "Save all images" + Files-app hint
   C. Desktop                   -> unchanged "Download all (.zip)"                */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8806;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const IMG = path.join(WS_ROOT, '_dev/out/csp-probe.png');

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

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

/* Received as an argument: addInitScript serialises the function, so a
   closure variable would be lost. */
function mockShare(supportsFiles) {
  window.__shares = [];
  var share = function (opts) {
    window.__shares.push({
      files: (opts.files || []).map(function (f) { return { name: f.name, type: f.type, size: f.size }; })
    });
    return Promise.resolve();
  };
  var canShare = function (opts) { return supportsFiles && !!(opts && opts.files && opts.files.length); };
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

async function makePage(browser, opts) {
  const ctx = await browser.newContext({
    userAgent: opts.ua || undefined,
    viewport: opts.viewport || { width: 1280, height: 900 },
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    deviceScaleFactor: opts.mobile ? 3 : 1
  });
  if (opts.ua) await ctx.addInitScript(mockShare, opts.supportsFiles !== false);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  return page;
}

/* A noisy gradient reads as a photo to the analyser, so the auto strategy
   routes it to WebP — exactly the format iOS Photos struggles to import. */
async function makePhotoBuffer(browser) {
  const p = await browser.newPage();
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    const img = x.createImageData(1200, 900);
    const d = img.data;
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < 900; y++) {
      for (let xx = 0; xx < 1200; xx++) {
        const i = (y * 1200 + xx) * 4;
        const base = 40 + 170 * (xx / 1200) + 55 * Math.sin(y / 45);
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

async function compress(page, file) {
  await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
  await page.setInputFiles('#fileInput', file);
  await page.waitForFunction(() => {
    const r = document.querySelector('.result [data-act="download"]');
    return !!r;
  }, { timeout: 120000 });
  await page.waitForTimeout(400);
}

async function compressOne(page) {
  await compress(page, IMG);
}

function run() {
  (async () => {
    const browser = await chromium.launch({ executablePath: EXE });

    /* ---------- A. iPhone with file sharing ---------- */
    console.log('\n=== A. iPhone, share sheet supports files ===');
    let page = await makePage(browser, { ua: IPHONE_UA, mobile: true, supportsFiles: true });
    await compressOne(page);

    const labelA = await page.textContent('#barDownloadLabel');
    check('primary button says "Save to Photos"', labelA.trim() === 'Save to Photos', labelA.trim());

    const hintVisible = await page.isVisible('#saveHint');
    const hintText = (await page.textContent('#saveHint') || '').replace(/\s+/g, ' ').trim();
    check('a hint explains where the images go', hintVisible && /Photos app/.test(hintText), hintText.slice(0, 96));

    await page.click('#barDownload');
    await page.waitForTimeout(400);
    const shares = await page.evaluate(() => window.__shares || []);
    check('share sheet received the compressed file', shares.length === 1 && shares[0].files.length === 1,
      shares.length ? JSON.stringify(shares[0].files) : 'share() never called');

    if (shares.length && shares[0].files[0]) {
      const f = shares[0].files[0];
      check('shared file has a real name and extension', /\.(jpg|png|webp)$/i.test(f.name), f.name);
      check('shared file has a non-zero size', f.size > 1000, f.size + ' bytes');
      check('shared file carries an image mime type', /^image\//.test(f.type), f.type);
    }

    /* single-image save from the result row */
    await page.evaluate(() => { window.__shares = []; });
    await page.click('.result [data-act="download"]');
    await page.waitForTimeout(400);
    const single = await page.evaluate(() => window.__shares || []);
    check('per-image Save also goes through the share sheet',
      single.length === 1 && single[0].files.length === 1, single.length + ' share(s)');

    /* iOS cannot open a .zip: Files has no unpacker and the images would
       never reach Photos. The archive must not be reachable from here. */
    check('no .zip escape hatch is offered on iOS', !(await page.isVisible('#zipInstead')));
    const zipText = await page.evaluate(() => document.body.innerText.toLowerCase());
    check('the word ".zip" never appears to an iPhone user', zipText.indexOf('.zip') === -1);

    /* even a forced path through the archive builder must be rerouted */
    const downloads = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(() => { window.__shares = []; });
    await page.click('#barDownload');
    await page.waitForTimeout(600);
    check('tapping Save never produces a .zip download',
      downloads.filter((n) => /\.zip$/i.test(n)).length === 0, downloads.join(', ') || 'no downloads');
    check('no JS errors on the phone path', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    /* ---------- B. iPhone without file sharing ---------- */
    console.log('\n=== B. iPhone, share sheet cannot take files ===');
    page = await makePage(browser, { ua: IPHONE_UA, mobile: true, supportsFiles: false });
    await compressOne(page);
    const labelB = await page.textContent('#barDownloadLabel');
    check('falls back to "How to save"', labelB.trim() === 'How to save', labelB.trim());
    const hintB = (await page.textContent('#saveHint') || '').replace(/\s+/g, ' ').trim();
    check('tells the user to long-press instead of downloading', /long-press/i.test(hintB), hintB.slice(0, 80));
    const zipB = await page.isVisible('#zipInstead');
    check('still no .zip when the share sheet is unavailable', !zipB);

    await page.click('#barDownload');
    await page.waitForTimeout(300);
    const pressOpen = await page.isVisible('#saveGuide');
    check('explains long-press when batch save is impossible', pressOpen);
    const pressSteps = await page.$$eval('#saveGuideBody li', (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
    check('the guide describes press-and-hold', pressSteps.length === 2 && /Press and hold/.test(pressSteps[0]),
      pressSteps[0] || 'none');
    check('no "Open share menu" button in this mode', !(await page.isVisible('#saveGuideGo')));
    await page.click('#saveGuideCancel');
    await page.waitForTimeout(200);
    check('the guide can be dismissed', !(await page.isVisible('#saveGuide')));
    check('no JS errors on the fallback path', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    /* ---------- D. iPhone + photo (WebP) must be handed over as JPEG ---------- */
    console.log('\n=== D. iPhone, photo routed to WebP ===');
    const photo = await makePhotoBuffer(browser);
    page = await makePage(browser, { ua: IPHONE_UA, mobile: true, supportsFiles: true });
    await compress(page, { name: 'holiday.png', mimeType: 'image/png', buffer: photo });

    const metaD = (await page.textContent('.result__meta') || '').replace(/\s+/g, ' ');
    check('the photo was routed to WebP', /WEBP/i.test(metaD), metaD.slice(0, 90));

    /* give the background JPEG twin a moment to be prepared */
    await page.waitForTimeout(1200);
    await page.click('#barDownload');
    await page.waitForTimeout(500);
    const shareD = await page.evaluate(() => window.__shares || []);
    const fD = shareD.length && shareD[0].files.length ? shareD[0].files[0] : null;
    check('what goes to Photos is JPEG, not WebP',
      !!fD && /\.jpg$/i.test(fD.name) && fD.type === 'image/jpeg',
      fD ? fD.name + ' / ' + fD.type : 'nothing shared');
    check('the JPEG twin is a real image', !!fD && fD.size > 2000, fD ? fD.size + ' bytes' : '-');

    const hintD = (await page.textContent('#saveHint') || '').replace(/\s+/g, ' ');
    check('the hint explains the WebP → JPEG conversion', /JPEG/.test(hintD), hintD.slice(0, 130));
    check('no JS errors during the conversion', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    /* ---------- E. Batch save is coached instead of left to guesswork ---------- */
    console.log('\n=== E. iPhone, saving two at once ===');
    page = await makePage(browser, { ua: IPHONE_UA, mobile: true, supportsFiles: true });
    await page.goto('http://localhost:' + PORT + '/localphototool/compress/', { waitUntil: 'load' });
    await page.setInputFiles('#fileInput', [
      { name: 'first.png', mimeType: 'image/png', buffer: fs.readFileSync(IMG) },
      { name: 'second.png', mimeType: 'image/png', buffer: fs.readFileSync(IMG) }
    ]);
    await page.waitForFunction(() => {
      return document.querySelectorAll('.result [data-act="download"]').length >= 2;
    }, { timeout: 180000 });
    await page.waitForTimeout(600);

    await page.click('#barDownload');
    await page.waitForTimeout(300);
    check('tapping Save explains what happens next', await page.isVisible('#saveGuide'));

    const steps = await page.$$eval('#saveGuideBody li', (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
    check('the guide walks through the share sheet',
      steps.length === 3 && /Open share menu/.test(steps[0]) && /Save to Photos/.test(steps[1]),
      steps.length + ' step(s)');
    const early = await page.evaluate(() => (window.__shares || []).length);
    check('nothing is shared until the user confirms', early === 0, early + ' share(s)');

    await page.click('#saveGuideGo');
    await page.waitForTimeout(400);
    const sharesE = await page.evaluate(() => window.__shares || []);
    check('confirming hands every image over at once',
      sharesE.length === 1 && sharesE[0].files.length === 2,
      sharesE.length ? sharesE[0].files.map((f) => f.name).join(', ') : 'share() never called');
    check('the guide closes itself', !(await page.isVisible('#saveGuide')));

    /* second time still coached, third time straight through */
    await page.evaluate(() => { window.__shares = []; });
    await page.click('#barDownload');
    await page.waitForTimeout(250);
    check('coached a second time too', await page.isVisible('#saveGuide'));
    await page.click('#saveGuideGo');
    await page.waitForTimeout(400);

    await page.evaluate(() => { window.__shares = []; });
    await page.click('#barDownload');
    await page.waitForTimeout(400);
    const thirdGuide = await page.isVisible('#saveGuide');
    const sharesThird = await page.evaluate(() => window.__shares || []);
    check('after two explanations it stops interrupting', !thirdGuide);
    check('and saves without the extra tap',
      sharesThird.length === 1 && sharesThird[0].files.length === 2,
      sharesThird.length ? sharesThird[0].files.length + ' file(s)' : 'share() never called');
    check('no JS errors in the coached flow', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    /* ---------- F. Android ---------- */
    console.log('\n=== F. Android ===');
    const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
    page = await makePage(browser, { ua: ANDROID_UA, mobile: true, supportsFiles: true });
    await compressOne(page);
    const labelF = await page.textContent('#barDownloadLabel');
    check('android says "Save images", not "Save to Photos"', labelF.trim() === 'Save images', labelF.trim());
    await page.click('#barDownload');
    await page.waitForTimeout(400);
    const sharesF = await page.evaluate(() => window.__shares || []);
    check('android also saves through the share sheet',
      sharesF.length === 1 && sharesF[0].files.length === 1, sharesF.length + ' share(s)');
    /* Android file managers unpack ZIPs natively, so the escape hatch stays. */
    check('android keeps the .zip escape hatch', await page.isVisible('#zipInstead'));
    check('no JS errors on android', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    /* ---------- C. Desktop unchanged ---------- */
    console.log('\n=== C. Desktop ===');
    page = await makePage(browser, {});
    await compressOne(page);
    const labelC = await page.textContent('#barDownloadLabel');
    check('desktop still says "Download all (.zip)"', labelC.trim() === 'Download all (.zip)', labelC.trim());
    const hintHidden = await page.evaluate(() => {
      const h = document.querySelector('#saveHint');
      return !h || h.hidden;
    });
    check('no phone hint shown on desktop', hintHidden);
    const dl = await page.evaluate(() => {
      const b = document.querySelector('#barDownload');
      return b.dataset.act;
    });
    check('desktop button keeps the zip action', dl === 'zip', dl);
    check('no JS errors on desktop', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    await browser.close();
    srv.close();
    const passed = results.filter(Boolean).length;
    console.log('\n' + passed + ' / ' + results.length + ' phone-save checks passed');
    process.exit(passed === results.length ? 0 : 1);
  })().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}
