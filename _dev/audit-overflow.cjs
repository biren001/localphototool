/* Finds what makes a page scroll sideways on a phone.
   Prints every element whose box sticks out past the viewport, and fails the
   run if a page can actually be panned sideways.

   Why the wait condition is "load" and not "networkidle": /compress/ warms its
   codecs on purpose — worker.js pulls the mozjpeg, webp and avif WASM binaries
   from the CDN as soon as the pool starts, so the first compression is quick.
   Those are multi-hundred-KB fetches that can stay in flight for a long time on
   a slow link, which makes "no network for 500 ms" a condition that may never
   be reached. Layout geometry has nothing to do with them, so the audit waits
   for the document instead. */
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8897, BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = ['/', '/compress/', '/heic-to-jpg/', '/share/', '/about/', '/privacy/', '/terms/', '/stats/'];

let sideways = 0;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
  });
  await sleep(700);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const page = await ctx.newPage();

  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    await sleep(600);
    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const W = doc.clientWidth;
      const out = [];
      document.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > W + 1 || r.left < -1) {
          out.push({
            sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
            left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width)
          });
        }
      });
      return { clientWidth: W, scrollWidth: doc.scrollWidth, bodyScrollWidth: document.body.scrollWidth, offenders: out.slice(0, 14), total: out.length };
    });
    const bad = info.scrollWidth > info.clientWidth + 1;
    if (bad) sideways++;
    console.log('\n=== ' + p + ' ===');
    console.log('viewport ' + info.clientWidth + ' | html.scrollWidth ' + info.scrollWidth + ' | body.scrollWidth ' + info.bodyScrollWidth +
      (bad ? '   ← FAIL: the page can be panned sideways' : '   ok'));
    if (info.total) {
      console.log('offenders (' + info.total + ')' + (bad ? '' : ' — clipped, not scrollable'));
      info.offenders.forEach((o) => console.log('   ' + o.sel + '  left=' + o.left + ' right=' + o.right + ' w=' + o.w));
    }
  }

  await browser.close();
  server.kill();

  console.log('\n' + (sideways ? sideways + ' page(s) can scroll sideways' : 'no page scrolls sideways on a 390px viewport') + '\n');
  process.exit(sideways ? 1 : 0);
})();
