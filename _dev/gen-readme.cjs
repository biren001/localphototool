#!/usr/bin/env node
/**
 * gen-readme.cjs — write README.md from the kit's `github-readme` copy block.
 *
 * The public repo's README and the `github-readme` block in
 * promo/distribution-kit.md are the same text. Editing them by hand is how two
 * copies quietly diverge, and the copy that is not covered by
 * check-listing-copy.cjs is the one that drifts. So the block is the source and
 * this script is the only thing that writes README.md.
 *
 * Run it after editing the block, then run check-listing-copy.cjs to confirm
 * the two still agree.
 *
 * Usage: node _dev/gen-readme.cjs
 */
const fs = require('fs');
const path = require('path');

const KIT = path.join(__dirname, '..', 'promo', 'distribution-kit.md');
const OUT = path.join(__dirname, '..', 'README.md');
const BLOCK = /^```copy\s+([^\n]*?)\s*$\n([\s\S]*?)^```\s*$/gm;

const md = fs.readFileSync(KIT, 'utf8');
let body = null;
for (const m of md.matchAll(BLOCK)) {
  if (/name=github-readme\b/.test(m[1])) { body = m[2]; break; }
}

if (body === null) {
  console.error(`FATAL  no "github-readme" copy block in ${KIT}`);
  process.exit(1);
}

if (!body.endsWith('\n')) body += '\n';

// Refuse to write a README that asserts a claim §2 retired. The length check
// lives in check-listing-copy.cjs; this one is here so the mistake cannot reach
// the file at all.
const BANNED = [
  /\bup to 90%/i,
  /25\s*[-–—]\s*50%\s*smaller/i,
  /unlimited (file )?size/i,
  /\blossless compress/i,
  /faster than tinypng/i,
];
for (const re of BANNED) {
  if (re.test(body)) {
    console.error(`FATAL  the block asserts a retired claim (${re}) — fix the block first`);
    process.exit(1);
  }
}

const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (before === body) {
  console.log(`unchanged  ${path.relative(path.join(__dirname, '..'), OUT)}  ${[...body].length} chars`);
} else {
  fs.writeFileSync(OUT, body, { encoding: 'utf8', newline: '' });
  const was = before === null ? 'created' : `rewritten (was ${[...before].length} chars)`;
  console.log(`${was}  ${path.relative(path.join(__dirname, '..'), OUT)}  ${[...body].length} chars`);
}
