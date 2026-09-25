/* Measures how wide the header actually needs to be, per page.

   The nav is a single non-wrapping flex row and the page clips horizontal
   overflow, so the inline nav only works while it fits. That makes the
   breakpoint in style.css a measured number rather than an opinion, and this is
   the instrument: run it after adding or renaming a nav entry, then set the
   breakpoint to the largest "needs" value below with room to spare.

   audit-nav.cjs is the assertion (does it fit?); this is the ruler (how much
   room is there?). Run both when the nav changes.

   Run: node _dev/measure-nav.cjs
*/
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8902;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = ['/', '/compress/', '/heic-to-jpg/', '/compress-without-uploading/',
  '/about/', '/privacy/', '/terms/', '/share/'];

/* Below the breakpoint the stylesheet swaps the row for the hamburger, so a
   narrow viewport stops describing the inline layout we are measuring. This
   override pins the desktop arrangement at every width, which is what makes the
   search below meaningful: it answers "how wide would the row have to be?" even
   while the row is not actually being used. */
const FORCE_INLINE = '@media (max-width: 1080px){' +
  '.nav__links{position:static !important;flex-direction:row !important;' +
  'opacity:1 !important;pointer-events:auto !important;transform:none !important;' +
  'background:none !important;border:0 !important;padding:0 !important;' +
  'box-shadow:none !important;margin:0 !important;}' +
  '.nav__link{padding:8px 12px !important;font-size:0.9125rem !important;}' +
  '.nav__toggle{display:none !important;}' +
  '.nav__actions .btn{display:inline-flex !important;}' +
  '.nav__install{width:auto !important;padding:0 12px !important;}' +
  '.nav__install-text{display:inline !important;}' +
  '}';

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { await fetch(BASE + '/'); up = true; } catch (e) { await sleep(250); }
  }
  if (!up) { console.log('the preview server never came up'); process.exit(1); }

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const rows = [];

  for (const p of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForSelector('.site-header', { timeout: 8000 });
    await page.addStyleTag({ content: FORCE_INLINE });

    /* Which part costs what. The nav lays out at its natural width regardless
       of the viewport, so these are stable numbers, not artifacts. */
    const parts = await page.evaluate(() => {
      const nav = document.querySelector('.site-header .nav');
      const inner = document.querySelector('.site-header').firstElementChild;
      const cs = getComputedStyle(inner);
      const out = {};
      ['brand', 'nav__links', 'nav__actions'].forEach(function (cls) {
        const el = nav.querySelector('.' + cls);
        out[cls] = el ? Math.round(el.getBoundingClientRect().width) : 0;
      });
      out.padding = Math.round(parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
      out.links = nav.querySelectorAll('.nav__link').length;
      return out;
    });

    /* Binary search the narrowest viewport where nothing gets cut off. */
    let lo = 700, hi = 1400;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      await page.setViewportSize({ width: mid, height: 800 });
      await sleep(60);
      const fits = await page.evaluate(() => {
        const doc = document.documentElement;
        const inner = document.querySelector('.site-header').firstElementChild;
        const box = inner.getBoundingClientRect();
        let clipped = 0;
        inner.querySelectorAll('a, button').forEach(function (el) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) clipped++;
        });
        return clipped === 0 && doc.scrollWidth <= doc.clientWidth + 1;
      });
      if (fits) hi = mid; else lo = mid;
    }

    rows.push({ page: p, needs: hi, parts: parts });
    await ctx.close();
  }

  const width = Math.max(...rows.map(function (r) { return r.needs; }));
  rows.forEach(function (r) {
    const p = r.parts;
    console.log('  ' + r.page.padEnd(15) + ' needs ' + String(r.needs).padStart(4) + 'px   ' +
      '(' + p.links + ' links, brand ' + p.brand + ' + links ' + p.nav__links +
      ' + actions ' + p.nav__actions + ' + padding ' + p.padding + ')');
  });
  console.log('\n  widest page needs ' + width + 'px — the inline nav breakpoint in');
  console.log('  style.css must stay at or above this, with headroom for a new entry.');

  await browser.close();
  server.kill();
})().catch(function (e) {
  console.log('measurement failed: ' + ((e && e.message) || e));
  process.exit(1);
});
