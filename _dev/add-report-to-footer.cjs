/* Add the upload-test report to the shared footer Tools column.

   The footer Tools list is the site's main internal-link source. The report
   page was missing from it, so it was only reachable from the homepage and
   /compress-without-uploading/.

   Two footer variants exist and both need the item:
     - sub-pages: hrefs like "../compress/", last item is "PNG optimizer"
     - homepage : hrefs like "compress/",   last item is "Compress without uploading"
   The item is appended at the end of the list in both cases.

   Idempotent: re-running finds the item already present and changes nothing. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'localphototool');

const VARIANTS = [
  {
    name: 'sub-page',
    re: /([ \t]*)<li><a href="\.\.\/compress\/">PNG optimizer<\/a><\/li>/,
    item: '<li><a href="../image-compressor-upload-test/">Image compressor upload test</a></li>',
    href: '../image-compressor-upload-test/',
  },
  {
    name: 'homepage',
    re: /([ \t]*)<li><a href="compress-without-uploading\/">Compress without uploading<\/a><\/li>/,
    item: '<li><a href="image-compressor-upload-test/">Image compressor upload test</a></li>',
    href: 'image-compressor-upload-test/',
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
let changed = 0;
let already = 0;
let noFooter = 0;
let failed = 0;

for (const f of files) {
  const rel = '/' + path.relative(ROOT, f).replace(/\\/g, '/');
  const html = fs.readFileSync(f, 'utf8');
  const footerAt = html.indexOf('<footer');
  const footer = footerAt === -1 ? '' : html.slice(footerAt);

  const variant = VARIANTS.find((v) => v.re.test(html));
  if (!variant) {
    noFooter++;
    console.log(`  skip    ${rel}  (no shared footer Tools column)`);
    continue;
  }

  if (footer.includes(`href="${variant.href}"`)) {
    already++;
    console.log(`  ok      ${rel}  [${variant.name}] already linked`);
    continue;
  }

  const next = html.replace(variant.re, (m, indent) => `${m}\n${indent}${variant.item}`);
  if (next === html) {
    failed++;
    console.log(`  FAIL    ${rel}  [${variant.name}] anchor matched but nothing changed`);
    continue;
  }

  const items = (next.slice(next.indexOf('<h2>Tools</h2>')).match(/<li>/g) || []).length;
  fs.writeFileSync(f, next);
  changed++;
  console.log(`  added   ${rel}  [${variant.name}] footer Tools items now ${items}`);
}

console.log(
  `\nchanged ${changed} | already present ${already} | no footer ${noFooter} | failed ${failed} | total ${files.length}`
);
