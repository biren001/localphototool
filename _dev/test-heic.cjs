/* HEIC end-to-end tests.

   Why this file exists in the form it does:

   · The fixtures are real HEIC files (see gen-heic-fixture.py), not renamed
     JPEGs, because "it converted" is not the interesting question.
   · The server is serve-site.cjs, so the page runs under the SAME
     Content-Security-Policy as production. A decoder whose Emscripten glue
     reaches for `new Function` works on a bare static server and throws on the
     live site — the only place a visitor ever sees it.
   · The assertions read the downloaded bytes and parse the JPEG frame header,
     so "orientation was applied" is measured in pixels rather than trusted.

   Run: node _dev/test-heic.cjs
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8893;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const FIX = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Read width/height out of a JPEG without pulling in a decoder. Walk the
   marker segments until the frame header (SOF0/SOF1/SOF2) shows up. */
function jpegFrame(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xFF) { i++; continue; }
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isFrame = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isFrame) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), progressive: marker === 0xC2 };
    }
    i += 2 + len;
  }
  return null;
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  await sleep(900);

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  /* Convert one fixture through the real UI and hand back everything the
     assertions need. Never throws: a broken app should fail a check, not the
     whole run. */
  async function convert(fixture, opts) {
    opts = opts || {};
    const ctx = await browser.newContext({
      viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1400, height: 950 },
      userAgent: UA,
      deviceScaleFactor: opts.mobile ? 2 : 1,
      isMobile: !!opts.mobile,
      hasTouch: !!opts.mobile,
      acceptDownloads: true
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const requests = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    page.on('request', (r) => requests.push(r.url()));

    const result = { consoleErrors, requests, row: null, bytes: null, name: null };

    await page.goto(BASE + (opts.path || '/heic-to-jpg/'), { waitUntil: 'domcontentloaded' });
    await sleep(600);

    const file = path.join(FIX, fixture);
    if (!fs.existsSync(file)) {
      result.consoleErrors.push('fixture missing: ' + file);
      await ctx.close();
      return result;
    }
    await page.setInputFiles('#fileInput', [file]);

    /* Either a downloadable result appears, or we time out and report what the
       row actually says — the failure text is the most useful thing here. */
    const ready = await page.waitForFunction(() => {
      const row = document.querySelector('.result');
      return !!(row && row.querySelector('[data-act="download"]'));
    }, { timeout: 45000 }).then(() => true).catch(() => false);

    result.row = await page.$eval('.result', (el) => ({
      name: (el.querySelector('.result__name') || {}).textContent || '',
      meta: (el.querySelector('.result__meta') || {}).innerText || '',
      all: el.innerText.replace(/\n+/g, ' | ')
    })).catch(() => null);

    if (ready) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15000 }),
          page.click('.result [data-act="download"]')
        ]);
        result.name = download.suggestedFilename();
        const p = await download.path();
        result.bytes = fs.readFileSync(p);
      } catch (e) {
        result.consoleErrors.push('download failed: ' + e.message);
      }
    }

    if (opts.shot) await page.screenshot({ path: path.join(OUT, opts.shot), fullPage: false }).catch(() => {});
    await ctx.close();
    return result;
  }

  try {
    console.log('\nHEIC conversion — end-to-end, under the production CSP\n');

    ok('fixtures exist', fs.existsSync(path.join(FIX, 'sample.heic')) && fs.existsSync(path.join(FIX, 'rotated.heic')));

    /* ---- 1. the plain case ------------------------------------------- */
    const plain = await convert('sample.heic');
    const frame = plain.bytes ? jpegFrame(plain.bytes) : null;
    ok('a HEIC file produces a result row', !!plain.row && plain.row.all.indexOf('heic') !== -1,
      plain.row ? plain.row.all : 'no row');
    ok('the output downloads as a .jpg', !!plain.name && /\.jpe?g$/i.test(plain.name), String(plain.name));
    ok('the output is a real JPEG', !!(plain.bytes && plain.bytes[0] === 0xFF && plain.bytes[1] === 0xD8),
      plain.bytes ? plain.bytes.length + ' bytes' : 'nothing downloaded');
    ok('the JPEG has the source dimensions (1200x900)',
      !!frame && frame.w === 1200 && frame.h === 900, frame ? frame.w + 'x' + frame.h : 'no frame header');
    ok('no CSP violation was reported', !plain.consoleErrors.some((t) => /Content Security Policy/i.test(t)),
      plain.consoleErrors.join(' | '));

    /* ---- 2. the sideways-photo case ---------------------------------- */
    const rot = await convert('rotated.heic');
    const rotFrame = rot.bytes ? jpegFrame(rot.bytes) : null;
    ok('a rotated HEIC still converts', !!rot.bytes && rot.bytes.length > 2000,
      rot.bytes ? rot.bytes.length + ' bytes' : 'nothing downloaded');
    ok('the EXIF orientation tag is applied (900x1200)',
      !!rotFrame && rotFrame.w === 900 && rotFrame.h === 1200,
      rotFrame ? rotFrame.w + 'x' + rotFrame.h + ' — a portrait photo would arrive sideways' : 'no frame header');

    /* ---- 3. the decoder is ours, not someone else's CDN --------------- */
    /* Careful with the pattern: the decoder is called libheif, which contains
       "heif", not "heic" — an earlier /heic/ filter silently matched nothing
       and reported "no decoder request seen" for a decoder that had loaded. */
    const decoderHits = plain.requests.filter((u) => /libheif|heic/i.test(u));
    ok('the HEIC decoder is served from our own origin',
      decoderHits.length > 0 && decoderHits.every((u) => u.indexOf(BASE) === 0),
      decoderHits.length ? decoderHits.join(' | ') : 'no decoder request seen');
    ok('the old heic2any dependency is gone for good',
      !plain.requests.some((u) => /heic2any/i.test(u)),
      plain.requests.filter((u) => /heic/i.test(u)).join(' | '));

    /* ---- 4. the audience is on a phone ------------------------------- */
    const mob = await convert('sample.heic', { mobile: true, shot: 'heic-mobile-result.png' });
    const mobFrame = mob.bytes ? jpegFrame(mob.bytes) : null;
    ok('the same conversion works on a phone viewport',
      !!mobFrame && mobFrame.w === 1200 && mobFrame.h === 900,
      mobFrame ? mobFrame.w + 'x' + mobFrame.h : 'nothing downloaded');
    ok('no JS errors on mobile', mob.consoleErrors.filter((t) => !/Content Security Policy/i.test(t)).length === 0,
      mob.consoleErrors.join(' | '));

    /* ---- 5. the compressor takes HEIC too, and never hands it back ------- */
    /* On the compressor the output format is "auto", which may legitimately
       choose PNG for a smooth image. The one thing it must never do is decide
       the original HEIC was smaller and return it unchanged: "we converted your
       file" cannot mean "here is the same unopenable file". */
    const viaCompress = await convert('sample.heic', { path: '/compress/' });
    ok('the compressor also accepts HEIC',
      !!viaCompress.bytes && !/\.heic$/i.test(viaCompress.name || ''),
      (viaCompress.name || 'nothing downloaded') + ' · ' + (viaCompress.bytes ? viaCompress.bytes.length + ' B' : '-'));
    ok('the compressor never returns the HEIC unchanged',
      !!viaCompress.bytes && !(viaCompress.bytes[4] === 0x66 && viaCompress.bytes[8] === 0x6D),
      'first bytes: ' + (viaCompress.bytes ? Array.from(viaCompress.bytes.slice(4, 12)).map((b) => b.toString(16)).join(' ') : '-'));
  } catch (e) {
    fail++;
    console.log('  FAIL  unexpected error → ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
