/* Generate apple-touch-icon.png and wire favicon declarations into every page. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const SITE = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55/localphototool';
const DEV = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55/_dev';
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

(async () => {
  /* ---------- apple-touch-icon (180x180, opaque) ---------- */
  const tmp = path.join(DEV, '_appicon.html');
  fs.writeFileSync(tmp,
    '<!DOCTYPE html><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:#3b2fbf;overflow:hidden}' +
    '#a{display:block;width:180px;height:180px}</style>' +
    '<img id="a" src="../localphototool/favicon.svg" width="180" height="180">');

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const i = document.getElementById('a');
    return i && i.complete && i.naturalWidth > 0;
  }, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SITE, 'apple-touch-icon.png'), type: 'png' });
  await browser.close();
  console.log('apple-touch-icon.png ' + fs.statSync(path.join(SITE, 'apple-touch-icon.png')).size + ' bytes');
  fs.unlinkSync(tmp);

  /* ---------- wire favicon links into every page ---------- */
  const htmls = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) htmls.push(p);
    }
  })(SITE);

  for (const f of htmls) {
    let s = fs.readFileSync(f, 'utf8');
    if (s.includes('favicon.ico')) { console.log('skip (already wired)  ' + path.relative(SITE, f)); continue; }

    const m = s.match(/<link rel="icon" href="([^"]+)favicon\.svg"[^>]*>/);
    if (!m) { console.log('NO ICON TAG  ' + path.relative(SITE, f)); continue; }
    const prefix = m[1];
    const inject = m[0] +
      '\n<link rel="icon" href="' + prefix + 'favicon.ico" sizes="32x32">' +
      '\n<link rel="apple-touch-icon" href="' + prefix + 'apple-touch-icon.png">';
    s = s.replace(m[0], inject);

    /* 404.html still used root-absolute paths; make them relative too. */
    s = s.split('href="/assets/').join('href="assets/')
         .split('src="/assets/').join('src="assets/')
         .split('href="/favicon.svg"').join('href="favicon.svg"')
         .split('href="/compress/"').join('href="compress/"')
         .split('href="/"').join('href="./"');

    fs.writeFileSync(f, s);
    console.log('wired  ' + path.relative(SITE, f) + '   prefix="' + prefix + '"');
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
