#!/usr/bin/env node
/* One-off: hang /compress-pdf/ off the shared nav panel and the shared footer
 * of every page that carries them.
 *
 * The anchor is the whole "Compress images" line, verbatim, because the label
 * alone also turns up in body copy on /compress/ (it appears seven times there)
 * and the href alone misses the footer of pages that point their own entry
 * somewhere else. Subdirectory pages carry the anchor exactly twice — once in
 * the "All tools" panel, once in the footer Tools column — so the expected
 * count is a guard: anything else means the file moved under us and nothing is
 * written. The homepage has the same line unprefixed, twice.
 *
 * /stats/ is skipped on purpose: it has no nav panel and no Tools column, only
 * a one-line bottom bar, and it is never linked from anywhere.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'localphototool');
const SLUG = 'compress-pdf';
const LABEL = 'Shrink a PDF';

function eachPage(fn) {
  const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => n !== 'assets')
    .map((n) => path.join(ROOT, n));
  dirs.push(ROOT);
  dirs.forEach(function (dir) {
    const file = path.join(dir, 'index.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
    if (!/<footer/.test(html)) return;
    fn(path.relative(ROOT, file), html);
  });
}

function anchors(rel) {
  const prefix = rel.indexOf(path.sep) === -1 ? '' : '../';
  const out = [];
  ['Compress images', 'Compress an image'].forEach(function (label) {
    out.push({
      label: label,
      anchor: '          <li><a href="' + prefix + 'compress/">' + label + '</a></li>'
    });
  });
  /* Only the homepage form exists; every subdirectory page uses the ../ one. */
  if (prefix) out.length = 1;
  return out;
}

let changed = 0, skipped = 0, refused = 0;

eachPage(function (rel, html) {
  if (html.indexOf(SLUG) !== -1) { skipped++; return; }

  const prefix = rel.indexOf(path.sep) === -1 ? '' : '../';
  let next = html;
  let insertCount = 0;

  anchors(rel).forEach(function (a) {
    const hits = next.split(a.anchor).length - 1;
    if (hits === 0) { console.log('  no anchor for "' + a.label + '": ' + rel); return; }
    if (hits !== 2) {
      console.log('REFUSE ' + rel + ' — anchor "' + a.label + '" appears ' + hits + ' times, expected 2');
      refused++;
      return;
    }
    const line = '          <li><a href="' + prefix + SLUG + '/">' + LABEL + '</a></li>';
    next = next.split(a.anchor).join(a.anchor + '\n' + line);
    insertCount += hits;
  });

  if (!insertCount) { console.log('SKIP    nothing inserted: ' + rel); return; }
  fs.writeFileSync(path.join(ROOT, rel), next);
  console.log('OK        ' + rel + '   (' + insertCount + ' x)');
  changed++;
});

console.log('---');
console.log('changed:', changed, '| skipped:', skipped, '| refused:', refused);
process.exit(refused ? 1 : 0);
