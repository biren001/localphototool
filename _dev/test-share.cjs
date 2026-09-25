/* Browser tests for /share/ and the share entry points on /compress/. */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = path.join(__dirname, '..');
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
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : ''));
  }
}

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
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const SHARE = BASE + '/localphototool/share/';
  const COMPRESS = BASE + '/localphototool/compress/';

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  console.log('\nShare page — browser tests\n');

  try {
    /* ------------------------------ A. the share page ------------------- */
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: UA,
      permissions: ['clipboard-read', 'clipboard-write']
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const resp = await page.goto(SHARE, { waitUntil: 'load' });
    check('/share/ returns 200', resp.status() === 200, 'status ' + resp.status());
    check('the page has a real title', (await page.title()).toLowerCase().indexOf('share') !== -1);

    const qr = await page.evaluate(() => {
      const img = document.querySelector('.share-qr__img');
      return img ? { w: img.naturalWidth, src: img.getAttribute('src') } : null;
    });
    check('the QR image actually loads', !!qr && qr.w > 300, JSON.stringify(qr));

    /* Bring the posters into view: they are lazy, and a lazy image that has
       never been near the viewport reports naturalWidth 0. */
    await page.evaluate(() => {
      const g = document.querySelector('.poster-grid');
      if (g) g.scrollIntoView({ block: 'center' });
    });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.poster img')).every((i) => i.naturalWidth > 0),
      null, { timeout: 15000 }
    ).catch(() => {});

    const posters = await page.evaluate(async () =>
      Promise.all(Array.from(document.querySelectorAll('.poster img')).map(async (i) => {
        /* Lazy images are not in memory until they are near the viewport, so
           read the bytes off the wire rather than off the element. */
        let bytes = 0;
        try {
          const r = await fetch(new URL(i.getAttribute('src'), location.href).href);
          bytes = (await r.arrayBuffer()).byteLength;
        } catch (e) { bytes = -1; }
        return {
          w: i.naturalWidth,
          h: i.naturalHeight,
          src: i.getAttribute('src'),
          bytes
        };
      }))
    );
    check('both posters are wired up', posters.length === 2, JSON.stringify(posters.map((p) => p.src)));
    /* The card is ~350 CSS px wide on a phone and ~530 on a desktop, so the
       displayed file only has to clear that at 2x — it used to be the 1080x1350
       print PNG, which cost ~977 KB and pushed first paint past four seconds.
       Two separate claims now: the preview is sharp enough to read, and the
       file a visitor gets from the button is still the print original. */
    check(
      'the displayed posters are sharp enough for their card',
      posters.length === 2 && posters.every((p) => p.w >= 700 && p.h >= 870),
      JSON.stringify(posters.map((p) => p.w + 'x' + p.h))
    );
    check(
      'the displayed posters are not print-sized files',
      posters.length === 2 && posters.every((p) => p.bytes > 0 && p.bytes < 120 * 1024),
      JSON.stringify(posters.map((p) => Math.round(p.bytes / 1024) + ' KB'))
    );

    /* The download links must point at real files, not placeholders. */
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[download]')).map((a) => ({
        href: a.getAttribute('href'),
        name: a.getAttribute('download')
      }))
    );
    check('three assets are downloadable', links.length === 3, JSON.stringify(links.map((l) => l.name)));
    check(
      'every download target exists on disk',
      links.every((l) => fs.existsSync(path.join(WS_ROOT, 'localphototool/share', l.href))),
      JSON.stringify(links.map((l) => l.href))
    );

    /* Copy the link and read it back out of the clipboard. */
    await page.click('#copyLink');
    await page.waitForTimeout(250);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('“Copy link” puts the site URL on the clipboard', clip === 'https://localphototool.com/', clip);
    const status = (await page.textContent('#shareStatus')) || '';
    check('the user is told it worked', status.trim().length > 0, status.trim());

    /* A headless desktop browser has no Web Share: the button must stay hidden
       rather than sitting there as a dead click. */
    check(
      'the Web Share button is hidden when unsupported',
      (await page.isVisible('#shareLink')) === false &&
        (await page.isVisible('[data-share-poster]')) === false
    );

    /* Prepared post copy. */
    const firstCopy = await page.textContent('.copy-item [data-copy]');
    await page.click('.copy-item [data-copy-btn]');
    await page.waitForTimeout(250);
    const clip2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    check(
      'post copy is copied verbatim',
      norm(clip2) === norm(firstCopy),
      JSON.stringify({ copied: norm(clip2).slice(-40), source: norm(firstCopy).slice(-40) })
    );
    check('the copied text carries the link', clip2.indexOf('localphototool.com') !== -1);

    check('no JS errors on the share page', errors.length === 0, errors[0] || 'clean');

    /* No sideways panning on a phone. */
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(SHARE, { waitUntil: 'load' });
    const overflow = await m.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    check('no horizontal overflow on a phone', overflow <= 0, overflow + 'px');
    await m.close();
    await ctx.close();

    /* --------------------------- B. the compress page ------------------- */
    console.log('\nCompress page entry points\n');
    const ctx2 = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: UA,
      permissions: ['clipboard-read', 'clipboard-write']
    });
    const p2 = await ctx2.newPage();
    const errors2 = [];
    p2.on('pageerror', (e) => errors2.push(e.message));
    await p2.goto(COMPRESS, { waitUntil: 'load' });

    const heroLink = await p2.getAttribute('.hero__share a', 'href');
    check('the hero offers a way to the share page', heroLink === '../share/', heroLink);

    /* The QR sits below the fold and is deliberately lazy-loaded, so it has no
       natural size until it is scrolled into view. Asserting without scrolling
       reported a perfectly good image as broken the moment /compress/ grew a
       measured-results section and pushed the card past the lazy threshold. */
    await p2.evaluate(() => {
      const img = document.querySelector('.share-qr__img');
      if (img) img.scrollIntoView({ block: 'center' });
    });
    await p2.waitForFunction(() => {
      const img = document.querySelector('.share-qr__img');
      return !!img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 20000 }).catch(() => { /* the check below reports it */ });

    const cardQr = await p2.evaluate(() => {
      const img = document.querySelector('.share-qr__img');
      return img ? { w: img.naturalWidth, src: img.getAttribute('src') } : null;
    });
    check('the compress page shows a working QR code', !!cardQr && cardQr.w > 300, JSON.stringify(cardQr));

    await p2.click('[data-copy-link]');
    await p2.waitForTimeout(250);
    const clip3 = await p2.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('“Copy link” works on the compress page too', clip3 === 'https://localphototool.com/', clip3);
    const status3 = (await p2.textContent('#copySiteStatus')) || '';
    check('and it confirms', status3.trim().length > 0, status3.trim());

    check('no JS errors on the compress page', errors2.length === 0, errors2[0] || 'clean');
    await ctx2.close();
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n' + pass + ' / ' + (pass + fail) + ' checks passed\n');
  process.exit(fail ? 1 : 0);
})();
