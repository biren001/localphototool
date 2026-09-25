// verify-ban-guard.cjs — prove the site-wide banned-claim check is not a no-op.
//
// The kit's anchor guard once ran for months without ever reaching the code it
// guarded, and it only announced itself on the run where the earlier token check
// finally passed. "The guard passed" is therefore not evidence that the guard
// checks anything. This reproduces the failing case on purpose: it plants the
// retired claim back into the homepage, runs the real checker as a child
// process, and requires a failure that names the file and line. The original
// bytes are restored in a finally block either way.
//
//     node _dev/verify-ban-guard.cjs
//
// Deliberately NOT in run-all.sh: it writes to a site source file, and the
// automated suite must never do that. Run it after changing BANNED, or after
// changing how the site scan walks files.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'localphototool', 'index.html');
const CHECKER = path.join(ROOT, '_dev', 'check-listing-copy.cjs');

// The tail of the current, correct description. Planting the claim here puts it
// inside the exact tag every scraper reads, which is where it did its damage.
const MARKER = 'strip EXIF and GPS. No uploads.';
const PLANTED = 'up to 90% smaller. No uploads.';

function runChecker() {
  try {
    return { failed: false, out: execFileSync(process.execPath, [CHECKER], { encoding: 'utf8', cwd: ROOT }) };
  } catch (e) {
    return { failed: true, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const before = fs.readFileSync(TARGET, 'utf8');
if (!before.includes(MARKER)) {
  console.error('ABORT  the expected description is not in index.html — refusing to guess at a marker');
  process.exit(2);
}

// Baseline first: if the checker already fails on the clean tree, the planted
// run proves nothing, so report that instead of a false pass.
const baseline = runChecker();
if (baseline.failed) {
  console.error('ABORT  the checker already fails on the unmodified tree:');
  console.error(baseline.out.trim().split('\n').slice(-6).join('\n'));
  process.exit(2);
}

let planted;
try {
  fs.writeFileSync(TARGET, before.replace(MARKER, PLANTED), 'utf8');
  planted = runChecker();
} finally {
  fs.writeFileSync(TARGET, before, 'utf8');
}

const restored = fs.readFileSync(TARGET, 'utf8') === before;
const failLine = planted.out.split('\n').find((l) => /FAIL/.test(l) && /retired claim/.test(l)) || '';
const namesLocation = /\blocalphototool[\\/]index\.html:\d+/.test(planted.out);

console.log('--- baseline (clean tree) ---');
console.log(`the clean tree passes                  : ${baseline.failed ? 'NO' : 'YES'}`);
console.log('--- with the claim planted back in ---');
console.log(failLine.trim() || '(no matching FAIL line)');
console.log('\n--- verdict ---');
console.log(`the checker fails on the planted claim : ${planted.failed ? 'YES' : 'NO  <-- the guard is not working'}`);
console.log(`the failure names file:line            : ${namesLocation ? 'YES' : 'NO'}`);
console.log(`index.html restored byte-for-byte      : ${restored ? 'YES' : 'NO  <-- restore this file now'}`);
process.exit(planted.failed && namesLocation && restored ? 0 : 1);
