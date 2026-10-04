#!/usr/bin/env node
/* One-off: hang /why-my-image-wont-get-smaller/ off the shared nav panel and
 * the shared footer of every page that carries them.
 *
 * Both blocks end with the "Compress without uploading" entry, so that line is
 * the anchor. On a subdirectory page it appears exactly twice — once in the nav
 * "All tools" panel, once in the footer — so the first hit is the nav and the
 * second is the footer. The homepage has only the footer, unprefixed.
 *
 * Idempotent: any page already carrying the slug is left alone.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'localphototool');
const SLUG = 'why-my-image-wont-get-smaller';

function eachPage(fn) {
  const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => !/^(assets|api|assets-bucket)$/.test(n))
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

/* The nav panel of /reduce-image-size/ points its own "no upload" entry at
   ../reduce-image-size/ rather than the real target, so the two blocks are not
   always byte-identical. Matching on the label alone would miss it, and matching
   on the link alone would miss the footer of that one page — so the anchor is
   the whole line and the panel is matched case by its own href. */
function anchorFor(rel) {
  const prefix = rel.indexOf(path.sep) === -1 ? '' : '../';
  if (prefix && rel.indexOf('reduce-image-size' + path.sep + 'index.html') !== -1) {
    return '          <li><a href="../reduce-image-size/">Compress without uploading</a></li>';
  }
  if (!prefix) return '          <li><a href="compress-without-uploading/">Compress without uploading</a></li>';
  return '          <li><a href="../compress-without-uploading/">Compress without uploading</a></li>';
}

function li(rel) {
  const prefix = rel.indexOf(path.sep) === -1 ? '' : '../';
  return '          <li><a href="' + prefix + SLUG + '/">Why images won\'t get smaller</a></li>';
}

let changed = 0, skipped = 0, failed = 0;

eachPage(function (rel, html) {
  if (html.indexOf(SLUG) !== -1) { skipped++; return; }

  /* Every occurrence gets the entry: the nav "All tools" panel and the footer
     are both anchored on the same line, and /stats/ has no such line at all.
     The homepage writes both unprefixed, so its count is 2 and the result is
     the same. split().join() — String.replace with $ in the subject is not
     involved, but the form below is the one that inserts after *all* hits. */
  const hits = html.split(anchorFor(rel)).length - 1;
  if (hits === 0) { console.log('SKIP    no such anchor: ' + rel); return; }

  html = html.split(anchorFor(rel)).join(anchorFor(rel) + '\n' + li(rel));
  fs.writeFileSync(path.join(ROOT, rel), html);
  console.log('OK        ' + rel + '   (' + hits + ' x)');
  changed++;
});

console.log('---');
console.log('changed:', changed, '| skipped:', skipped, '| failed:', failed);
process.exit(failed ? 1 : 0);
