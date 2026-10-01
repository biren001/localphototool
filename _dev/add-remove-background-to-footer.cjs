/* v63: add "Remove background" to the shared footer Tools column of every
   existing page. Two footer variants:
     - sub-pages: hrefs like "../metadata-editor/"
     - homepage : hrefs like "metadata-editor/"
   The item is appended right after the "Metadata editor" line, which the
   v61 pass put into every footer, so this is the only place an append lands
   consistently.
   Idempotent: re-running finds the link already present and changes nothing. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'localphototool');

const VARIANTS = [
  {
    name: 'sub-page',
    anchorRe: /([ \t]*)<li><a href="\.\.\/metadata-editor\/">Metadata editor<\/a><\/li>/,
    items: ['<li><a href="../remove-background/">Remove background</a></li>'],
    probe: '../remove-background/',
  },
  {
    name: 'homepage',
    anchorRe: /([ \t]*)<li><a href="metadata-editor\/">Metadata editor<\/a><\/li>/,
    items: ['<li><a href="remove-background/">Remove background</a></li>'],
    probe: 'remove-background/',
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

  const variant = VARIANTS.find((v) => v.anchorRe.test(html));
  if (!variant) { noFooter++; console.log(`  skip    ${rel}  (no shared footer anchor)`); continue; }

  if (html.slice(footerAt).includes(`href="${variant.probe}"`)) {
    already++; console.log(`  ok      ${rel}  [${variant.name}] already linked`); continue;
  }

  html = html.replace(variant.anchorRe, (m, indent) =>
    `${m}\n${indent}${variant.items.join(`\n${indent}`)}`);

  if (!html.slice(html.indexOf('<footer')).includes(`href="${variant.probe}"`)) {
    failed++; console.log(`  FAIL    ${rel}  [${variant.name}] anchor matched but link missing after edit`); continue;
  }

  const items = (html.slice(html.indexOf('<h2>Tools</h2>')).match(/<li>/g) || []).length;
  fs.writeFileSync(f, html);
  changed++;
  console.log(`  added   ${rel}  [${variant.name}] footer Tools items now ${items}`);
}

console.log(`\nchanged ${changed} | already present ${already} | no footer/anchor ${noFooter} | failed ${failed} | total ${files.length}`);
if (failed > 0) process.exit(1);
