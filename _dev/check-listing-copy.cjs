#!/usr/bin/env node
/**
 * check-listing-copy.cjs — the distribution kit's copy is machine-checked.
 *
 * promo/distribution-kit.md holds the only copy of every listing string. Each
 * one lives in a fenced block tagged with its platform's character limit:
 *
 *     ```copy name=tagline limit=60
 *     ...the copy...
 *     ```
 *
 * Submitting a 62-character tagline to Product Hunt (limit 60) gets truncated
 * silently, and a truncated tagline is the first and often only thing a
 * directory visitor reads. So the limit is enforced here rather than trusted.
 *
 * Also enforces §2 of the kit: the retired claims must not reappear in any
 * copy block. Those were measured false (see _dev/measured/), and a listing is
 * exactly where they would do damage, because they cannot be corrected after
 * the fact.
 *
 * A block may carry the `refutes` flag, which permits it to quote a banned
 * claim — but only inside a refutation. The flag alone is not enough: a block
 * tagged `refutes` must also contain an explicit correction, so the flag
 * cannot be used to smuggle a claim back onto a listing page.
 *
 * Usage: node _dev/check-listing-copy.cjs
 */
const fs = require('fs');
const path = require('path');

const KIT = path.join(__dirname, '..', 'promo', 'distribution-kit.md');

// Blocks that must exist. Missing one means a channel lost its copy.
const REQUIRED = [
  'tagline', 'short', 'medium', 'long',
  'hn-title', 'hn-body', 'x-post',
  'reddit-sideproject-title', 'reddit-sideproject-body',
  'reddit-iib-title', 'reddit-privacy-title', 'reddit-privacy-body',
  'pr-body',
  'github-readme',
];

// Claims retired after measurement contradicted them (kit §2).
const BANNED = [
  { re: /\bup to 90%/i, why: 'only true for PNG screenshots, not photos' },
  { re: /25\s*[-–—]\s*50%\s*smaller/i, why: 'measured false at equal PSNR — WebP was 24% larger than MozJPEG' },
  { re: /unlimited (file )?size/i, why: 'real limit is ~80 megapixels of device memory' },
  { re: /\blossless compress/i, why: 'Auto mode is lossy with a fidelity floor' },
  { re: /faster than tinypng/i, why: 'never benchmarked against them' },
];

// How a refutation has to read. A block may only quote a banned claim when one
// of these appears next to it.
const REFUTATION = /(did not hold up|did ?n[o']?t hold|measured false|comes? out .{0,20}larger|came out .{0,20}larger|does not hold|is false|about 24% *larger|~?24% *larger|against baseline)/i;

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log(`  PASS  ${m}${d ? '  ' + d : ''}`); };
const no = (m, d = '') => { fail++; console.log(`  FAIL  ${m}${d ? '  ' + d : ''}`); };

if (!fs.existsSync(KIT)) {
  console.error(`FATAL  ${KIT} not found`);
  process.exit(1);
}
const md = fs.readFileSync(KIT, 'utf8');

// ```copy name=<id> limit=<n> [refutes]\n<body>\n```
const BLOCK = /^```copy\s+([^\n]*?)\s*$\n([\s\S]*?)^```\s*$/gm;

const found = new Map();
for (const m of md.matchAll(BLOCK)) {
  const attrs = m[1];
  const name = (attrs.match(/name=([a-z0-9-]+)/) || [])[1];
  const limit = Number((attrs.match(/limit=(\d+)/) || [])[1]);
  if (!name || !Number.isFinite(limit)) continue;
  found.set(name, {
    limit,
    refutes: /\brefutes\b/.test(attrs),
    body: m[2].replace(/\n$/, ''),
  });
}

if (found.size === 0) {
  no('the kit contains parseable copy blocks', 'zero matched — did the fence format change?');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`Copy limits — ${path.relative(path.join(__dirname, '..'), KIT)}\n`);

// --- length, per block -------------------------------------------------------
let longestOver = null;
for (const [name, { limit, body }] of found) {
  const len = [...body].length; // code points, so em dashes and curly quotes count once
  const lines = body.split('\n').length;
  const where = lines > 1 ? `, ${lines} lines` : '';
  if (len === 0) {
    no(`${name} is non-empty`);
  } else if (len > limit) {
    no(`${name} fits ${limit} chars`, `${len} chars — over by ${len - limit}${where}`);
    if (!longestOver || len - limit > longestOver.over) longestOver = { name, over: len - limit };
  } else {
    ok(`${name} fits ${limit} chars`, `${len} chars (${limit - len} spare${where})`);
  }
}

// --- every channel still has its copy ---------------------------------------
for (const name of REQUIRED) {
  if (!found.has(name)) no(`required block "${name}" exists`);
}
const present = REQUIRED.filter((n) => found.has(n)).length;
if (present === REQUIRED.length) ok(`all ${REQUIRED.length} required blocks are present`);
else no(`all ${REQUIRED.length} required blocks are present`, `${present}/${REQUIRED.length}`);

// --- retired claims must not have crept back in ------------------------------
for (const { re, why } of BANNED) {
  const offenders = [];
  for (const [name, v] of found) {
    if (!re.test(v.body)) continue;
    // Quoting a claim to refute it is the whole point of hn-body and the
    // build-story post. Allow it, but require the refutation to be present.
    if (v.refutes && REFUTATION.test(v.body)) continue;
    offenders.push(v.refutes ? `${name} (tagged refutes but no correction found)` : name);
  }
  offenders.length === 0
    ? ok(`banned claim ${re} is not asserted`, why)
    : no(`banned claim ${re} is not asserted`, `found in: ${offenders.join(', ')} — ${why}`);
}

// --- the same ban, applied to the site itself --------------------------------
/* The kit was guarded and the site was not, and that asymmetry is exactly how a
   retired claim survived: the homepage <meta name="description"> went on saying
   "up to 90%" long after §2 retired it, because every check looked at the kit
   and no check looked at the site. It was still there when the Tiny Startups
   wizard scraped the page, filled its tagline field from that tag, and handed
   the retired sentence back to be published — a listing is the one place a claim
   cannot be corrected afterwards, and it is reached by reading the meta
   description. So the meta description is what has to be checked.
   Body copy is scanned too: the same sentence in a paragraph travels the same
   way, and the scan is cheap.
   Refutations are still allowed, but judged on the sentence around each match
   rather than on the whole file, so one legitimate refutation cannot license a
   violation further down the same page. */
const SITE_DIR = path.join(__dirname, '..', 'localphototool');

function siteFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...siteFiles(p));
    else if (/\.(html|txt)$/.test(e.name)) out.push(p);
  }
  return out;
}

