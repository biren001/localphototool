#!/usr/bin/env node
/* Add the /transfer/ link to the footer Tools column of every page that
 * carries the shared footer. Idempotent; handles both footer variants:
 *   - subdirectory pages use href="../transfer/"
 *   - the homepage uses href="transfer/"
 * The new page (transfer/index.html) ships with the link already in place.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'localphototool');
const PAGES = ['', 'compress/', 'heic-to-jpg/', 'compress-to-100kb/', 'compress-to-50kb/',
  'compress-to-200kb/', 'compress-to-500kb/', 'remove-gps-from-photo/',
  'compress-photos-for-email/', 'compress-without-uploading/', 'image-compressor-upload-test/',
  'png-to-jpg/', 'jpg-to-webp/', 'share/', 'about/', 'privacy/', 'terms/'];

const LABEL = 'Transfer phone to PC';
let changed = 0, skipped = 0, failed = 0;

PAGES.forEach(function (dir) {
  const file = path.join(ROOT, dir, 'index.html');
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch (e) { console.log('FAIL  read', file); failed++; return; }

  const prefix = dir ? '../' : '';
  const li = '<li><a href="' + prefix + 'transfer/">' + LABEL + '</a></li>';

  if (html.indexOf('href="' + prefix + 'transfer/"') !== -1) { skipped++; return; }

  // Insert after the last existing Tools item: the footer Tools column ends
  // with the remove-gps link in both variants (label identical everywhere).
  const anchor = dir
    ? '<li><a href="../remove-gps-from-photo/">Remove GPS from photo</a></li>'
    : '<li><a href="remove-gps-from-photo/">Remove GPS from photo</a></li>';
  const idx = html.indexOf(anchor);
  if (idx === -1) { console.log('FAIL  anchor not found:', file); failed++; return; }
  const at = idx + anchor.length;
  html = html.slice(0, at) + '\n          ' + li + html.slice(at);

  fs.writeFileSync(file, html);
  console.log('OK    ', path.join(dir, 'index.html'));
  changed++;
});

console.log('---');
console.log('changed:', changed, '| skipped (already present):', skipped, '| failed:', failed);
process.exit(failed ? 1 : 0);
