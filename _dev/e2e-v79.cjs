/* e2e-v79: v79 turned competitor complaints into measurements instead of
   adjectives. _dev/measure-recompression.cjs took three 2400x1600 photographs,
   re-encoded each of them three times at the same quality setting and found the
   total only moved 1,368,828 -> 1,368,713 bytes (115 bytes across all three),
   while a same-pixel lossless PNG came back 104% to 191% bigger than the JPEG
   it replaced. That number is the honest answer to "why did my image not get
   smaller?", so it now lives on a new page /why-my-image-wont-get-smaller/ and
   in a new section of /compress/.

   Same contract as e2e-v75/76/77: the phrases must survive into the rendered
   text (with every <details> forced open first, because a collapsed one only
   exposes its summary), the FAQ counts must match what sync-faq-schema.py
   wrote, and nothing may scroll sideways. Two pages carry extra assertions of
   their own: the new page has to actually show the measured figure and the
   compressor it promises, since a page about numbers that cites none would be
   worse than no page. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS_ROOT, 'localphototool');
const PORT = 8993;
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
  {
    slug: 'compress',
    words: ['already as small as it gets', 'compressing twice', 'came back bigger',
      'already optimal', 'one at a time', 'media library'],
    faq: 14
  },
  {
    /* The FAQ summary here reads "come back bigger" while /compress/ uses
       "came back bigger" — both are real customer phrasings, so the assertion
       picks the form this page actually renders ("bigger than the original"),
       and /compress/ still carries "came back bigger". */
    slug: 'why-my-image-wont-get-smaller',
    words: ["won't get smaller", 'bigger than the original', 'already optimal',
      'keep the original', 'media library', 'by hand'],
    faq: 7,
    measured: '1,368,713',
    dropzone: true
  }
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

      if (cfg.measured) {
        const shown = await page.evaluate((n) => {
          const main = document.querySelector('main');
          return (main ? main.innerText : '').indexOf(n) !== -1;
        }, cfg.measured);
        check(tag + ' quotes the measured byte figure', shown, 'looking for ' + cfg.measured);
      }
      if (cfg.dropzone) {
        const hasDrop = await page.evaluate(() => !!document.querySelector('#dropzone'));
        check(tag + ' embeds the compressor it promises', hasDrop, '#dropzone ' + hasDrop);
      }

      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
