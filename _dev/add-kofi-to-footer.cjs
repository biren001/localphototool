/* Add the Ko-fi support link to the footer "about" column of every page.

   The link is variant-independent: it lives in footer__about, whose closing
   paragraph ("never uploaded, never stored.") is identical on the homepage and
   on every sub-page, so one anchor covers both footer variants.

   A plain external <a rel="noopener"> only — no scripts, no images, no third
   party anything, per the site's standing constraints.

   Idempotent: re-running finds the link already present and changes nothing. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'localphototool');
const ANCHOR = 'never uploaded, never stored.</p>';
const LINK = '\n        <p>Free, and free to run — if it saved you time, <a href="https://ko-fi.com/localphototool" rel="noopener">support it on Ko-fi</a>.</p>';

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const files = htmlFiles(ROOT).sort();
let changed = 0, already = 0, noAnchor = 0, failed = 0;

for (const f of files) {
  const rel = '/' + path.relative(ROOT, f).replace(/\\/g, '/');
  let html = fs.readFileSync(f, 'utf8');

  if (html.indexOf('ko-fi.com/localphototool') !== -1) {
    already++; console.log(`  ok      ${rel}  already linked`); continue;
  }
  const at = html.indexOf(ANCHOR);
  if (at === -1) { noAnchor++; console.log(`  skip    ${rel}  (no footer about paragraph)`); continue; }

  html = html.slice(0, at + ANCHOR.length) + LINK + html.slice(at + ANCHOR.length);
  if (html.indexOf('ko-fi.com/localphototool') === -1) {
    failed++; console.log(`  FAIL    ${rel}  anchor matched but link missing after edit`); continue;
  }
  fs.writeFileSync(f, html);
  changed++;
  console.log(`  added   ${rel}`);
}

console.log(`\nchanged ${changed} | already present ${already} | no anchor ${noAnchor} | failed ${failed} | total ${files.length}`);
if (failed > 0) process.exit(1);
