/* Screenshots of the HEIC landing page, for eyeballing the layout.
   Run: node _dev/shot-heic.cjs
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8895;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = path.join(__dirname, 'out');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  await sleep(900);

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  const desktop = await browser.newContext({ viewport: { width: 1400, height: 950 }, userAgent: UA });
  const page = await desktop.newPage();
  await page.goto(BASE + '/heic-to-jpg/', { waitUntil: 'domcontentloaded' });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'heic-top.png') });

  /* The compress page, shot the same way: the hero band is shared design, so a
     boundary that looks wrong here should look equally wrong there. */
  const ref = await desktop.newPage();
  await ref.goto(BASE + '/compress/', { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await ref.screenshot({ path: path.join(OUT, 'heic-reference-compress-top.png') });
  await ref.close();

  await page.evaluate(() => document.querySelector('.tool').scrollIntoView({ block: 'start' }));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'heic-tool.png') });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'heic-faq.png') });

  /* dark theme, since every new block has to hold up in both */
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.evaluate(() => document.querySelector('.tool').scrollIntoView({ block: 'start' }));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'heic-tool-dark.png') });

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, userAgent: UA, deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  const m = await mobile.newPage();
  await m.goto(BASE + '/heic-to-jpg/', { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await m.screenshot({ path: path.join(OUT, 'heic-mobile.png') });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  await browser.close();
  server.kill();
  console.log('shots written to ' + OUT);
  console.log('mobile horizontal overflow: ' + overflow + 'px (must be 0)');
})();
