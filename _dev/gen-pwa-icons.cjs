/* Rasterises the app icon into the PNG sizes a PWA install prompt wants:
     icon-192.png / icon-512.png  (purpose: any)
     maskable-512.png             (purpose: maskable — glyph inside the safe zone)
   Uses the real Chromium renderer, so no image library is needed.            */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const SITE = path.join(__dirname, '..', 'localphototool');
const TMP = path.join(__dirname, '.tmp');
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const GLYPH = `
  <g fill="none" stroke="#ffffff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 22v-4a2 2 0 0 1 2-2h12"/>
    <path d="M46 30v14a2 2 0 0 1-2 2H26"/>
    <path d="m24 33 5-6 5 5"/>
    <path d="M34 27v14"/>
  </g>`;

fs.mkdirSync(TMP, { recursive: true });

function writePage(name, body) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, '<!doctype html><meta charset="utf-8">' + body);
  return 'file:///' + file.replace(/\\/g, '/');
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });

  /* 1. plain icons — the SVG mark, transparent corners */
  const anyUrl = writePage('icon-any.html', `
    <style>html,body{margin:0;height:100%;display:grid;place-items:center}
      svg{width:100%;height:100%;display:block}</style>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4f46e5"/><stop offset="0.55" stop-color="#7c3aed"/>
        <stop offset="1" stop-color="#06b6d4"/></linearGradient></defs>
      <rect width="64" height="64" rx="15" fill="url(#g)"/>${GLYPH}
    </svg>`);

  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.goto(anyUrl, { waitUntil: 'load' });
    await page.waitForTimeout(120);
    await page.screenshot({
      path: path.join(SITE, 'icon-' + size + '.png'),
      omitBackground: true
    });
    console.log('wrote icon-' + size + '.png');
  }

  /* 2. maskable — full-bleed background, glyph inside the 80% safe circle */
  const maskUrl = writePage('icon-maskable.html', `
    <style>html,body{margin:0;height:100%}
      body{background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 55%,#06b6d4 100%);
           display:grid;place-items:center}
      svg{width:58%;height:58%;display:block}</style>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${GLYPH}</svg>`);

  await page.setViewportSize({ width: 512, height: 512 });
  await page.goto(maskUrl, { waitUntil: 'load' });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SITE, 'maskable-512.png') });
  console.log('wrote maskable-512.png');

  await browser.close();

  ['icon-192.png', 'icon-512.png', 'maskable-512.png'].forEach((f) => {
    const s = fs.statSync(path.join(SITE, f));
    console.log('  ' + f + ' — ' + (s.size / 1024).toFixed(1) + ' KB');
  });
})();
