#!/usr/bin/env node
/* Compares the published GitHub repository against this working tree.

   Run after every push. The decisive check is the commit hash: a git commit
   hash is a cryptographic digest of the entire tree plus metadata, so if the
   remote ref equals the local HEAD, the published content is byte-identical
   to what is on disk. Everything below that is supporting evidence.

   Only reads. Needs network access to api.github.com.

   Usage:  node _dev/verify-push.cjs
   Exit:   0 all checks pass, 1 something diverged, 2 could not run */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCAL_README = path.join(ROOT, 'README.md');

function git(cmd) {
  return execSync('git ' + cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/* Derive owner/name from the remote rather than hard-coding it, so the script
   keeps working if the repository is ever renamed or moved. */
function repoSlug() {
  const url = git('remote get-url origin');
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error('cannot derive owner/repo from origin: ' + url);
  return m[1] + '/' + m[2];
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name.padEnd(52) + (detail || ''));
    ok ? pass++ : fail++;
  };

  const REPO = repoSlug();
  const localHead = git('rev-parse HEAD');
  /* %T rather than HEAD^{tree}: execSync shells out through cmd.exe on Windows,
     where ^ is an escape character and eats the caret. */
  const localTree = git('show -s --format=%T HEAD');
  /* core.quotePath=false, or git prints non-ASCII names octal-escaped
     (unicode-\346\227\245...) and every such file looks missing remotely. */
  const localFiles = git('-c core.quotePath=false ls-tree -r HEAD --name-only').split('\n').filter(Boolean);
  const remoteHead = execSync('git ls-remote origin refs/heads/main', { cwd: ROOT, encoding: 'utf8' }).trim().split(/\s+/)[0];

  console.log('repository ' + REPO);
  console.log('local      HEAD ' + localHead.slice(0, 12) + '  tree ' + localTree.slice(0, 12) + '  ' + localFiles.length + ' files\n');

  const api = async (p) => {
    const r = await fetch('https://api.github.com' + p, {
      headers: { 'user-agent': 'localphototool-push-check', accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + p);
    return r.json();
  };

  const repo = await api('/repos/' + REPO);
  /* The root tree comes from the commits endpoint: /git/trees/{ref} echoes the
     ref's own sha, not the tree object it resolves to — which once made this
     compare a commit hash against a tree hash. */
  const commitInfo = await api('/repos/' + REPO + '/commits/' + repo.default_branch);
  const remoteTree = commitInfo.commit.tree.sha;
  const tree = await api('/repos/' + REPO + '/git/trees/' + remoteTree + '?recursive=1');
  const remoteBlobs = tree.tree.filter((e) => e.type === 'blob');

  console.log('--- the decisive one ---');
  check('remote commit hash === local HEAD', remoteHead === localHead,
    remoteHead.slice(0, 12) + (remoteHead === localHead ? ' — identical' : ' vs ' + localHead.slice(0, 12)));
  check('remote root tree hash === local tree', remoteTree === localTree, remoteTree.slice(0, 12));

  console.log('\n--- supporting evidence ---');
  /* Without this the script answers "is HEAD published?" but a clean-looking
     result would hide edits that were never committed in the first place. */
  const dirty = git('status --porcelain');
  check('working tree has no uncommitted changes', dirty === '',
    dirty ? dirty.split('\n').length + ' path(s) not committed' : 'clean');
  check('repository is public', repo.private === false, 'visibility=' + (repo.private ? 'private' : 'public'));
  check('default branch is main', repo.default_branch === 'main', repo.default_branch);
  check('remote file count matches local', remoteBlobs.length === localFiles.length,
    remoteBlobs.length + ' remote vs ' + localFiles.length + ' local');

  const remotePaths = new Set(remoteBlobs.map((b) => b.path));
  const missing = localFiles.filter((f) => !remotePaths.has(f));
  check('no local file missing on the remote', missing.length === 0,
    missing.length ? missing.slice(0, 5).join(', ') : 'all present');

  const extras = remoteBlobs.map((b) => b.path).filter((p) => !localFiles.includes(p));
  check('no unexpected extra file on the remote', extras.length === 0,
    extras.length ? extras.slice(0, 5).join(', ') : 'none');

  console.log('\n--- README, byte for byte ---');
  const readmeApi = await api('/repos/' + REPO + '/contents/README.md');
  const remoteRaw = Buffer.from(readmeApi.content, 'base64');
  const localRaw = fs.readFileSync(LOCAL_README);
  check('README bytes identical', remoteRaw.equals(localRaw),
    remoteRaw.length + ' remote vs ' + localRaw.length + ' local bytes');

  console.log('\n--- what must never be published ---');
  const leaks = [...remotePaths].filter((p) =>
    /^\.workbuddy\/|^_dev\/corpus\/|^_dev\/out\/|^_dev\/\.tmp\/|\.zip$|\.log$|indexnote?-key|\.indexnow-key/.test(p));
  check('no memory / corpus / archive / log leaked', leaks.length === 0,
    leaks.length ? leaks.slice(0, 5).join(', ') : 'clean');

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR ' + e.message); process.exit(2); });
