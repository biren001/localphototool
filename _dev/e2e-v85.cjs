/* e2e-v85: the promise of /why-cant-i-select-the-text-in-this-pdf/ is a
   diagnosis, not an extraction. Two things have to be true for that to hold.

   The first is the page's own claim, in words: it says it will tell you which
   of five causes is yours, and it says out loud that it does no OCR and
   uploads nothing. The rendered text is what is checked here, not the table
   the words were copied out of.

   The second is the reason. An extractor that finds nothing calls that a
   failure; this page has to call it information. So the fixtures are chosen to
   disagree: one file with words on both pages, one that is only pictures with a
   six-character caption on each, one with no text layer at all because it is
   encrypted. The encrypted one is the one that matters — the page must refuse
   it and say so rather than report "no text", because "no text" is a different
   sentence from "this file is locked" and a person acts on the difference.

   The figures the page quotes (2,432 and 76 on the mixed file, 603 on the text
   only one, six apiece on the pictures) are asserted as rendered numbers, and
   the page cards are numbered in document order — the first version reported
   the PDF object number instead, which sends somebody hunting for a ninth page
   in a two-page file.

   Run: NODE_PATH=<workspace node_modules> node _dev/e2e-v85.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS_ROOT, 'localphototool');
const FIXTURE = path.join(WS_ROOT, '_dev', 'out', 'pdf');
const PORT = 8898;
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

/* Words the page shows are read after collapsing the whitespace around them,
   because the extracted words themselves legitimately carry breaks. */
const terse = (s) => s.replace(/\s+/g, ' ').replace(/ ?([,.])/g, '$1').trim();

const visibleText = (page) => page.evaluate(() => {
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  const m = document.querySelector('main');
  return m ? m.innerText : '';
});

async function open(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + PORT + '/why-cant-i-select-the-text-in-this-pdf/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return page;
}

