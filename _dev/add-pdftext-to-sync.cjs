#!/usr/bin/env node
/* One-off: register /why-cant-i-select-the-text-in-this-pdf/ everywhere the
 * site keeps a list of pages.
 *
 * Every patch carries its anchor's expected hit count and refuses to write if
 * the anchor is missing or the file has drifted, and the checks afterwards read
 * the written file back rather than trusting the write. The page itself was
 * written by hand and already carries its own footer entry and nav link, so it
 * is skipped by the page loop.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.join(__dirname, '..');
const ROOT = path.join(WS, 'localphototool');
const SLUG = 'why-cant-i-select-the-text-in-this-pdf';
const LABEL = "Why PDF text won't select";

let refused = 0;

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

/* anchor -> insertion, expected hits. The insertion is appended after the
 * anchor each time it is found. */
function patch(rel, edits, opts) {
  const file = path.join(opts.root, rel);
  let html = fs.readFileSync(file, 'utf8');
  if (opts.skip && opts.skip(html)) return 'skip';
  let total = 0;
  for (const edit of edits) {
    const hits = count(html, edit.anchor);
    if (hits !== edit.expect) {
      console.log('REFUSE ' + rel + ' — anchor "' + edit.name + '" hit ' + hits + ', expected ' + edit.expect);
      refused++;
      return 'refused';
    }
    if (edit.expect > 1) {
      /* More than one file's worth of hits: the same edit goes after each. */
      html = html.split(edit.anchor).join(edit.anchor + '\n' + edit.insert);
    } else {
      html = html.replace(edit.anchor, edit.anchor + '\n' + edit.insert);
    }
    total += edit.expect;
  }
  fs.writeFileSync(file, html);
  console.log('OK      ' + rel + '   (' + total + ' x)');
  return 'ok';
}

/* ---------- 1. every page: the nav panel and the footer Tools column ---------- */

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

let pageChanges = 0;
eachPage(function (rel, html) {
  if (html.indexOf(SLUG) !== -1) return;      /* the new page, already written */
  const prefix = rel.indexOf(path.sep) === -1 ? '' : '../';
  const anchor = '          <li><a href="' + prefix + 'compress-pdf/">Shrink a PDF</a></li>';
  if (count(html, anchor) !== 2) {
    console.log('REFUSE ' + rel + ' — "Shrink a PDF" anchor hit ' + count(html, anchor) + ', expected 2');
    refused++;
    return;
  }
  const insert = '          <li><a href="' + prefix + SLUG + '/">' + LABEL + '</a></li>';
  patch(rel, [{ name: 'nav/footer', anchor: anchor, insert: insert, expect: 2 }], {
    root: ROOT,
    skip: function (h) { return count(h, SLUG) > 0; }
  });
  pageChanges++;
});

/* ---------- 2. the rest of the lists ---------- */

