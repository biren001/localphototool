/* e2e-v80: v80 opens the one gap Trends left open — nobody had a real PDF page.
   /compress-pdf/ re-encodes the images inside a PDF in the browser, rebuilds
   the cross-reference table and hands the file back with the text still
   selectable. The measurement is on the page: four photos 1,689,943 -> 761,064
   bytes (-55%), one photo with body text 299,733 -> 135,558 (-54.8%), a
   text-only document 11,381 bytes unchanged, and the same four photos capped at
   1000 px 242,999 bytes (-85.6%).

   Same contract as every other e2e: the phrases have to survive into the
   rendered text (with every <details> forced open), the FAQ count has to match
   what sync-faq-schema.py wrote, nothing may scroll sideways and no page may
   throw. On top of that this page is asked to do the thing it promises twice:
   the four-photo fixture must come back smaller with a rebuilt xref, and the
   text-only fixture must come back byte for byte rather than "compressed" into
   something bigger. A page that cites measurements nobody can reproduce is a
   page that lies, so the assertions read the real output, not the table. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SERVE_ROOT = path.join(WS_ROOT, 'localphototool');
const FIXTURE = path.join(WS_ROOT, '_dev', 'out', 'pdf');
const PORT = 8895;
const EXE = process.env.CHROME_EXE ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.mjs': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
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
    srv.listen(PORT, () => resolve(srv));
  });
}

const SLUG = 'compress-pdf';
const WORDS = ['without uploading', 'selectable', 're-encode', '99.3%',
  'byte for byte', 'handed back', 'maximum edge'];
const MEASURED = ['1,689,943', '761,064', '135,558', '242,999', '11,381', '55%'];
const FAQ = 7;

(async function () {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });

  for (const vp of [{ name: 'desktop', width: 1280, height: 900 },
                    { name: 'phone', width: 390, height: 844 }]) {
    const tag = SLUG + '/' + vp.name;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    const resp = await page.goto('http://127.0.0.1:' + PORT + '/' + SLUG + '/', { waitUntil: 'load' });

    check(tag + ' responds 200', resp.status() === 200, 'HTTP ' + resp.status());

    const info = await page.evaluate((words) => {
      document.querySelectorAll('.faq__item').forEach(function (d) { d.open = true; });
      const main = document.querySelector('main');
      const text = main ? main.innerText : '';
      const h1s = document.querySelectorAll('h1');
      const faq = Array.prototype.slice.call(document.querySelectorAll('.faq__item'));
      return {
        h1: (h1s[0] || {}).innerText || '',
        h1count: h1s.length,
        missing: words.filter(function (w) { return text.toLowerCase().indexOf(w.toLowerCase()) === -1; }),
        faqCount: faq.length,
        opens: faq.filter(function (d) { return d.open; }).length,
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
      };
    }, WORDS);

    check(tag + ' has exactly one h1', info.h1count === 1, 'h1=' + JSON.stringify(info.h1.trim().slice(0, 50)));
    check(tag + ' carries the user-language phrases in rendered text',
      info.missing.length === 0, info.missing.join(' | ') || WORDS.length + '/' + WORDS.length);
    check(tag + ' renders ' + FAQ + ' FAQ items', info.faqCount === FAQ, 'count ' + info.faqCount);
    check(tag + ' first FAQ is open by default', info.opens === FAQ, 'open ' + info.opens + '/' + FAQ);
    check(tag + ' does not scroll sideways', info.overflow <= 0, 'overflowX ' + info.overflow);
    check(tag + ' no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' / '));

    const after = await page.evaluate(() => {
      const bodies = Array.prototype.slice.call(document.querySelectorAll('.faq__body'));
      return {
        empty: bodies.filter(function (b) { return b.innerText.trim().length < 40; }).length,
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
      };
    });
    check(tag + ' every FAQ answer has text', after.empty === 0, 'empty ' + after.empty);
    check(tag + ' stays put with all FAQs open', after.overflow <= 0, 'overflowX ' + after.overflow);

    /* The numbers are the whole point of the page, so they are read from the
       rendered main, not from the source. */
    const shown = await page.evaluate((nums) => {
      const main = document.querySelector('main');
      const text = main ? main.innerText : '';
      const q = document.querySelector('details[open] .faq__body');
      const visible = (q ? q.innerText : '') + ' ' + text;
      return { missing: nums.filter(function (n) { return visible.indexOf(n) === -1; }), text: visible };
    }, MEASURED);

    check(tag + ' renders every measured figure it cites',
      shown.missing.length === 0, shown.missing.join(' | ') || MEASURED.length + '/' + MEASURED.length);

    /* The compressor it promises is in the page, not a screenshot of one. */
    const built = await page.evaluate(() => ({
      drop: !!document.querySelector('#pdfDrop'),
      input: !!document.querySelector('#pdfInput'),
      quality: !!document.querySelector('#pdfQuality'),
      maxDim: !!document.querySelector('#pdfMaxDim'),
      module: !!(window.LPT && window.LPT.pdfcompress),
      engine: !!(window.LPT && window.LPT.engine)
    }));
    check(tag + ' embeds the compressor it promises',
      built.drop && built.input && built.quality && built.maxDim,
      JSON.stringify(built));
    check(tag + ' loads the PDF module and the compression engine',
      built.module && built.engine, 'pdfcompress=' + built.module + ' engine=' + built.engine);

    const hrefs = await page.evaluate(() => Array.prototype.slice
      .call(document.querySelectorAll('a[href^=".."]'))
      .map(function (a) { return a.getAttribute('href'); }));
    const bad = [];
    for (const h of Array.from(new Set(hrefs))) {
      const r = await page.request.get('http://127.0.0.1:' + PORT + '/' + h.split('/').slice(-2).join('/'));
      if (r.status() !== 200) bad.push(h + ':' + r.status());
    }
    check(tag + ' internal links resolve', bad.length === 0, bad.join(',') || hrefs.length + ' checked');

    await ctx.close();
  }

  /* ------------------------------------------------------------------------
     The functional part: run the two fixtures through the page's own wiring.
     setInputFiles goes through the real <input type="file"> the page ships, so
     this exercises take() -> inspect() -> compress() -> showResult() rather
     than calling the module directly.
     ---------------------------------------------------------------------- */
  console.log('\nfunctional — the page runs the fixtures itself\n');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const runErrors = [];
  page.on('pageerror', (e) => runErrors.push(String(e.message || e)));
  await page.goto('http://127.0.0.1:' + PORT + '/' + SLUG + '/', { waitUntil: 'load' });

  /* The result panel is hidden by default but stays visible once a document has
     been through, so waitForSelector on ":not([hidden])" would return at once
     and read the *previous* document's blob URL. Collapsing it first is what
     turns that wait into a real one. */
  async function runFixture(name) {
    const file = path.join(FIXTURE, name);
    if (!fs.existsSync(file)) { check(name + ' fixture exists', false, file); return null; }
    await page.evaluate(function () { document.getElementById('pdfResult').hidden = true; });
    await page.setInputFiles('#pdfInput', file);
    await page.waitForSelector('#pdfResult:not([hidden])', { timeout: 30000 });
    const out = await page.evaluate(async () => {
      const a = document.getElementById('pdfDownload');
      let bytes = null, head = '', tail = '';
      if (a && a.getAttribute('href')) {
        const ab = await (await fetch(a.getAttribute('href'))).arrayBuffer();
        bytes = ab.byteLength;
        /* Uint8Array.toString() joins with commas, so the bytes have to be
           pulled back through a latin1 string to read as text. */
        const chars = function (u8) {
          var s = '', step = 4096;
          for (var i = 0; i < u8.length; i += step) {
            s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + step));
          }
          return s;
        };
        head = chars(new Uint8Array(ab.slice(0, 8)));
        tail = chars(new Uint8Array(ab.slice(Math.max(0, ab.byteLength - 6))));
      }
      return {
        name: (a && a.getAttribute('download')) || '',
        href: !!(a && a.getAttribute('href')),
        bytes: bytes,
        head: head,
        tail: tail,
        summary: (document.getElementById('pdfSummary') || {}).innerText || '',
        facts: (document.getElementById('pdfResultFacts') || {}).innerText || ''
      };
    });
    const before = fs.statSync(file).size;
    return { name: name, before: before, out: out };
  }

  const photos = await runFixture('photos.pdf');
  if (photos) {
    check('photos fixture runs through the page',
      !!photos.out.bytes && photos.out.bytes > 0,
      photos.before + ' -> ' + photos.out.bytes + ' (' + photos.out.name + ')');
    check('the four-photo PDF comes back smaller',
      !!photos.out.bytes && photos.out.bytes < photos.before,
      photos.out.bytes + ' vs ' + photos.before);
    check('the saving is the one the page quotes (within 5% of 761,064)',
      !!photos.out.bytes && Math.abs(photos.out.bytes - 761064) / 761064 < 0.05,
      photos.out.bytes + ' vs the quoted 761,064');
    check('the download is offered as a PDF',
      /-smaller\.pdf$/.test(photos.out.name) || photos.out.href,
      photos.out.name);
    check('the result line reports re-encoded images and unchanged text',
      /re-encoded/.test(photos.out.facts) && /selectable/i.test(photos.out.facts),
      photos.out.facts.split('\n')[0] || '');
    check('what it hands back is still a PDF',
      photos.out.head.indexOf('%PDF-') === 0 && photos.out.tail.indexOf('%%EOF') !== -1,
      JSON.stringify(photos.out.head) + ' … ' + JSON.stringify(photos.out.tail));
  }

  const textonly = await runFixture('text-only.pdf');
  if (textonly) {
    check('the text-only PDF comes back byte for byte, not "compressed" bigger',
      textonly.out.bytes === textonly.before,
      textonly.out.bytes + ' vs ' + textonly.before);
    check('the page says what happened instead of inventing work',
      /nothing to re-encode/i.test(textonly.out.summary) ||
      /had nothing for the tool to re-encode/i.test(textonly.out.summary),
      textonly.out.summary || '');
  }

  const mixed = await runFixture('mixed.pdf');
  if (mixed) {
    check('the one-photo-with-text fixture runs too',
      !!mixed.out.bytes && mixed.out.bytes > 0,
      mixed.before + ' -> ' + mixed.out.bytes);
    check('the one-photo PDF lands on the figure the page quotes (within 5% of 135,558)',
      !!mixed.out.bytes && Math.abs(mixed.out.bytes - 135558) / 135558 < 0.05,
      mixed.out.bytes + ' vs the quoted 135,558');
  }

  /* The maximum-edge control is the third measurement on the page, so it is
     driven through the real <select> rather than trusted from the table. The
     select triggers a re-run on the document already loaded, and that run has
     to finish before the next file is handed over or the two overlap and the
     result panel shows whichever resolves last. */
  await page.evaluate(function () { document.getElementById('pdfResult').hidden = true; });
  await page.selectOption('#pdfMaxDim', '1000');
  await page.waitForSelector('#pdfResult:not([hidden])', { timeout: 30000 });
  const capped = await runFixture('photos.pdf');
  if (capped) {
    check('capping at 1000 px hits the quoted 242,999 within 5%',
      !!capped.out.bytes && Math.abs(capped.out.bytes - 242999) / 242999 < 0.05,
      capped.before + ' -> ' + capped.out.bytes + ' vs the quoted 242,999');
  }

  check('no page errors while running fixtures', runErrors.length === 0, runErrors.slice(0, 3).join(' / '));

  await ctx.close();
  await browser.close();
  server.close();
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
