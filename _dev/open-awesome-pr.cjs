#!/usr/bin/env node
/**
 * open-awesome-pr.cjs — the one pull request worth opening, done by machine.
 *
 * awesome-privacy is the only list left that is open to us: free-for-dev
 * excludes format converters by name, and awesome-selfhosted's CONTRIBUTING
 * forbids an agent opening a PR for a user. Its own rules are a privacy policy,
 * no tracking and open source, all of which we meet, and it says nothing about
 * who opens the pull request.
 *
 * Where the entry goes is not obvious and was got wrong once. The obvious
 * heading match is `### Images`, which sits under `## Cloaking` and holds
 * Fawkes and ImageScrubber — cloaking tools. The right home is
 * `## Photo Editing and Management` -> `#### Web`, which holds miniPaint and
 * makes the same no-upload promise we do. That section's Android list already
 * carries a compressor (ImagePipe), so the fit is precedent, not argument.
 *
 * Wording comes only from promo/distribution-kit.md. Nothing here writes copy.
 *
 * Usage:
 *   node _dev/open-awesome-pr.cjs            # dry run: token, anchors, links, diff
 *   node _dev/open-awesome-pr.cjs --apply    # fork, branch, commit, open PR
 *
 * The token is read from _dev/.tmp/github-token.txt (inside the gitignored
 * .tmp) or GITHUB_TOKEN, and is never printed. It must be a classic token with
 * public_repo: a fine-grained token cannot be granted write access to a
 * repository the user does not own, and opening a PR needs it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KIT = path.join(ROOT, 'promo', 'distribution-kit.md');
const TOKEN_FILE = path.join(__dirname, '.tmp', 'github-token.txt');

const API = 'https://api.github.com';
const UPSTREAM = 'pluja/awesome-privacy';
const FILE_PATH = 'README.md';
const BRANCH = 'add-localphototool-to-photo-editing';
const PR_TITLE = 'Add LocalPhotoTool to Photo Editing and Management > Web';

// The line above where ours goes, and the section it must be inside.
const ANCHOR = '- [miniPaint](https://github.com/viliusle/miniPaint)';
const REQUIRED_PARENT = '## Photo Editing and Management';
const REQUIRED_SUB = '#### Web';
const FORBIDDEN_PARENT = '## Cloaking';

const APPLY = process.argv.includes('--apply');

let failures = 0;
const ok = (what, detail = '') => console.log(`  PASS  ${what}${detail ? '  ' + detail : ''}`);
const bad = (what, detail = '') => { failures++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); };

function readToken() {
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    return { token: process.env.GITHUB_TOKEN.trim(), from: 'GITHUB_TOKEN' };
  }
  if (fs.existsSync(TOKEN_FILE)) {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return { token: t, from: path.relative(ROOT, TOKEN_FILE) };
  }
  return null;
}

async function gh(method, url, body, token) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'localphototool-pr',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// --- copy comes from the kit, never from here -------------------------------
function kitBlocks() {
  const md = fs.readFileSync(KIT, 'utf8');
  const out = new Map();
  const re = /^```copy\s+([^\n]*?)\s*$\n([\s\S]*?)^```\s*$/gm;
  let m;
  while ((m = re.exec(md))) {
    const name = (m[1].match(/name=(\S+)/) || [])[1];
    if (name) out.set(name, m[2]);
  }
  return out;
}

// --- where the line goes ----------------------------------------------------
function locate(lines, entry) {
  const hits = lines.map((l, i) => (l.startsWith(ANCHOR) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) return { error: `anchor matched ${hits.length} times, expected exactly 1` };
  const at = hits[0];

  // Every heading search is bounded by the parent section. The first version
  // scanned the whole file upward for a "###" and blanked the subsection when
  // it found one — but `#### Web` hangs directly off `## Photo Editing and
  // Management` with no intervening `###`, so the scan reached `### Shared
  // Expenses` several hundred lines up, inside a *different* `##` section, and
  // turned a correct anchor into a reported failure. Nothing caught this
  // earlier because the guard had never run past the token check.
  let parentIdx = -1;
  for (let k = at; k >= 0; k--) if (/^##\s/.test(lines[k])) { parentIdx = k; break; }
  if (parentIdx < 0) return { error: 'no "## " heading above the anchor' };
  const parent = lines[parentIdx].trim();

  let subIdx = -1;
  for (let k = at; k > parentIdx; k--) if (/^####\s/.test(lines[k])) { subIdx = k; break; }

  // A "###" between the parent and the "####" would mean the "####" belongs to
  // that deeper section, so the subsection is not the one we claimed.
  const limit = subIdx === -1 ? at + 1 : subIdx;
  const strays = [];
  for (let k = parentIdx + 1; k < limit; k++) if (/^###\s/.test(lines[k])) strays.push(k);
  const sub = subIdx !== -1 && strays.length === 0 ? lines[subIdx].trim() : '';

  if (parent !== REQUIRED_PARENT) return { error: `anchor sits under ${JSON.stringify(parent)}, expected ${JSON.stringify(REQUIRED_PARENT)}` };
  if (sub !== REQUIRED_SUB) {
    return { error: `anchor sits under ${JSON.stringify(sub)}, expected ${JSON.stringify(REQUIRED_SUB)}` +
      (strays.length ? ` (a "### " at line ${strays[0] + 1} sits in between)` : '') };
  }

  // `entry in lines` was the old test and it is an index lookup on an array, so
  // it only ever matched a numeric string. Compare the text itself.
  if (lines.some((l) => l.trim() === entry) || lines.some((l) => l.includes('localphototool.com'))) {
    return { error: 'the list already carries a localphototool.com link' };
  }
  return { at, parent, sub, parentIdx, subIdx };
}

async function main() {
  console.log('open-awesome-pr — ' + (APPLY ? 'APPLY' : 'dry run') + '\n');

  // 1. token -----------------------------------------------------------------
  console.log('token');
  const found = readToken();
  if (!found) {
    bad('a token is readable', `put it in ${path.relative(ROOT, TOKEN_FILE)} or GITHUB_TOKEN`);
    console.log(`\nexit 2 — nothing to do without a credential`);
    process.exit(2);
  }
  ok('a token is readable', `from ${found.from}, ${found.token.length} chars`);

  const me = await gh('GET', '/user', null, found.token);
  if (me.status !== 200) {
    bad('the token authenticates', `HTTP ${me.status} ${(me.json && me.json.message) || ''}`);
    console.log('\nexit 2 — a rejected token looks exactly like a scope problem, so stop here rather than guess');
    process.exit(2);
  }
  ok('the token authenticates', `as ${me.json.login}`);

  const login = me.json.login;
  console.log('  note  /user does not echo scopes; run check-github-token.cjs for those, and');
  console.log('        if a write 403s later the scope is why, not the network');

  // 2. the upstream file and the insertion point -----------------------------
  console.log('\ntarget file');
  const raw = await fetch(`https://raw.githubusercontent.com/${UPSTREAM}/main/${FILE_PATH}`);
  if (!raw.ok) { bad('upstream README is readable', `HTTP ${raw.status}`); process.exit(1); }
  const original = await raw.text();
  const lines = original.split('\n');
  ok('upstream README is readable', `${lines.length} lines`);

  const blocks = kitBlocks();
  let entry = (blocks.get('awesome-privacy-entry') || '').trim();
  const prBody = (blocks.get('pr-body') || '').trim();
  if (!entry) bad('kit has an awesome-privacy-entry block');
  else ok('kit has an awesome-privacy-entry block', `${entry.length} chars`);
  if (!prBody) bad('kit has a pr-body block');
  else ok('kit has a pr-body block', `${prBody.length} chars`);
  if (failures) process.exit(1);

  const spot = locate(lines, entry);
  if (spot.error) { bad('the anchor is where the kit says it is', spot.error); process.exit(1); }
  ok('the anchor is where the kit says it is', `line ${spot.at + 1}, ${spot.parent} > ${spot.sub}`);
  if (lines.slice(spot.at - 2, spot.at + 1).some((l) => l.trim().startsWith(FORBIDDEN_PARENT))) {
    bad('the anchor is not in the cloaking section');
  } else {
    ok('the anchor is not in the cloaking section');
  }

  // 3. the line would survive pr-lint ----------------------------------------
  console.log('\nthe added line');
  const entryRe = /^\s*[-*]\s+.*\]\(https?:\/\//;
  const body = entry.replace(/^\s*[-*]\s+/, '');
  if (!entryRe.test(entry)) bad('pr-lint would see it as an entry');
  else ok('pr-lint would see it as an entry');
  if (!body.includes(' - ')) bad('it carries the " - " description separator');
  else ok('it carries the " - " description separator');
  if (entry.split('\n').length !== 1) bad('it is a single line');
  else ok('it is a single line');

  for (const url of ['https://localphototool.com', 'https://github.com/biren001/localphototool']) {
    let good = false;
    for (let i = 1; i <= 3 && !good; i++) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 15000);
        const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: c.signal, headers: { 'user-agent': 'Mozilla/5.0' } });
        clearTimeout(t);
        // lychee hard-fails on 404/410 only; it accepts 2xx and the transient set.
        if (r.status < 400 || [403, 429, 500, 502, 503, 504].includes(r.status)) good = true;
        else bad(`lychee would pass ${url}`, `HTTP ${r.status}`);
      } catch (e) {
        if (i === 3) bad(`lychee would pass ${url}`, `${(e.cause && e.cause.code) || e.name} — lychee treats a dead domain as a hard failure`);
      }
    }
    if (good) ok(`lychee would pass ${url}`);
  }

  const updated = lines.slice(0, spot.at + 1).concat([entry], lines.slice(spot.at + 1));
  const added = updated.length - lines.length;
  if (added !== 1) bad('exactly one line is added', `${added}`);
  else ok('exactly one line is added');

  const diffStart = Math.max(0, spot.at - 3);
  console.log('\n--- diff, README.md');
  for (let k = diffStart; k <= spot.at + 2; k++) {
    const n = k + 1;
    if (k === spot.at + 1) console.log(`  +${n}  ${updated[k]}`);
    else console.log(`   ${n}  ${lines[k] === undefined ? '' : lines[k]}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. ${failures ? failures + ' check(s) failed.' : 'All checks passed.'}`);
    console.log('re-run with --apply to fork, branch, commit and open the PR');
    process.exit(failures ? 1 : 0);
  }
  if (failures) { console.log('\nrefusing to apply with failing checks'); process.exit(1); }

  // 4. fork ------------------------------------------------------------------
  console.log('\nfork');
  let fork = await gh('GET', `/repos/${login}/${UPSTREAM.split('/')[1]}`, null, found.token);
  if (fork.status === 404) {
    const made = await gh('POST', `/repos/${UPSTREAM}/forks`, {}, found.token);
    if (made.status !== 202 && made.status !== 200) {
      bad('the fork was created', `HTTP ${made.status} ${(made.json && made.json.message) || ''}`);
      process.exit(1);
    }
    ok('asked GitHub to fork', `HTTP ${made.status}`);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      fork = await gh('GET', `/repos/${login}/${UPSTREAM.split('/')[1]}`, null, found.token);
      if (fork.status === 200) break;
    }
  }
  if (fork.status !== 200) { bad('the fork exists', `HTTP ${fork.status}`); process.exit(1); }
  ok('the fork exists', `${fork.json.full_name} (${fork.json.default_branch})`);

  // 5. branch off upstream's head so the PR is never stale -------------------
  console.log('\nbranch');
  const head = await gh('GET', `/repos/${UPSTREAM}/git/ref/heads/${fork.json.default_branch}`, null, found.token);
  if (head.status !== 200) { bad('upstream head is readable', `HTTP ${head.status}`); process.exit(1); }
  const baseSha = head.json.object.sha;
  ok('upstream head is readable', baseSha.slice(0, 10));

  const existing = await gh('GET', `/repos/${login}/${fork.json.name}/git/ref/heads/${BRANCH}`, null, found.token);
  if (existing.status === 200) {
    ok('branch already exists, reusing it', BRANCH);
  } else {
    const made = await gh('POST', `/repos/${login}/${fork.json.name}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: baseSha }, found.token);
    if (made.status !== 201) { bad('branch created', `HTTP ${made.status} ${(made.json && made.json.message) || ''}`); process.exit(1); }
    ok('branch created', `${BRANCH} at ${baseSha.slice(0, 10)}`);
  }

  // 6. commit ----------------------------------------------------------------
  console.log('\ncommit');
  const cur = await gh('GET', `/repos/${login}/${fork.json.name}/contents/${FILE_PATH}?ref=${BRANCH}`, null, found.token);
  if (cur.status !== 200) { bad('the file is readable on the branch', `HTTP ${cur.status}`); process.exit(1); }
  const onBranch = Buffer.from(cur.json.content, 'base64').toString('utf8');
  if (onBranch !== original) {
    // Someone moved upstream between our read and now. Rebuild against what is
    // actually there rather than committing a stale file over it.
    const lines2 = onBranch.split('\n');
    const spot2 = locate(lines2, entry);
    if (spot2.error) { bad('the anchor still resolves on the branch', spot2.error); process.exit(1); }
    ok('upstream moved, rebuilt against the branch copy', `line ${spot2.at + 1}`);
    var updatedOnBranch = lines2.slice(0, spot2.at + 1).concat([entry], lines2.slice(spot2.at + 1)).join('\n');
  } else {
    ok('the branch copy matches what we diffed');
    var updatedOnBranch = updated.join('\n');
  }

  const put = await gh('PUT', `/repos/${login}/${fork.json.name}/contents/${FILE_PATH}`, {
    message: `${PR_TITLE}\n\n${prBody}`,
    content: Buffer.from(updatedOnBranch, 'utf8').toString('base64'),
    sha: cur.json.sha,
    branch: BRANCH,
  }, found.token);
  if (put.status !== 200 && put.status !== 201) {
    bad('the commit landed', `HTTP ${put.status} ${(put.json && put.json.message) || ''}`);
    process.exit(1);
  }
  ok('the commit landed', (put.json.commit && put.json.commit.sha || '').slice(0, 10));

  // 7. pull request ----------------------------------------------------------
  console.log('\npull request');
  const pr = await gh('POST', `/repos/${UPSTREAM}/pulls`, {
    title: PR_TITLE,
    head: `${login}:${BRANCH}`,
    base: fork.json.default_branch,
    body: prBody,
    maintainer_can_modify: true,
  }, found.token);
  if (pr.status !== 201) {
    bad('the pull request opened', `HTTP ${pr.status} ${(pr.json && pr.json.message) || ''}${pr.json && pr.json.errors ? ' ' + JSON.stringify(pr.json.errors) : ''}`);
    process.exit(1);
  }
  ok('the pull request opened', `#${pr.json.number}`);
  console.log(`\n${pr.json.html_url}`);
  console.log('\nNext: check the two CI jobs (link check, format lint) under the PR, then');
  console.log('delete the token at https://github.com/settings/tokens — this one was created');
  console.log('without an expiry date.');
}

main().catch((e) => { console.error('unexpected: ' + (e && e.stack || e)); process.exit(1); });
