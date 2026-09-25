/* Generate favicon.ico (multi-frame PNG-in-ICO) and a lightweight OG cover JPEG. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const SITE = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55/localphototool';
const DEV = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55/_dev';
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

function makeIco(frames) {
  const n = frames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(n, 4);

  let offset = 6 + 16 * n;
  const entries = frames.map((f) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(f.size >= 256 ? 0 : f.size, 0);
    e.writeUInt8(f.size >= 256 ? 0 : f.size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(f.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += f.data.length;
    return e;
  });

  return Buffer.concat([header].concat(entries).concat(frames.map((f) => f.data)));
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---------- favicon.ico ---------- */
  const sizes = [16, 32, 48];
  const frames = [];
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.goto('file:///' + path.join(SITE, 'favicon.svg').replace(/\\/g, '/'));
    await page.waitForTimeout(120);
    const buf = await page.screenshot({ type: 'png', omitBackground: true });
    frames.push({ size, data: buf });
    await page.close();
  }
  const ico = makeIco(frames);
  fs.writeFileSync(path.join(SITE, 'favicon.ico'), ico);
  console.log('favicon.ico  ' + ico.length + ' bytes  (frames: ' + sizes.join('/') + ')');

  /* ---------- OG cover as JPEG ---------- */
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await og.goto('file:///' + path.join(DEV, 'og-shot.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await og.waitForFunction(() => {
    const i = document.getElementById('src');
    return i && i.complete && i.naturalWidth > 0;
  }, { timeout: 15000 });
  await og.waitForTimeout(400);
  await og.screenshot({ path: path.join(SITE, 'assets/img/og-cover.jpg'), type: 'jpeg', quality: 82 });
  console.log('og-cover.jpg ' + fs.statSync(path.join(SITE, 'assets/img/og-cover.jpg')).size + ' bytes');

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
