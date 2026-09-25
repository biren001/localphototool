/* Debug probe for the vendored HEIC decoder.

   Answers three questions that the library's own README does not:
     1. does it initialise at all under the production CSP,
     2. what does the HeifImage object actually offer (the README documents one
        call, the minified bundle offers whatever libheif C API got bound),
     3. does a file stored landscape with an EXIF orientation tag come out
        rotated or sideways.

   Run: node _dev/debug-heic.cjs
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8894;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const FIX = path.join(__dirname, 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  await sleep(900);

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  for (const name of ['sample.heic', 'rotated.heic']) {
    const b64 = fs.readFileSync(path.join(FIX, name)).toString('base64');
    const out = await page.evaluate(async (payload) => {
      const report = { file: payload.name };
      try {
        const mod = await import('/assets/vendor/libheif-bundle.mjs');
        report.exports = Object.keys(mod);
        let libheif = mod.default || mod;
        report.defaultType = typeof libheif;
        report.defaultKeys = libheif && typeof libheif === 'object'
          ? Object.keys(libheif).slice(0, 40) : null;
        report.defaultHasHeifDecoder = !!(libheif && libheif.HeifDecoder);

        /* Emscripten sometimes hands back a factory rather than the module. */
        if (report.defaultType === 'function') {
          report.factorySource = String(libheif).slice(0, 240);
          const built = await libheif();
          report.builtKeys = built && typeof built === 'object' ? Object.keys(built).slice(0, 40) : null;
          report.builtHasHeifDecoder = !!(built && built.HeifDecoder);
          if (report.builtHasHeifDecoder) libheif = built;
        }
        if (!libheif || !libheif.HeifDecoder) {
          report.error = 'HeifDecoder not reachable — see defaultType/Keys above';
          return report;
        }

        const raw = atob(payload.b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

        const decoder = new libheif.HeifDecoder();
        const images = decoder.decode(bytes.buffer);
        report.imageCount = images.length;
        const img = images[0];
        report.coded = { w: img.get_width(), h: img.get_height() };
        report.api = Object.getOwnPropertyNames(Object.getPrototypeOf(img))
          .concat(Object.getOwnPropertyNames(img))
          .filter((k, i, a) => a.indexOf(k) === i).sort();
        if (typeof img.get_ispe_width === 'function') {
          report.ispe = { w: img.get_ispe_width(), h: img.get_ispe_height() };
        }

        const w = report.coded.w, h = report.coded.h;
        const data = new Uint8ClampedArray(w * h * 4);
        const shown = await new Promise((resolve) => {
          img.display({ data: data, width: w, height: h }, (d) => resolve(d));
        });
        report.display = shown ? { w: shown.width, h: shown.height, len: shown.data && shown.data.length } : null;

        /* A pixel fingerprint: if the top-left quadrant is brighter than the
           bottom-right one, we know which way the pixels were laid out. */
        const px = (shown && shown.data) || data;
        const sum = (x0, y0, x1, y1) => {
          let t = 0;
          for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
            const i = (y * w + x) * 4; t += px[i] + px[i + 1] + px[i + 2];
          }
          return t;
        };
        report.quadrants = {
          topLeft: sum(0, 0, w >> 1, h >> 1),
          topRight: sum(w >> 1, 0, w, h >> 1),
          bottomLeft: sum(0, h >> 1, w >> 1, h),
          bottomRight: sum(w >> 1, h >> 1, w, h)
        };
      } catch (e) {
        report.error = String(e && e.message || e);
      }
      return report;
    }, { name, b64 });

    console.log('\n=== ' + name + ' ===');
    console.log(JSON.stringify(out, null, 2));
  }

  console.log('\n=== console / page errors ===');
  console.log(logs.length ? logs.join('\n') : '(none)');

  await browser.close();
  server.kill();
})();
