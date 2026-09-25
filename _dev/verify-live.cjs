#!/usr/bin/env node
/**
 * verify-live.cjs — is the edge serving exactly the build on this disk?
 *
 * Replaces the one-off verify-live-v12.cjs / verify-live-v13.cjs pair. Those
 * hard-coded the expectations of a single release (v12's copy still listed
 * /heic-to-png/ and /resize-image/, two pages that never existed), so each new
 * release needed a new script and the old ones rotted into wrong answers.
 *
 * This one derives everything from local source instead of restating it:
 *
 *   1. read the VERSION and the SHELL array out of localphototool/sw.js and
 *      require the live /sw.js to agree — a version mismatch means the upload
 *      never landed, and a SHELL mismatch means a half-applied deploy
 *   2. every page in the local SHELL must answer 200 on the live origin
 *   3. fetch the live sitemap and require every URL in it to answer 200
 *      (this is what would have caught the three landing pages that were live
 *      and unchecked for two days)
 *   4. require the local <title> of each content page to match the live one,
 *      so a stale edge cache cannot pass by serving a plausible old page
 *
 * Read-only. Every request retries: this sandbox drops connections routinely
 * and a hiccup must not be reported as a missing deploy.
 */
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'localphototool');
const BASE = 'https://localphototool.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '  — ' + d : '')); };
const no = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '  — ' + d : '')); };

async function get(pathname, { tries = 3 } = {}) {
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(BASE + pathname, { redirect: 'follow', headers: { 'user-agent': UA, accept: '*/*' } });
      return { status: res.status, headers: res.headers, body: await res.text(), error: null };
    } catch (e) {
      lastErr = e;
      if (i < tries) await sleep(700 * i);
    }
  }
  return { status: 0, headers: new Headers(), body: '', error: (lastErr && lastErr.message) || 'fetch failed' };
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const titleOf = (h) => decode((h.match(/<title[^>]*>([^<]*)<\/title>/i) || [, ''])[1]).trim();

/* ---- what the local build says ------------------------------------------- */
/* The SHELL array is followed by .map(...), not by "];", so a non-greedy
   /\[([\s\S]*?)\];/ runs straight past the end of the array and swallows the
   next statement — VENDOR_HOSTS — which then shows up as two bogus "pages"
   (esm.sh, cdn.jsdelivr.net). Anchor the capture on the .map that closes it. */
const SHELL_RE = /var SHELL = \[([\s\S]*?)\]\s*\.map\(/;
const localSw = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
const localVersion = (localSw.match(/var VERSION = '([^']+)'/) || [, ''])[1];
const shellBlock = (localSw.match(SHELL_RE) || [, ''])[1];
const localShell = [...shellBlock.matchAll(/'([^']*)'/g)].map((m) => m[1]);
if (!localShell.length) { console.error('Could not read the SHELL array from sw.js — refusing to guess.'); process.exit(2); }

/* Content pages, for the title comparison: every directory with an index.html
   except the owner-only dashboard and the offline fallback. */
const contentPages = fs.readdirSync(SITE, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(SITE, d.name, 'index.html')))
  .map((d) => d.name)
  .filter((n) => n !== 'stats' && n !== 'assets');

(async () => {
  console.log(`Local build: sw.js ${localVersion}, ${localShell.length} shell entries, ${contentPages.length} content dirs`);
  console.log(`Verifying ${BASE}\n`);

  if (!localVersion) { no('local sw.js declares a VERSION'); } else { ok('local sw.js declares a VERSION', localVersion); }

  // ---- 1. version and shell agreement -------------------------------------
  console.log('\n1. deployed version matches disk');
  const live = await get('/sw.js');
  if (live.error) {
    no('/sw.js is reachable', live.error);
  } else {
    const liveVersion = (live.body.match(/var VERSION = '([^']+)'/) || [, ''])[1];
    liveVersion === localVersion
      ? ok(`live sw.js is ${localVersion}`, `cache-control: ${live.headers.get('cache-control')}`)
      : no(`live sw.js is ${localVersion}`, liveVersion ? `edge is serving ${liveVersion}` : 'no VERSION found — upload may have failed');

    const liveShell = [...((live.body.match(SHELL_RE) || [, ''])[1].matchAll(/'([^']*)'/g))].map((m) => m[1]);
    const drift = localShell.filter((p) => liveShell.indexOf(p) === -1).concat(liveShell.filter((p) => localShell.indexOf(p) === -1));
    drift.length === 0
      ? ok('live SHELL array matches disk', `${liveShell.length} entries`)
      : no('live SHELL array matches disk', 'differs: ' + drift.join(', '));
  }

  // ---- 2. every shell page resolves ---------------------------------------
  console.log('\n2. every shell page resolves');
  for (const p of localShell) {
    /* Files, and the offline fallback, are covered elsewhere; and anything with
       no slash in it is a hostname, not a path. */
    if (/\.(png|ico|svg|webmanifest|css|js|mjs)$/.test(p) || p === 'offline.html') continue;
    if (!p.includes('/') && p.includes('.')) continue;
    const r = await get('/' + p);
    r.status === 200 ? ok(`/${p} returns 200`, `${(r.body.length / 1024).toFixed(1)} KB`)
                     : no(`/${p} returns 200`, `status ${r.status}`);
  }

  // ---- 3. the sitemap is the derived checklist ----------------------------
  console.log('\n3. every sitemap URL resolves');
  const sm = await get('/sitemap.xml');
  const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  urls.length ? ok('sitemap.xml is readable', `${urls.length} urls`) : no('sitemap.xml is readable', sm.error || 'no urls found');
  for (const u of urls) {
    const r = await get(u.replace(BASE, ''));
    r.status === 200 ? ok(`resolves ${u.replace(BASE, '')}`) : no(`resolves ${u.replace(BASE, '')}`, `status ${r.status}`);
  }

  // ---- 4. page copy is not a stale edge cache -----------------------------
  console.log('\n4. page titles match the local build');
  for (const name of contentPages) {
    const localTitle = titleOf(fs.readFileSync(path.join(SITE, name, 'index.html'), 'utf8'));
    const r = await get('/' + name + '/');
    const liveTitle = titleOf(r.body);
    liveTitle === localTitle
      ? ok(`/${name}/ title matches`)
      : no(`/${name}/ title matches`, `live: "${liveTitle.slice(0, 60)}" vs local: "${localTitle.slice(0, 60)}"`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('\nA VERSION mismatch means the upload never landed. A SHELL or title mismatch means a partial deploy or a stale edge cache — Purge Cache under Caching -> Configuration.');
  process.exit(fail ? 1 : 0);
})();
