/* Check that a GitHub token is the right type and has the right scope, before
   anything is done with it.

   Opening a pull request against a public repository we do not own needs write
   access to somebody else's repo, and fine-grained tokens cannot be granted
   that: GitHub scopes them to resources owned by the selected resource owner,
   and grants read-only on other people's public repos. So the token has to be a
   classic one with `public_repo`, and this script proves it rather than assuming
   it — a scope mismatch shows up as a 403 halfway through a PR otherwise, with
   the branch already pushed.

   The token itself is never printed. It is read from _dev/.tmp/github-token.txt
   (inside the gitignored .tmp directory) or from GITHUB_TOKEN, and only the
   account it belongs to, its scopes, and the rate limit are reported.

   Usage:  node _dev/check-github-token.cjs
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOKEN_FILE = path.join(ROOT, '_dev', '.tmp', 'github-token.txt');

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

const got = readToken();
if (!got) {
  console.error('check-github-token: no token found.');
  console.error(`  Put it in ${path.relative(ROOT, TOKEN_FILE)} (one line, nothing else),`);
  console.error('  or set GITHUB_TOKEN. That directory is gitignored, so it will not be committed.');
  process.exit(2);
}

const { token, from } = got;

/* Classic tokens were documented with the `token` scheme and fine-grained with
   `Bearer`, so try both and report which one this token answers to. That also
   identifies the type without having to guess it from the prefix. */
async function call(scheme) {
  const r = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `${scheme} ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'localphototool-token-check',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return r;
}

(async () => {
  console.log(`check-github-token: token read from ${from}`);

  let res = await call('Bearer');
  let scheme = 'Bearer';
  if (res.status === 401 || res.status === 403) {
    res = await call('token');
    scheme = 'token';
  }

  if (!res.ok) {
    console.error(`  FAIL  HTTP ${res.status} with both schemes — the token is wrong or expired.`);
    const body = await res.text();
    console.error('  ' + body.slice(0, 200));
    process.exit(1);
  }

  const user = await res.json();
  const scopes = (res.headers.get('x-oauth-scopes') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const kind = res.headers.get('x-accepted-oauth-scopes') !== null || scopes.length ? 'classic' : 'fine-grained (or no scopes)';

  console.log(`  PASS  authenticated as ${user.login} (id ${user.id})`);
  console.log(`  auth scheme accepted : ${scheme}`);
  console.log(`  token type           : ${kind}`);
  console.log(`  scopes               : ${scopes.length ? scopes.join(', ') : '(none reported)'}`);

  const need = 'public_repo';
  const ok = scopes.includes(need);
  console.log(`  needs "${need}" to open PRs on public repos we do not own: ${ok ? 'yes' : 'NO'}`);

  const rate = await fetch('https://api.github.com/rate_limit', {
    headers: { Authorization: `${scheme} ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'localphototool-token-check' },
  });
  if (rate.ok) {
    const rl = (await rate.json()).resources.core;
    console.log(`  core rate limit      : ${rl.limit}/hour`);
  }

  if (!ok) {
    console.error('\n  -> This token cannot create pull requests on someone else\'s repo.');
    console.error('     Re-create it as a classic token with the `public_repo` scope.');
    process.exit(1);
  }

  console.log('\n  -> Good to go: forks, branches and PRs against public repos will work.');
  console.log('     Revoke it at https://github.com/settings/tokens when the PRs are open.');
})();
