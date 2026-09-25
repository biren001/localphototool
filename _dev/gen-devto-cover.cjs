/* Render a 1000x420 cover for dev.to.

   dev.to asks for 1000x420 (2.381:1) and crops anything else to that ratio,
   which chops the top and bottom off our 1200x630 OG card — the headline is
   the first thing to go. So this is a re-layout, not a crop: same palette and
   brand mark, tighter type, stat bars dropped because they do not survive at
   feed size.

   Output is rendered at 2x (2000x840) so it stays sharp on retina, which is
   the same 1000:420 ratio dev.to wants.

   Usage:  node _dev/gen-devto-cover.cjs
*/

const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'promo', 'devto-cover.jpg');

const W = 1000;
const H = 420;
const SCALE = 2;

const FONT = 'Segoe UI, Helvetica, Arial, sans-serif';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0d18"/>
      <stop offset="1" stop-color="#141a2e"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="0.55" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.18" cy="0.1" r="0.95">
      <stop offset="0" stop-color="#4f46e5" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#4f46e5" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <g opacity="0.18" stroke="#8b93b8" stroke-width="2" fill="none">
    <circle cx="884" cy="96" r="150"/>
    <circle cx="884" cy="96" r="110"/>
    <circle cx="884" cy="96" r="70"/>
  </g>

  <g transform="translate(64,44)">
    <rect width="62" height="62" rx="16" fill="url(#brand)"/>
    <g fill="none" stroke="#ffffff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 22v-4a2 2 0 0 1 2-2h11"/>
      <path d="M44 30v13a2 2 0 0 1-2 2H25"/>
      <path d="m25 33 5-6 5 5"/>
      <path d="M35 27v13"/>
    </g>
  </g>
  <text x="142" y="84" fill="#eef1f9" font-family="${FONT}" font-size="29" font-weight="700" letter-spacing="-0.5">LocalPhotoTool.com</text>

  <text x="62" y="192" fill="#ffffff" font-family="${FONT}" font-size="52" font-weight="800" letter-spacing="-1.6">Compress images</text>
  <text x="62" y="248" fill="#ffffff" font-family="${FONT}" font-size="52" font-weight="800" letter-spacing="-1.6">without uploading them</text>
  <text x="64" y="294" fill="#9aa3bd" font-family="${FONT}" font-size="22" font-weight="400">Private, in-browser compression with measured quality control.</text>

  <g transform="translate(64,324)">
    <rect width="272" height="40" rx="20" fill="#10b981" fill-opacity="0.14" stroke="#10b981" stroke-opacity="0.5"/>
    <circle cx="22" cy="20" r="5.5" fill="#34d399"/>
    <text x="38" y="27" fill="#6ee7b7" font-family="${FONT}" font-size="18" font-weight="600">Free · no account · no watermark</text>
  </g>
</svg>
`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
  });
  await page.setContent(
    `<!DOCTYPE html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:#0a0d18}svg{display:block}</style>${svg}`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT, quality: 88 });
  await browser.close();

  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`gen-devto-cover: wrote promo/devto-cover.jpg`);
  console.log(`  logical ${W}x${H} @${SCALE}x  ->  ${W * SCALE}x${H * SCALE} px, ${kb} KB`);
  console.log(`  ratio ${(W / H).toFixed(3)}:1 (dev.to wants ${(1000 / 420).toFixed(3)}:1)`);
})();
