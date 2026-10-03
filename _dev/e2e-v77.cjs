/* e2e-v77: v77 pushed the user's own language into eleven pages that the
   coverage-check had flagged as having whole query shapes with no wording at
   all — /exif-viewer/ never said ISO or aperture, /image-to-base64/ never said
   "data URL" or "copy the code", /batch-rename/ never said "bulk", and so on.
   Same contract as v75/v76: the phrases must survive into the rendered text
   (with every <details> forced open first), the FAQ counts must match what
   sync-faq-schema.py wrote, and nothing may scroll sideways. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS_ROOT, 'localphototool');
const PORT = 8991;
const EXE = process.env.CHROME_EXE ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.mjs': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
let pass = 0, fail = 0;

function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '   ' + detail : '')); }
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      fs.readFile(path.normalize(path.join(SERVE_ROOT, p)), (e, d) => {
        if (e) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(d);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

const PAGES = [
  { slug: 'exif-viewer',           words: ['focal length', 'ISO', 'shutter speed', 'aperture', 'date taken'], faq: 6 },
  { slug: 'image-to-base64',       words: ['data URL', 'paste it into', 'copy the code'], faq: 7 },
  { slug: 'batch-rename',          words: ['Bulk renaming', 'all at once', 'file names', 'organize'], faq: 6 },
  { slug: 'remove-gps-from-photo', words: ['latitude and longitude', 'remove location', 'track me'], faq: 8 },
  { slug: 'share',                 words: ['AirDrop', 'without an account', 'share a link'], faq: 6 },
  { slug: 'compress-photos-for-email', words: ['e-mail', 'SMTP', 'too large to send', 'inbox'], faq: 6 },
  { slug: 'transfer',              words: ['share link', 'offline transfer', 'between computers'], faq: 8 },
  { slug: 'heic-to-jpg',           words: ["won't open"], faq: 9 },
  { slug: 'remove-background',     words: ['cut out', 'delete the background'], faq: 10 },
  { slug: 'reduce-image-size',     words: ['image file size', 'smaller file'], faq: 6 },
  { slug: 'images-to-pdf',         words: ['jpg to pdf', 'screenshot to pdf'], faq: 6 },
  { slug: 'resize-image',          words: ['too large to upload', 'too large to attach', 'change image size'], faq: 13 }
];

(async function () {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });

  for (const cfg of PAGES) {
    for (const vp of [{ name: 'desktop', width: 1280, height: 900 },
                      { name: 'phone', width: 390, height: 844 }]) {
      const tag = cfg.slug + '/' + vp.name;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message || e)));
      const url = 'http://127.0.0.1:' + PORT + '/' + cfg.slug + '/';
      const resp = await page.goto(url, { waitUntil: 'load' });

      check(tag + ' responds 200', resp.status() === 200, 'HTTP ' + resp.status());

      const info = await page.evaluate((words) => {
        document.querySelectorAll('.faq__item').forEach(function (d) { d.open = true; });
        const main = document.querySelector('main');
        const text = main ? main.innerText.toLowerCase() : '';
        const h1s = document.querySelectorAll('h1');
        const faq = Array.prototype.slice.call(document.querySelectorAll('.faq__item'));
        return {
          h1: (h1s[0] || {}).innerText || '',
          h1count: h1s.length,
          words: words.filter(function (w) { return text.indexOf(w.toLowerCase()) !== -1; }),
          faqCount: faq.length,
          opens: faq.filter(function (d) { return d.open; }).length,
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
        };
      }, cfg.words);

      check(tag + ' has exactly one h1', info.h1count === 1, 'h1=' + JSON.stringify(info.h1.trim().slice(0, 50)));
      check(tag + ' carries the user-language phrases in rendered text',
        info.words.length === cfg.words.length,
        info.words.length + '/' + cfg.words.length + ' ' + info.words.join(' | '));
      check(tag + ' renders ' + cfg.faq + ' FAQ items', info.faqCount === cfg.faq, 'count ' + info.faqCount);
      check(tag + ' first FAQ is open by default', info.opens === info.faqCount, 'open ' + info.opens + '/' + info.faqCount);
      check(tag + ' does not scroll sideways', info.overflow <= 0, 'overflowX ' + info.overflow);
      check(tag + ' no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' / '));

      const after = await page.evaluate(() => {
        const bodies = Array.prototype.slice.call(document.querySelectorAll('.faq__body'));
        return {
          empty: bodies.filter(function (b) { return b.innerText.trim().length < 40; }).length,
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
        };
      });
      check(tag + ' every FAQ answer has text', after.empty === 0, 'empty ' + after.empty);
      check(tag + ' stays put with all FAQs open', after.overflow <= 0, 'overflowX ' + after.overflow);

      const hrefs = await page.evaluate(() => Array.prototype.slice
        .call(document.querySelectorAll('a[href^=".."]'))
        .map(function (a) { return a.getAttribute('href'); }));
      const bad = [];
      for (const h of Array.from(new Set(hrefs))) {
        const r = await page.request.get('http://127.0.0.1:' + PORT + '/' + h.split('/').slice(-2).join('/'));
        if (r.status() !== 200) bad.push(h + ':' + r.status());
      }
      check(tag + ' internal links resolve', bad.length === 0, bad.join(',') || hrefs.length + ' checked');

      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
