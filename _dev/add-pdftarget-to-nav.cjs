#!/usr/bin/env node
/* One-off: hang /compress-pdf-to-100kb/ off the shared nav panel and the shared
 * footer of every page that carries them.
 *
 * Same shape as add-merge-pdf-to-nav.cjs, and for the same reason: the anchor
 * is the whole "Shrink a PDF" line, verbatim, because the label alone also
 * turns up in body copy and the href alone misses the footer of pages that
 * point their own entry somewhere else. Subdirectory pages carry the anchor
 * exactly twice — once in the "All tools" panel, once in the footer Tools
 * column — and the homepage does too, so the expected count is a guard:
 * anything else means the file moved under us and nothing is written.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'localphototool');
const SLUG = 'compress-pdf-to-100kb';
const LABEL = 'Compress a PDF to 100 KB';

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

eachPage(function (rel, html) {
  if (html.indexOf(SLUG) !== -1) return;

  const prefix = rel.indexOf(path.sep) === -1 ? '' : '../';
  const anchor = '          <li><a href="' + prefix + 'compress-pdf/">Shrink a PDF</a></li>';
  const hits = html.split(anchor).length - 1;
  if (hits === 0) { console.log('  no anchor to hang it on: ' + rel); return; }
  if (hits !== 2) {
    console.log('REFUSE ' + rel + ' — the anchor appears ' + hits + ' times, expected 2');
    return;
  }
  const line = '          <li><a href="' + prefix + SLUG + '/">' + LABEL + '</a></li>';
  fs.writeFileSync(path.join(ROOT, rel), html.split(anchor).join(anchor + '\n' + line));
  console.log('OK      ' + rel + '   (2 x)');
});