const listPatches = [
  ['sitemap.xml', [
    {
      name: 'sitemap url', expect: 1,
      anchor: '    <loc>https://localphototool.com/compress-pdf-to-100kb/</loc>',
      insert: '  <url>\n    <loc>https://localphototool.com/' + SLUG + '/</loc>\n    <lastmod>2026-10-04</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>'
    }
  ], { root: ROOT }],

  ['sw.js', [
    {
      name: 'sw SHELL', expect: 1,
      anchor: '  \'compress-pdf-to-100kb/\', /* hit an exact KB limit on a PDF, keeping the text, v84 */',
      insert: '  \'' + SLUG + '/\', /* say why a page has no selectable text, page by page, v85 */'
    }
  ], { root: ROOT }],

  ['llms.txt', [
    {
      name: 'llms bullet', expect: 1,
      anchor: '- [Merge PDF files](https://localphototool.com/merge-pdf/):',
      insert: '- [Why the text will not select in a PDF](https://localphototool.com/' + SLUG + '/): names the cause before it offers any words — a page that is a picture rather than text, words packed into compressed object streams, a subset font with no character map, an encryption dictionary, or a damaged structure; the check runs in the browser with no upload and deliberately does not run OCR (measured: 2,432 characters on page 1 and 76 on page 2 of a two-page test document, 603 on a text-only page, 6 on each of four photo pages — every count matched an independent reader).'
    }
  ], { root: ROOT }],

  ['../_dev/test-pages.cjs', [
    {
      name: 'PAGES', expect: 1,
      anchor: "  'compress-pdf-to-100kb/index.html',",
      insert: "  '" + SLUG + "/index.html',"
    },
    {
      name: 'PUBLIC', expect: 1,
      anchor: "'merge-pdf/', 'compress-pdf-to-100kb/', 'heic-to-jpg/', 'watermark/',",
      insert: "'merge-pdf/', 'compress-pdf-to-100kb/', '" + SLUG + "/', 'heic-to-jpg/', 'watermark/',"
    },
    {
      name: 'shell cache', expect: 1,
      anchor: "'merge-pdf/', 'compress-pdf-to-100kb/', 'heic-to-jpg/', 'resize-image/', 'exif-viewer/', 'share/', 'about/',",
      insert: "'merge-pdf/', 'compress-pdf-to-100kb/', '" + SLUG + "/', 'heic-to-jpg/', 'resize-image/', 'exif-viewer/', 'share/', 'about/',"
    }
  ], { root: ROOT }],

  ['../_dev/sync-faq-schema.py', [
    {
      name: 'faq pages', expect: 1,
      anchor: '"compress-pdf-to-100kb/index.html"]',
      insert: '"compress-pdf-to-100kb/index.html",\n    "' + SLUG + '/index.html"]'
    }
  ], { root: ROOT }],

  ['../_dev/audit-overflow.cjs', [
    {
      name: 'overflow pages', expect: 1,
      anchor: "'/merge-pdf/', '/compress-pdf-to-100kb/',",
      insert: "'/merge-pdf/', '/compress-pdf-to-100kb/', '/" + SLUG + "/',"
    }
  ], { root: ROOT }],

  ['../_dev/package-zip.py', [
    {
      name: 'package must', expect: 1,
      anchor: '"compress-pdf-to-100kb/index.html",',
      insert: '"compress-pdf-to-100kb/index.html",\n    "' + SLUG + '/index.html",'
    }
  ], { root: ROOT }]
];

listPatches.forEach(function (p) { patch(p[0], p[1], p[2]); });

/* ---------- 3. read the written files back before reporting ---------- */

console.log('---');
console.log('pages changed:', pageChanges, '| refused:', refused);

let missing = 0;
const probes = [
  [path.join(ROOT, 'sitemap.xml'), '/' + SLUG + '/</loc>'],
  [path.join(ROOT, 'sw.js'), "'" + SLUG + "/'"],
  [path.join(ROOT, 'llms.txt'), SLUG],
  [path.join(WS, '_dev', 'test-pages.cjs'), SLUG],
  [path.join(WS, '_dev', 'sync-faq-schema.py'), SLUG],
  [path.join(WS, '_dev', 'audit-overflow.cjs'), SLUG],
  [path.join(WS, '_dev', 'package-zip.py'), SLUG],
  [path.join(ROOT, SLUG, 'index.html'), SLUG],
  [path.join(ROOT, 'compress-pdf/index.html'), SLUG + '/']
];
probes.forEach(function (p) {
  const ok = fs.readFileSync(p[0], 'utf8').indexOf(p[1]) !== -1;
  if (!ok) { missing++; console.log('MISSING  ' + path.relative(WS, p[0]) + '  (' + p[1] + ')'); }
});
console.log('read-back: ' + (probes.length - missing) + '/' + probes.length + ' contain the slug');
console.log('refused: ' + refused + ', missing: ' + missing);
process.exit(refused || missing ? 1 : 0);
