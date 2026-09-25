/* Screenshots of the measured-results section on /compress/.

   The published numbers live in prose, so the only way to confirm they render
   as a table rather than as a wall of text — and that the wide table does not
   push a phone sideways — is to look at them. */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const CHROME =
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

const srv = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(WS_ROOT, url);
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(WS_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('nope');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  async function shoot(name, opts) {
    const ctx = await browser.newContext({
      viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 1000 },
      userAgent: opts.mobile ? UA.replace(/\(.*?\)/, '(iPhone; CPU iPhone OS 17_0 like Mac OS X)') : UA,
      deviceScaleFactor: 1
    });
    const page = await ctx.newPage();
    await page.goto(BASE + opts.url, { waitUntil: 'load' });
    if (opts.dark) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: 'start' });
    }, opts.scrollTo);
    await page.waitForTimeout(450);
    /* boundingBox() is already in page coordinates, which is what clip wants,
       and it is the only form that carries a real width — a hand-built rect
       from getBoundingClientRect leaves width unset and Playwright rejects it. */
    let clip;
    if (opts.clipTo) {
      const el = await page.$(opts.clipTo);
      const box = el ? await el.boundingBox() : null;
      if (box) clip = { x: box.x, y: box.y, width: box.width, height: Math.min(2000, box.height) };
    }
    await page.screenshot({ path: path.join(OUT, name), clip: clip });
    await ctx.close();
    console.log('wrote', name);
  }

  try {
    await shoot('measured-auto-light.png', {
      url: '/localphototool/compress/',
      scrollTo: '#measured'
    });
    await shoot('measured-auto-dark.png', {
      url: '/localphototool/compress/',
      scrollTo: '#measured',
      dark: true
    });
    await shoot('measured-mobile.png', {
      url: '/localphototool/compress/',
      scrollTo: '#measured',
      mobile: true
    });
  } finally {
    await browser.close();
    srv.close();
  }
})();
