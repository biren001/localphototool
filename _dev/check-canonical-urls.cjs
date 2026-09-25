'use strict';
// Which sitemap URLs answer with a redirect, and whether every non-canonical variant
// points at the canonical form. GSC reports the redirect itself as a problem; it is not.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(ROOT, 'localphototool', 'sitemap.xml');

const locs = [...fs.readFileSync(SITEMAP, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
console.log(`sitemap has ${locs.length} urls\n`);

async function head(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 15000);
      const r = await fetch(url, {
        redirect: 'manual',
        signal: c.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      });
      clearTimeout(t);
      return { status: r.status, loc: r.headers.get('location') };
    } catch (e) {
      if (i === 3) return { status: 'ERR', loc: (e.cause && e.cause.code) || e.name };
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

(async () => {
  const rows = [];
  for (const u of locs) {
    const bare = u.replace(/\/$/, '');
    const variants = [];
    // canonical form from the sitemap
    variants.push(u);
    // the same path without the trailing slash
    if (u !== 'https://localphototool.com/') variants.push(bare);
    // explicit index.html
    variants.push(bare + '/index.html');
    for (const v of variants) {
      if (rows.some((r) => r.url === v)) continue;
      const r = await head(v);
      rows.push({ url: v, ...r });
    }
  }

  console.log('--- every variant, manual redirect ---');
  for (const r of rows) {
    const mark = r.status === 200 ? '    ' : '>>> ';
    console.log(`${mark}${String(r.status).padEnd(4)} ${r.url}${r.loc ? '  ->  ' + r.loc : ''}`);
  }

  // host-level and scheme-level checks
  console.log('\n--- host and scheme ---');
  for (const v of [
    'http://localphototool.com/',
    'https://www.localphototool.com/',
    'http://www.localphototool.com/',
  ]) {
    const r = await head(v);
    console.log(`${r.status === 200 ? '    ' : '>>> '}${String(r.status).padEnd(4)} ${v}${r.loc ? '  ->  ' + r.loc : ''}`);
  }

  const redir = rows.filter((r) => r.status !== 200);
  console.log(`\n--- verdict ---`);
  console.log(`  ${rows.length} urls probed, ${redir.length} answer with a redirect`);
  for (const r of redir) console.log(`    ${r.status}  ${r.url}  ->  ${r.loc}`);
  process.exit(0);
})();
