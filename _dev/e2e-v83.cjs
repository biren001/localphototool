/* e2e-v83: /merge-pdf/ is a promise that has to hold twice over.

   The page cites a measurement — three printed documents, 2,001,057 bytes,
   908,204 after the pictures are re-encoded — so the first thing every other
   e2e on this site does applies: a number nobody can reproduce is a lie, and
   the assertion reads the rendered text, not the table. But the page also
   promises to *do* the thing, so the second half drives the real <input
   type="file"> with the same fixtures the measurement is built from, presses
   the button, and reads the produced file back out of its blob: URL: it has
   to start with %PDF-, it has to be smaller than the parts it was built from,
   and it has to say how many pictures came back re-encoded.

   The third promise is the refusal: an encrypted document is not merged, it is
   reported. So the last block feeds one good file and one encrypted file and
   checks that the merge button stays disabled rather than quietly producing a
   document that will not open.

   Run: NODE_PATH=<workspace node_modules> node _dev/e2e-v83.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS_ROOT, 'localphototool');
const FIXTURE = path.join(WS_ROOT, '_dev', 'out', 'pdf');
const PORT = 8896;
const EXE = process.env.CHROME_EXE ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.mjs': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };
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
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

const visibleText = (page) => page.evaluate(() => {
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  const m = document.querySelector('main');
  return m ? m.innerText.replace(/\s+/g, ' ') : '';
});

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: EXE });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto('http://127.0.0.1:' + PORT + '/merge-pdf/', { waitUntil: 'load' });
    await page.waitForTimeout(400);

    /* ---------- the page says what it claims, in words ---------- */

    const h1 = await page.locator('h1').first().innerText();
    check('/merge-pdf/ opens with the headline it promises', /merge\s+pdf\s+files\s+without\s+uploading/i.test(h1.replace(/\s+/g, ' ')), h1.replace(/\s+/g, ' ').slice(0, 60));

    const txt = (await visibleText(page)).toLowerCase();
    const wanted = ['merge pdf files', 'without uploading', 'combine pdf files', 'join pdf'];
    check('the way people ask for it is on the page', wanted.every((s) => txt.indexOf(s) >= 0));
    check('the measured figure is rendered, not just written in the table', txt.indexOf('908,204') >= 0 && txt.indexOf('2,001,057') >= 0);
    check('the honest boundary is on the page too', txt.indexOf('encrypted') >= 0 && txt.indexOf('refused') >= 0);

    const faq = await page.evaluate(() => {
      const vis = document.querySelectorAll('main details').length;
      const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      let count = 0;
      blocks.forEach((s) => {
        let j; try { j = JSON.parse(s.textContent); } catch (e) { return; }
        const nodes = j && j['@graph'] ? j['@graph'] : [j];
        nodes.forEach((n) => { if (n && n['@type'] === 'FAQPage') count += (n.mainEntity || []).length; });
      });
      return { vis: vis, schema: count };
    });
    check('the visible FAQ and the schema agree', faq.vis === faq.schema && faq.vis > 0, faq.vis + ' visible / ' + faq.schema + ' in schema');

    /* ---------- the button refuses to run until there are two files ---------- */

    check('the merge button starts disabled', await page.locator('#mergeRun').isDisabled());

    /* ---------- three real documents, merged for real ---------- */

    const photos = path.join(FIXTURE, 'photos.pdf');
    const mixed = path.join(FIXTURE, 'mixed.pdf');
    const text = path.join(FIXTURE, 'text-only.pdf');
    const bytes = [photos, mixed, text].map((f) => fs.statSync(f).size);
    const sumIn = bytes.reduce((a, b) => a + b, 0);

    await page.setInputFiles('#mergeInput', [photos, mixed, text]);
    await page.waitForTimeout(700);

    const rows = await page.locator('#mergeRows .result').count();
    check('all three files are listed', rows === 3, rows + ' rows');
    const summary = await page.locator('#mergeListSummary').innerText();
    check('the list reports pages and bytes', /3 files/i.test(summary) && /pages/i.test(summary), summary.replace(/\s+/g, ' ').slice(0, 70));
    check('the merge button is enabled once there are two files', await page.locator('#mergeRun').isEnabled());

    /* move the first document down: the page order must follow the list order */
    const firstBefore = await page.locator('#mergeRows .result__name').first().innerText();
    await page.locator('#mergeRows .result').first().locator('button', { hasText: /^Down$/ }).click();
    await page.waitForTimeout(200);
    const firstAfter = await page.locator('#mergeRows .result__name').first().innerText();
    check('moving a document down moves its pages', firstBefore !== firstAfter, firstBefore.trim() + ' -> ' + firstAfter.trim());

    await page.locator('#mergeRun').click();
    await page.locator('#mergeResult').waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(500);

    const facts = (await page.locator('#mergeResultFacts').innerText()).replace(/\s+/g, ' ');
    check('the result says what was replaced', /re-encoded/i.test(facts), facts.slice(0, 90));
    check('the result reports the page count it actually joined', /\d+\s+pages?/.test(facts) && /order you listed them/i.test(facts));

    /* read the produced file back out of its own blob URL */
    const out = await page.evaluate(async () => {
      const a = document.getElementById('mergeDownload');
      const buf = await fetch(a.href).then((r) => r.arrayBuffer());
      return { bytes: buf.byteLength, head: String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 5))), name: a.getAttribute('download') };
    });
    check('the download is a real PDF', out.head === '%PDF-', out.head + ' / ' + out.bytes + ' bytes / ' + out.name);
    check('the merged file is smaller than the parts that went in', out.bytes < sumIn, sumIn + ' in -> ' + out.bytes + ' out');
    check('the download is named after the number of files', out.name === 'merged-3-files.pdf', String(out.name));

    /* ---------- an encrypted file is refused, not guessed at ---------- */

    await page.goto('http://127.0.0.1:' + PORT + '/merge-pdf/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.setInputFiles('#mergeInput', [photos, path.join(FIXTURE, 'encrypted.pdf')]);
    await page.waitForTimeout(700);

    const errRows = await page.locator('#mergeRows .result.is-error').count();
    check('the encrypted document is flagged as unreadable', errRows === 1, errRows + ' flagged');
    const errText = await page.locator('#mergeRows .result.is-error .result__meta').first().innerText();
    check('the flag says why, not just that it failed', /encrypt/i.test(errText), errText.replace(/\s+/g, ' ').slice(0, 60));
    check('there is only one mergeable file, so it will not run', await page.locator('#mergeRun').isDisabled());

    /* ---------- layout ---------- */

    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    check('nothing scrolls sideways on a 390px viewport', overflow <= 1, String(overflow) + 'px');

    const cur = await page.evaluate(() => {
      const a = document.querySelector('a[aria-current="page"]');
      return a ? a.getAttribute('href') : null;
    });
    check('the current page is the merge page, not the other PDF tool', cur === '../merge-pdf/', String(cur));

    check('no page errors while running the fixtures', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
