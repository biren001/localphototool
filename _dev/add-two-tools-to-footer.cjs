/* Add "Compress to 500 KB" and "Remove GPS from photo" to the shared footer
   Tools column of every existing page.

   Two footer variants exist and both need the items:
     - sub-pages: hrefs like "../compress-to-200kb/"
     - homepage : hrefs like "compress-to-200kb/"
   "Compress to 500 KB" is inserted right after the 200 KB line (it reads as a
   series); "Remove GPS from photo" is appended at the end of the list.

   Idempotent: re-running finds the links already present and changes nothing. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'localphototool');

/* [anchorRe by variant, items to insert after the anchor] */
const VARIANTS = [
  {
    name: 'sub-page',
    anchorRe: /([ \t]*)<li><a href="\.\.\/compress-to-200kb\/">Compress to 200 KB<\/a><\/li>/,
    lastRe: /([ \t]*)<li><a href="\.\.\/compress-without-uploading\/">Compress without uploading<\/a><\/li>/,
    items: [
      '<li><a href="../compress-to-500kb/">Compress to 500 KB</a></li>',
    ],
    lastItems: [
      '<li><a href="../remove-gps-from-photo/">Remove GPS from photo</a></li>',
    ],
    probe: '../compress-to-500kb/',
  },
  {
    name: 'homepage',
    anchorRe: /([ \t]*)<li><a href="compress-to-200kb\/">Compress to 200 KB<\/a><\/li>/,
    lastRe: /([ \t]*)<li><a href="image-compressor-upload-test\/">Image compressor upload test<\/a><\/li>/,
    items: [
      '<li><a href="compress-to-500kb/">Compress to 500 KB</a></li>',
    ],
    lastItems: [
      '<li><a href="remove-gps-from-photo/">Remove GPS from photo</a></li>',
    ],
    probe: 'compress-to-500kb/',
  },
];

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const files = htmlFiles(ROOT).sort();
let changed = 0, already = 0, noFooter = 0, failed = 0;

for (const f of files) {
  const rel = '/' + path.relative(ROOT, f).replace(/\\/g, '/');
  let html = fs.readFileSync(f, 'utf8');
  const footerAt = html.indexOf('<footer');
  if (footerAt === -1) { noFooter++; console.log(`  skip    ${rel}  (no footer)`); continue; }

  const variant = VARIANTS.find((v) => v.anchorRe.test(html) || v.lastRe.test(html));
  if (!variant) { noFooter++; console.log(`  skip    ${rel}  (no shared footer Tools column)`); continue; }

  if (html.slice(footerAt).includes(`href="${variant.probe}"`)) {
    already++; console.log(`  ok      ${rel}  [${variant.name}] already linked`); continue;
  }

  let touched = false;
  if (variant.anchorRe.test(html)) {
    html = html.replace(variant.anchorRe, (m, indent) =>
      `${m}\n${indent}${variant.items.join(`\n${indent}`)}`);
    touched = true;
  }
  if (variant.lastRe.test(html)) {
    html = html.replace(variant.lastRe, (m, indent) =>
      `${m}\n${indent}${variant.lastItems.join(`\n${indent}`)}`);
    touched = true;
  }
  if (!touched || !html.slice(html.indexOf('<footer')).includes(`href="${variant.probe}"`)) {
    failed++; console.log(`  FAIL    ${rel}  [${variant.name}] anchors matched but link missing after edit`); continue;
  }

  const items = (html.slice(html.indexOf('<h2>Tools</h2>')).match(/<li>/g) || []).length;
  fs.writeFileSync(f, html);
  changed++;
  console.log(`  added   ${rel}  [${variant.name}] footer Tools items now ${items}`);
}

console.log(`\nchanged ${changed} | already present ${already} | no footer ${noFooter} | failed ${failed} | total ${files.length}`);
if (failed > 0) process.exit(1);
