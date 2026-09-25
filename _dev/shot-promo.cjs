#!/usr/bin/env node
/**
 * shot-promo.cjs — produce the screenshots the directory listings and a
 * Product Hunt gallery need.
 *
 * Why camera-grade fixtures: a promo shot of a compressor is only honest if the
 * before/after numbers on screen are ones a visitor will reproduce. An
 * already-optimised JPEG legitimately comes back ~unchanged (Auto mode refuses
 * to make a file larger), which would make the screenshot say "0% saved" and
 * read as broken. So the shots use _dev/corpus/photo-*-hq.jpg — the same Q96
 * corpus the published figures were measured on (see _dev/measured/).
 *
 * Outputs:
 *   promo/screenshot-compress-desktop.png  element shot of the tool block, 2x
 *   promo/screenshot-home-mobile.png       mobile viewport, 2x
 *
 * Usage: node _dev/shot-promo.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS = path.join(__dirname, '..');
const SITE = path.join(WS, 'localphototool');
const OUT = path.join(WS, 'promo');
const PORT = 8834;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

// The site is served with localphototool/ as the root so the paths in the
// screenshots read like the real ones (/compress/, not /localphototool/compress/).
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(SITE, p));
  if (!file.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(d);
  });
});

const BIN = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

server.listen(PORT, () => { (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: BIN });

  // ---- 1. Desktop: the tool block with real results in it -------------------
  {
    // A viewport shot, not a locator shot. Screenshotting #tool directly makes
    // the sticky site header render at its viewport position *inside* the
    // element box, i.e. printed across the middle of the drop zone, which reads
    // as a broken page. Scrolling the tool block up under a normal sticky
    // header gives the same content with the nav where it belongs.
    // Height is chosen so the whole tool block fits above the sticky totals
    // bar. At 900px the bar parked itself over the second result row, which is
    // the row carrying the second saving figure — the shot lost the evidence.
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1240 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/compress/`, { waitUntil: 'load' });
    await page.waitForTimeout(600);

    // Two camera-grade frames. The engine will need to fetch its WASM, so the
    // first result can take tens of seconds on a cold cache.
    // photo-2-hq was dropped from the shot on purpose: it is already near
    // optimal, so Auto correctly returns it unchanged and the row reads
    // "already optimal". True, but a mixed signal in a promo image.
    const files = ['photo-1-hq.jpg', 'photo-3-hq.jpg'].map((n) => ({
      name: n, mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(WS, '_dev', 'corpus', n)),
    }));
    await page.setInputFiles('#fileInput', files);

    await page.waitForFunction(
      () => !document.querySelector('#results')?.hidden
        && document.querySelectorAll('#resultList .result').length >= 2,
      { timeout: 240000, polling: 500 },
    );
    // Let the per-row spinners finish so no row reads "working…".
    await page.waitForFunction(() => !document.querySelector('#resultList .is-busy'), { timeout: 240000, polling: 300 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    const summary = (await page.textContent('#resSummary')) || '';
    const rows = await page.$$eval('#resultList .result', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    console.log('Desktop screenshot — summary:', summary.trim());
    rows.forEach((r) => console.log('  row:', r));

    // Park the tool block directly under the sticky header. Exact, not
    // header+8: an 8px gap lets the last line of the section above peek through
    // and the shot looks like a clipping bug.
    await page.evaluate(() => {
      const header = document.querySelector('header') || document.querySelector('.site-header') || document.querySelector('nav');
      const h = header ? header.getBoundingClientRect().height : 0;
      const top = document.querySelector('#tool').getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - h));
    });
    await page.waitForTimeout(600);

    // Neither result row may be covered by the sticky totals bar, and the bar
    // itself must be inside the frame.
    const shot = await page.evaluate(() => {
      const bar = document.querySelector('#actionBar');
      const barTop = (bar && !bar.hidden) ? bar.getBoundingClientRect().top : window.innerHeight;
      const rows = [...document.querySelectorAll('#resultList .result')].map((e) => e.getBoundingClientRect());
      return {
        barInFrame: !bar || bar.hidden ? false : bar.getBoundingClientRect().bottom <= window.innerHeight + 1,
        rowsClear: rows.every((r) => r.bottom <= barTop + 1 && r.top >= 0),
        covered: rows.filter((r) => r.bottom > barTop + 1).length,
      };
    });
    console.log('  totals bar inside the frame:', shot.barInFrame, '| every result row clear of it:', shot.rowsClear);
    if (!shot.barInFrame || !shot.rowsClear) {
      console.error(`FATAL  the promo shot is mis-framed (${shot.covered} row(s) hidden behind the totals bar)`);
      await browser.close(); server.close(); process.exit(1);
    }

    await page.screenshot({ path: path.join(OUT, 'screenshot-compress-desktop.png') });
    console.log('  wrote promo/screenshot-compress-desktop.png');
    await ctx.close();
  }

  // ---- 2. Mobile: the home page --------------------------------------------
  {
    const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const ctx = await browser.newContext({
      userAgent: MOBILE_UA, viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'screenshot-home-mobile.png') });
    console.log('  wrote promo/screenshot-home-mobile.png');
    await ctx.close();
  }

  await browser.close();
  server.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); server.close(); process.exit(1); }); });