async function run(page, fixture) {
  await page.setInputFiles('#ttInput', fixture);
  await page.waitForTimeout(500);
  await page.locator('#ttRun').click();
  await page.locator('#ttReport').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => ({
    summary: (document.getElementById('ttSummary') || {}).textContent || '',
    facts: (document.getElementById('ttFacts') || {}).innerText || '',
    cards: Array.from(document.querySelectorAll('#ttPages .result-card')).map((c) => ({
      head: (c.querySelector('h3') || {}).textContent || '',
      badge: (c.querySelector('.badge') || {}).textContent || '',
      text: (c.innerText || '').replace(/\s+/g, ' '),
      inner: c.innerText.replace(/\s+/g, ' ')
    }))
  }));
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  try {
    /* ---------- what the page says, in the words a visitor reads ---------- */

    const page = await open(browser, errors);

    const h1 = terse(await page.locator('h1').first().innerText());
    check('/why-cant-i-select-the-text-in-this-pdf/ opens with its own question',
      /why can/i.test(h1) && /select the text/i.test(h1), h1.slice(0, 70));

    const txt = terse(await visibleText(page)).toLowerCase();
    const wanted = ["why can't i select the text", 'no ocr', 'character map',
      'nothing is uploaded', 'text layer', 'image only'];
    check('the way people ask the question is on the page',
      wanted.every((s) => txt.indexOf(s) >= 0),
      wanted.filter((s) => txt.indexOf(s) < 0).join(','));
    /* The numbers are the page's evidence, and an unreadable number is a
       number nobody can check. */
    check('the measured counts are rendered, not only written in a table',
      ['2,432', '76', '603'].every((s) => txt.indexOf(s) >= 0),
      ['2,432', '76', '603'].filter((s) => txt.indexOf(s) < 0).join(','));
    check('the five causes are named on the page',
      ['nothing to select', 'packed away', 'not their letters', 'encrypted',
        'does not survive'].every((s) => txt.indexOf(s) >= 0));

    const faq = await page.evaluate(() => {
      const vis = document.querySelectorAll('main details').length;
      let count = 0;
      Array.from(document.querySelectorAll('script[type="application/ld+json"]')).forEach((s) => {
        let j; try { j = JSON.parse(s.textContent); } catch (e) { return; }
        const nodes = j && j['@graph'] ? j['@graph'] : [j];
        nodes.forEach((n) => { if (n && n['@type'] === 'FAQPage') count += (n.mainEntity || []).length; });
      });
      return { vis: vis, schema: count };
    });
    check('the visible FAQ and the schema agree',
      faq.vis === faq.schema && faq.vis > 0, faq.vis + ' visible / ' + faq.schema + ' in schema');

    check('the button starts disabled, nothing runs before a file', await page.locator('#ttRun').isDisabled());

    /* ---------- a file with words on both pages ---------- */

    await page.setInputFiles('#ttInput', path.join(FIXTURE, 'mixed.in.pdf'));
    await page.waitForTimeout(500);
    check('choosing a file arms the button', !(await page.locator('#ttRun').isDisabled()));

    await page.locator('#ttRun').click();
    await page.locator('#ttReport').waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(300);

    const mixed = await page.evaluate(() => ({
      summary: document.getElementById('ttSummary').textContent,
      facts: document.getElementById('ttFacts').innerText.replace(/\s+/g, ' '),
      cards: Array.from(document.querySelectorAll('#ttPages .result-card')).map((c) => c.innerText.replace(/\s+/g, ' '))
    }));

    check('THE HEADLINE NUMBER HOLDS: page one is a measured 2,432 characters',
      /2,432 characters/.test(mixed.cards[0] || '') && /character/.test(mixed.cards[0] || ''),
      (mixed.cards[0] || '').slice(0, 60));
    check('page two is its own measured 76 characters', /76 characters/.test(mixed.cards[1] || ''));
    check('the summary adds the two up and says where they came from',
      /2,508 characters came out of 2 pages/.test(mixed.summary), mixed.summary);
    /* Document order, not object number: object 2 of a two-page file is page
       one, and reporting the object number once read as "page 8". */
    check('the cards are numbered in document order, not by PDF object',
      mixed.cards.length === 2 && /^Page 1/.test(mixed.cards[0]) && /^Page 2/.test(mixed.cards[1]),
      mixed.cards.length + ' cards');
    const tape = terse(mixed.cards.join(' ')).toLowerCase();
    check('the verbatim words are on the page, not just a count of them',
      tape.indexOf('paragraph of ordinary body text') >= 0, tape.slice(0, 80));
    check('the facts list carries the file it was read from',
      /file size: 299,733 bytes/.test(mixed.facts.toLowerCase()) && /pages: 2/.test(mixed.facts.toLowerCase()),
      mixed.facts.slice(0, 90));
    check('nothing is claimed for the picture page beyond its own words',
      mixed.cards[1].indexOf('76 characters') >= 0);

    /* ---------- the .txt that comes back is the answer, not just output ---------- */

    await page.locator('#ttDownload').click();
    await page.waitForTimeout(200);
    const saved = await page.evaluate(async () => {
      const a = document.getElementById('ttDownload');
      const buf = await fetch(a.href).then((r) => r.arrayBuffer());
      return { text: new TextDecoder('utf-8').decode(new Uint8Array(buf)), name: a.getAttribute('download') };
    });
    check('the saved file is a .txt named after the PDF, and it carries the words',
      /\.txt$/.test(saved.name || '') && /--- page 1 ---/.test(saved.text) &&
      /Paragraph of ordinary body text/i.test(saved.text),
      saved.name + ' / ' + saved.text.length + ' chars');

    /* ---------- a file that is only pictures, with a caption on each page ---------- */

    await page.locator('#ttReset').click();
    await page.waitForTimeout(200);
    check('checking another file puts the report away again',
      !(await page.locator('#ttReport').isVisible()) && (await page.locator('#ttRun').isDisabled()));

    const pictures = await run(page, path.join(FIXTURE, 'photos.in.pdf'));
    check('four picture pages are counted individually, not lumped together',
      pictures.cards.length === 4 && pictures.cards.every((c) => /^Page \d/.test(c.head)),
      pictures.cards.length + ' cards');
    check('a page that only carries a caption is not called empty',
      pictures.cards.every((c) => /6 characters/.test(c.badge)) &&
      /24 characters came out of 4 pages/.test(pictures.summary), pictures.summary);

    /* ---------- the text-only file ---------- */

    const plain = await run(page, path.join(FIXTURE, 'text-only.pdf'));
    check('the text-only file reports its own 603 characters',
      plain.cards.length === 1 && /603 characters/.test(plain.cards[0].badge) &&
      /603 characters came out of 1 page/.test(plain.summary),
      (plain.cards[0] || {}).badge + ' / ' + plain.summary);
    check('the words it hands back are the file\'s own words',
      plain.cards[0].inner.indexOf('The quick brown fox jumps over the lazy dog') >= 0,
      plain.cards[0].inner.slice(0, 60));

    /* ---------- the refusal: an encrypted file is not a file with no text ---------- */

    const locked = await run(page, path.join(FIXTURE, 'encrypted.pdf'));
    check('an encrypted file is reported as encrypted, not as empty',
      /encrypted/i.test(locked.summary) && /encryption/i.test(locked.facts.toLowerCase()) &&
      locked.cards.length === 0,
      locked.summary + ' / ' + locked.cards.length + ' cards');
    /* The words "password" belong to the page's explanation, not to the
       dictionary we found: the file says it has an encryption dictionary, and
       the sentence a person needs is about a password. Both halves are
       asserted — the fact, and the reading of it. */
    check('the refusal is written as a locked file, not a blank page',
      /password/.test(terse(await visibleText(page)).toLowerCase()), locked.facts.slice(0, 100));

    /* ---------- layout and chrome ---------- */

    const narrow = await browser.newPage({ viewport: { width: 390, height: 780 } });
    narrow.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
    await narrow.goto('http://127.0.0.1:' + PORT + '/why-cant-i-select-the-text-in-this-pdf/', { waitUntil: 'load' });
    await narrow.waitForTimeout(300);
    const overflow = await narrow.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    check('nothing scrolls sideways on a 390px viewport', overflow <= 1, String(overflow) + 'px');
    await narrow.close();

    const cur = await page.evaluate(() => {
      const a = document.querySelector('a[aria-current="page"]');
      return a ? a.getAttribute('href') : null;
    });
    check('the current page is this page, not another PDF tool',
      cur === '../why-cant-i-select-the-text-in-this-pdf/', String(cur));

    check('no page errors while the fixtures went through', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