const ROOT = path.join(__dirname, '..');
const scanned = siteFiles(SITE_DIR);
const siteOffenders = [];
for (const file of scanned) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const { re, why } of BANNED) {
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(rx)) {
      const around = text.slice(Math.max(0, m.index - 400), m.index + 400);
      if (REFUTATION.test(around)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      siteOffenders.push(`${rel}:${line} "${m[0]}" — ${why}`);
    }
  }
}
siteOffenders.length === 0
  ? ok('no retired claim appears under localphototool/', `${scanned.length} files scanned`)
  : no('no retired claim appears under localphototool/', siteOffenders.join(' | '));

// Reverse-check the scanner: it must fail on a planted claim, or it is only
// "looking like it checks". Written against a string rather than a file so the
// site tree is never touched.
{
  const planted = '<meta name="description" content="Shrink your photos up to 90% for free.">';
  const caught = BANNED.some(({ re }) => new RegExp(re.source, re.flags).test(planted));
  const refutationHolds = REFUTATION.test(
    'The widely quoted "up to 90%" is false for photographs; the measured range is 24–54%.',
  );
  caught && refutationHolds
    ? ok('the site scanner catches a planted claim and spares a refutation')
    : no('the site scanner catches a planted claim and spares a refutation', `caught=${caught} refutation=${refutationHolds}`);
}

// A block tagged `refutes` must actually refute something.
const refuters = [...found.entries()].filter(([, v]) => v.refutes);
for (const [name, v] of refuters) {
  REFUTATION.test(v.body)
    ? ok(`${name} was flagged "refutes" and does correct the record`)
    : no(`${name} was flagged "refutes" and does correct the record`, 'no correction sentence found — remove the flag or add it');
}

// --- the kit must cite the measurement, not assert numbers bare --------------
const MEASURED = ['24–54%', '41–68%', '40 dB', '26%'];
const missingFacts = MEASURED.filter((f) => !md.includes(f));
missingFacts.length === 0
  ? ok('the kit quotes the measured figures', MEASURED.join(' · '))
  : no('the kit quotes the measured figures', `missing: ${missingFacts.join(', ')}`);

// --- the tracker has to be actionable ----------------------------------------
/* Count the channel names in §6, not "rows whose last three cells are empty".
   That shape stops matching the moment a row is filled in, so the count
   under-reported as soon as the table was used (it read 10 for a 14-row table),
   and it was satisfied by empty rows anywhere in the file rather than by the
   tracker it claims to check. */
/* The section itself is the whole match here — there is no capture group, so
   it is [0] and not [1]. Reading [1] gave undefined and crashed the script. */
const tracker = (md.match(/^##\s*6\.\s*Tracking[\s\S]*$/m) || [''])[0];
const trackerRows = tracker.split('\n')
  .filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l))
  .map((l) => l.split('|')[1].trim())
  .filter((name) => name && name !== 'Channel');
trackerRows.length >= 5
  ? ok('the tracking table has rows ready to fill in', `${trackerRows.length} channels`)
  : no('the tracking table has rows ready to fill in', `only ${trackerRows.length}`);

// --- the pasted README must be the block, not a copy of it -------------------
/* README.md at the repository root is what the public repo shows. It is a
   second copy of the same text, which means it can silently drift away from
   the copy that the length and retired-claim checks actually cover. So it is
   compared byte for byte against the block; edit the kit, regenerate this. */
const README = path.join(__dirname, '..', 'README.md');
const readmeBlock = found.get('github-readme');
const readmeCheck = 'README.md matches the kit block';
if (!readmeBlock) {
  no(readmeCheck, 'no github-readme block to compare against');
} else if (!fs.existsSync(README)) {
  no(readmeCheck, 'file missing — copy the block into README.md at the repository root');
} else {
  const pasted = fs.readFileSync(README, 'utf8').replace(/\n$/, '');
  pasted === readmeBlock.body
    ? ok(readmeCheck, `byte-identical, ${[...pasted].length} chars`)
    : no(readmeCheck, 'drifted from the block — edit the kit, then regenerate README.md');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (longestOver) console.log(`Closest to a limit: ${longestOver.name}, ${longestOver.over} over.`);
process.exit(fail ? 1 : 0);
