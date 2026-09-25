/* Screenshots of the finish-chime controls: the bell in the results bar and
   the switch inside the settings panel. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const OUT = path.join(WS_ROOT, '_dev/out');
const PORT = 8812;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const IMG = path.join(WS_ROOT, '_dev/out/csp-probe.png');
const PAGE = 'http://localhost:' + PORT + '/localphototool/compress/';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.normalize(path.join(WS_ROOT, p)), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
});

(async () => {
  srv.listen(PORT);
  const browser = await chromium.launch({ executablePath: EXE });

  const shoot = async (name, opts) => {
    const ctx = await browser.newContext({
      viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1180, height: 900 },
      deviceScaleFactor: 2
    });
    const page = await ctx.newPage();
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.evaluate((dark) => {
      const d = document.querySelector('details.advanced');
      if (d) d.open = true;
      if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    }, !!opts.dark);
    await page.setInputFiles('#fileInput', [
      { name: 'beach.png', mimeType: 'image/png', buffer: fs.readFileSync(IMG) },
      { name: 'sunset.png', mimeType: 'image/png', buffer: fs.readFileSync(IMG) }
    ]);
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.result');
      return rows.length >= 2 && Array.prototype.every.call(rows, (r) => !/Processing|Queued/i.test(r.textContent));
    }, { timeout: 180000 });
    await page.waitForTimeout(600);

    if (opts.bellOff) {
      await page.click('#chimeToggle');
      await page.mouse.move(5, 5);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(300);

    const target = opts.selector;
    await page.locator(target).screenshot({ path: path.join(OUT, name) });
    console.log('wrote', name);
    await ctx.close();
  };

  await shoot('chime-bell-light.png', { selector: '.results__actions' });
  await shoot('chime-bell-dark.png', { selector: '.results__actions', dark: true });
  await shoot('chime-bell-off.png', { selector: '.results__actions', bellOff: true });
  await shoot('chime-bell-mobile.png', { selector: '.results__actions', mobile: true });
  /* the checkbox itself is visually hidden, so frame its label instead */
  await shoot('chime-settings.png', { selector: 'label[for="chimeOn"]', dark: true });

  await browser.close();
  srv.close();
})();
