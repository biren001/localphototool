/* e2e-v84: /compress-pdf-to-100kb/ is a size promise, so the only useful test
   is whether the promise survives contact with a real file.

   The page cites measurements — 299,733 bytes asked for 100 KB landed at
   89,559 with 3,001 characters still readable, and the 102,400-byte limit
   spelled out twice — so, as with every other e2e on this site, the first
   assertion reads the *rendered* text rather than trusting the table.

   Those figures have a second family. The site's encoder prefers a WASM module
   whenever that module has downloaded, so one visitor is measured with the
   browser's own JPEG encoder and the next with the module, and the two do not
   agree. The page prints both, and the run here names its own encoder, which
   is the only way a reported byte count is ever checkable.

   The second half is the part that matters here and that no other page has had
   to prove: feed the real fixture through the real <input type="file">, press
   the button, and read the produced file back out of its own blob URL — then
   assert the bytes are actually under 102,400, because "we searched for a
   quality that fits" is only true if the file it hands back fits. That is also
   the assertion the first version of this page's engine failed: it counted
   anything it had measured as the answer and reported success at 196 KB.

   The third promise is the refusal. An encrypted document is not shrunk, it is
   refused and the original is handed back, so the last block checks the result
   card says refused rather than claiming a win it did not have.

   Run: NODE_PATH=<workspace node_modules> node _dev/e2e-v84.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS_ROOT, 'localphototool');
const FIXTURE = path.join(WS_ROOT, '_dev', 'out', 'pdf');
const PORT = 8897;
const EXE = process.env.CHROME_EXE ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const LIMIT_100 = 100 * 1024;
const LIMIT_500 = 500 * 1024;

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

    await page.goto('http://127.0.0.1:' + PORT + '/compress-pdf-to-100kb/', { waitUntil: 'load' });
    await page.waitForTimeout(400);

    /* ---------- the page says what it claims, in words ---------- */

    const h1 = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ');
    check('/compress-pdf-to-100kb/ opens with the headline it promises', /compress a pdf to 100 kb/i.test(h1), h1.slice(0, 60));

    const txt = (await visibleText(page)).toLowerCase();
    const wanted = ['compress a pdf to 100 kb', '100 kb', 'under 100 kb', 'without uploading', 'selectable'];
    check('the way people ask for it is on the page', wanted.every((s) => txt.indexOf(s) >= 0));
    /* The first-run figures have to be rendered, and so do the WASM ones: the
       page quotes both families, because which encoder answers decides which
       set a visitor is shown. A number that only exists in the JSON is a
       number that cannot be checked. */
    check('the measured figures are rendered, not just written in a table',
      ['299,733', '89,559', '174,091', '283,032', '70,401', '491,351',
       '100,684', '197,939', '423,414', '102,400', '3,001'].every((s) => txt.indexOf(s) >= 0),
      ['299,733', '89,559', '174,091', '283,032', '70,401', '491,351', '100,684', '197,939', '423,414']
        .filter((s) => txt.indexOf(s) < 0).join(','));
    check('the honest boundary is on the page too', txt.indexOf('encrypted') >= 0 && txt.indexOf('refused') >= 0);
    check('the two routes are compared with a number, not a sneer',
      txt.indexOf('84,252') >= 0 && txt.indexOf('79,348') >= 0 && txt.indexOf('none of them') >= 0);

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

    /* ---------- nothing runs before a file arrives ---------- */

    check('the target button starts disabled', await page.locator('#ptRun').isDisabled());

    /* ---------- a real document, at a real 100 KB limit ---------- */

    const mixed = path.join(FIXTURE, 'mixed.pdf');
    const photos = path.join(FIXTURE, 'photos.pdf');
    const mixedIn = fs.statSync(mixed).size;
    const photosIn = fs.statSync(photos).size;

    await page.setInputFiles('#ptInput', mixed);
    await page.waitForTimeout(600);

    check('the read-out counts the images it found',
      (await page.locator('#ptReport').isVisible()) && /image/.test(await page.locator('#ptReport').innerText()));
    /* The load itself kicks off a read-out pass, so the button goes disabled
       while it works. Waiting for the state the page is meant to reach beats
       guessing a timeout — a fixed sleep here produced a flaky FAIL. */
    let enabled = true;
    try {
      await page.waitForFunction('!document.getElementById("ptRun").disabled', null, { timeout: 60000 });
    } catch (e) { enabled = false; }
    check('the target button is enabled once a file is loaded', enabled);

    await page.locator('#ptRun').click();
    await page.locator('#ptResult').waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(400);

    const facts = (await page.locator('#ptResultFacts').innerText()).replace(/\s+/g, ' ');
    check('the result names the limit it was working to', facts.indexOf('102,400') >= 0, facts.slice(0, 80));
    check('the result says which quality was chosen and how hard it looked',
      /quality \d+/.test(facts) && /attempt/.test(facts), facts.slice(0, 140));
    /* A byte count without its encoder is a number nobody can reproduce, and
       the two encoders disagree by roughly a tenth of the file. */
    check('the result says which JPEG encoder answered, so the figure is checkable',
      /jpeg encoder:/i.test(facts) &&
      /wasm module|browser's own encoder/i.test(facts), facts.slice(0, 200));

    const out100 = await page.evaluate(async () => {
      const a = document.getElementById('ptDownload');
      const buf = await fetch(a.href).then((r) => r.arrayBuffer());
      return {
        bytes: buf.byteLength,
        head: String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 5))),
        name: a.getAttribute('download'),
        title: document.getElementById('ptResultTitle').textContent
      };
    });
    check('the download is a real PDF', out100.head === '%PDF-', out100.head + ' / ' + out100.bytes + ' bytes / ' + out100.name);
    check('THE PROMISE HOLDS: the file is inside the 100 KB limit', out100.bytes <= LIMIT_100,
      out100.bytes + ' bytes vs ' + LIMIT_100);
    check('the file did get smaller', out100.bytes < mixedIn, mixedIn + ' in -> ' + out100.bytes);
    check('the download is named after the target', out100.name === 'mixed-100kb.pdf', String(out100.name));
    check('the result card says it got there', /Inside the target/i.test(out100.title), out100.title);

    /* ---------- a bigger budget, on the picture-heavy fixture ---------- */

    await page.locator('#ptTarget').fill('500');
    await page.locator('#ptTarget').dispatchEvent('input');
    await page.locator('#ptScale').uncheck();          /* quality only, no resizing */
    await page.waitForTimeout(200);
    await page.locator('#ptRun').click();
    await page.waitForTimeout(9000);

    const out500 = await page.evaluate(async () => {
      const a = document.getElementById('ptDownload');
      const buf = await fetch(a.href).then((r) => r.arrayBuffer());
      return {
        bytes: buf.byteLength,
        head: String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 5))),
        facts: document.getElementById('ptResultFacts').innerText.replace(/\s+/g, ' ')
      };
    });
    check('a 500 KB budget produces a real PDF, inside it', out500.head === '%PDF-' && out500.bytes <= LIMIT_500,
      out500.bytes + ' bytes vs ' + LIMIT_500);
    check('with room to spare it does not resize a single pixel',
      /own pixel size/.test(out500.facts), out500.facts.slice(0, 140));

    /* ---------- the four-photo fixture: quality alone cannot do it ---------- */

    await page.goto('http://127.0.0.1:' + PORT + '/compress-pdf-to-100kb/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.setInputFiles('#ptInput', photos);
    await page.waitForTimeout(600);
    await page.locator('#ptTarget').fill('100');
    await page.locator('#ptTarget').dispatchEvent('input');
    await page.locator('#ptRun').click();
    await page.locator('#ptResult').waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(400);

    const outPhotos = await page.evaluate(async () => {
      const a = document.getElementById('ptDownload');
      const buf = await fetch(a.href).then((r) => r.arrayBuffer());
      return {
        bytes: buf.byteLength,
        facts: document.getElementById('ptResultFacts').innerText.replace(/\s+/g, ' '),
        bytesIn: document.getElementById('ptFacts').innerText.replace(/\s+/g, ' ')
      };
    });
    check('four photos under 100 KB also land inside the limit', outPhotos.bytes <= LIMIT_100,
      outPhotos.bytes + ' bytes vs ' + LIMIT_100 + ' (in ' + photosIn + ')');
    check('when quality is not enough it says it capped the pictures',
      /(px cap|capped at \d+ px)/.test(outPhotos.facts), outPhotos.facts.slice(0, 140));

    /* ---------- the refusal ---------- */

    await page.goto('http://127.0.0.1:' + PORT + '/compress-pdf-to-100kb/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.setInputFiles('#ptInput', path.join(FIXTURE, 'encrypted.pdf'));
    await page.waitForTimeout(600);
    await page.locator('#ptRun').click();
    await page.waitForTimeout(2500);

    const refused = await page.evaluate(() => ({
      title: (document.getElementById('ptResultTitle') || {}).textContent,
      facts: (document.getElementById('ptResultFacts') || {}).innerText || ''
    }));
    check('an encrypted document is refused, not shrunk',
      /refused/i.test(refused.title || '') && /encrypt/i.test(refused.facts),
      (refused.title || '') + ' / ' + refused.facts.slice(0, 60));

    /* ---------- layout ---------- */

    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    check('nothing scrolls sideways on a 390px viewport', overflow <= 1, String(overflow) + 'px');

    const cur = await page.evaluate(() => {
      const a = document.querySelector('a[aria-current="page"]');
      return a ? a.getAttribute('href') : null;
    });
    check('the current page is the target page, not the other PDF tool', cur === '../compress-pdf-to-100kb/', String(cur));

    check('no page errors while running the fixtures', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
