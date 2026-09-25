/* Visual check of the visitor counter.
   Shows both states: below the threshold (nothing on the page) and above it
   (a quiet line in the footer), plus the private /stats/ dashboard. */
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));
const PORT = 8895, BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  async function shot(name, opts) {
    const ctx = await browser.newContext({
      viewport: opts.viewport, userAgent: UA,
      isMobile: !!opts.mobile, hasTouch: !!opts.mobile, deviceScaleFactor: opts.mobile ? 2 : 1
    });
    await ctx.addInitScript((t) => {
      window.LPT_STATS_FORCE = true;
      try { localStorage.setItem('lpt.theme', t); } catch (e) {}
    }, opts.theme || 'light');
    const page = await ctx.newPage();
    await page.goto(BASE + (opts.path || '/'), { waitUntil: 'networkidle' });
    await sleep(1500);
    if (opts.bottom) await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(600);
    await page.screenshot({ path: path.join(__dirname, 'out', name), fullPage: !!opts.full });
    console.log('shot →', name);
    await ctx.close();
  }

  /* 1. fresh site: a handful of visitors — nothing should be visible */
  await fetch(BASE + '/api/count?reset=1');
  await shot('stats-quiet-footer-desktop.png', { viewport: { width: 1280, height: 900 }, bottom: true });

  /* 2. seeded traffic — the footer line finally appears */
  await fetch(BASE + '/api/count?demo=1');
  await shot('stats-proof-footer-desktop.png', { viewport: { width: 1280, height: 900 }, bottom: true });
  await shot('stats-proof-footer-dark.png', { viewport: { width: 1280, height: 900 }, bottom: true, theme: 'dark' });
  await shot('stats-proof-footer-mobile.png', { viewport: { width: 390, height: 844 }, bottom: true, mobile: true });

  /* 3. hero, to confirm nothing sits above the fold any more */
  await shot('stats-hero-desktop.png', { viewport: { width: 1280, height: 900 } });
  await shot('stats-hero-mobile.png', { viewport: { width: 390, height: 844 }, mobile: true });

  /* 4. the private dashboard */
  await shot('stats-private-dashboard.png', { viewport: { width: 1280, height: 900 }, path: '/stats/', full: true });

  await browser.close();
  server.kill();
})();
