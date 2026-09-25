/* Diagnostic (not part of the suite): how long does each codec really take to
   become usable, split into "fetch the module" vs "first encode"? The engine's
   WASM_TIMEOUTS has to cover the sum, so the split is what tells us whether the
   budget is tight. Each codec gets a fresh page so nothing is module-cached. */
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8919;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SOURCES = {
  jpeg: 'https://esm.sh/@jsquash/jpeg@1.4.0',
  webp: 'https://esm.sh/@jsquash/webp@1.4.0',
  avif: 'https://esm.sh/@jsquash/avif@2.1.1'
};

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const codec of Object.keys(SOURCES)) {
      const ctx = await browser.newContext({ userAgent: UA });
      const page = await ctx.newPage();
      await page.goto(BASE + '/compress/', { waitUntil: 'load' });
      const r = await page.evaluate(async (arg) => {
        const t0 = performance.now();
        let mod;
        try { mod = await import(arg.url); } catch (e) { return { error: 'import: ' + e.message }; }
        const t1 = performance.now();
        const fn = mod.encode || (mod.default && mod.default.encode) ||
          (typeof mod.default === 'function' ? mod.default : null);
        if (typeof fn !== 'function') return { error: 'no export', fetch: t1 - t0 };
        try {
          const buf = await fn({ data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]), width: 2, height: 2 }, { quality: 75 });
          return { fetch: Math.round(t1 - t0), probe: Math.round(performance.now() - t1), bytes: buf.byteLength };
        } catch (e) { return { fetch: Math.round(t1 - t0), error: 'probe: ' + e.message }; }
      }, { url: SOURCES[codec] });
      console.log('  ' + codec.padEnd(5) + ' ' + JSON.stringify(r));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
})();
