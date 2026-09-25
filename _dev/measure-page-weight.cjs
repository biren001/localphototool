/* What each page actually costs a phone: bytes, request count, the heaviest
   resources, and the paint timings. The privacy story is only as good as the
   payload that carries it.

   The two paths below said '..', '..' and '..' — correct while this file lived
   in _dev/.tmp/, wrong the moment it was promoted into _dev/, where it pointed
   at a directory that does not exist and died with ERR_CONNECTION_REFUSED
   before measuring anything. Same one-level-too-high mistake run-all.sh had. */
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = 8921;
const BASE = 'http://127.0.0.1:' + PORT;
const SITE = path.join(__dirname, '..', 'localphototool');
const SERVE = path.join(__dirname, 'serve-site.cjs');
const CHROME =
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PAGES = ['/', '/compress/', '/heic-to-jpg/', '/share/', '/about/'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, [SERVE], {
    env: Object.assign({}, process.env, { PORT: String(PORT), SITE, CACHE_MODE: 'prod' }),
    stdio: 'ignore'
  });
  await sleep(1500);

  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });

  for (const p of PAGES) {
    const page = await ctx.newPage();
    const reqs = [];
    page.on('response', async (r) => {
      try {
        const len = Number(r.headers()['content-length'] || 0);
        let size = len;
        if (!size) { const b = await r.body().catch(() => null); size = b ? b.length : 0; }
        reqs.push({ url: r.url().replace(BASE, ''), size, type: r.request().resourceType(), status: r.status() });
      } catch (e) {}
    });
    await page.goto(BASE + p, { waitUntil: 'load' });
    await sleep(1200);

    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paint = performance.getEntriesByType('paint') || [];
      const fcp = (paint.find((x) => x.name === 'first-contentful-paint') || {}).startTime || 0;
      return { dcl: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0), fcp: Math.round(fcp) };
    });

    const total = reqs.reduce((s, r) => s + r.size, 0);
    const heavy = reqs.slice().sort((a, b) => b.size - a.size).slice(0, 14)
      .map((r) => (r.size / 1024).toFixed(0) + 'K ' + r.url);
    console.log('\n' + p.padEnd(16) + (total / 1024).toFixed(0) + ' KB over ' + reqs.length +
      ' requests   fcp=' + t.fcp + 'ms load=' + t.load + 'ms');
    heavy.forEach((h) => console.log('      ' + h));
    await page.close();
  }

  await browser.close();
  try { server.kill(); } catch (e) {}
})();
