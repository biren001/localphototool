/* Which distribution and submission channels are reachable from THIS machine.

   Why this exists: the distribution kit's channel order was written as if every
   channel were reachable, and the two with the best traffic-to-effort ratio —
   Hacker News and Reddit — are both blocked from mainland China while github.com
   and dev.to are not. An order that ignores that is a plan that stalls on step
   one. The numbers in promo/distribution-kit.md §4 come from this script.

   Usage:
     node _dev/check-reachability.cjs

   Read-only. Nothing here touches the site, so this is not part of run-all.sh:
   it measures the local network, not the product, and a change in the answer is
   news about the connection rather than a regression in the code. */
const CHANNELS = [
  /* Discovery: the search engines, in the order they matter for this project. */
  ['Bing', 'https://www.bing.com/', 'discovery'],
  ['Yandex', 'https://yandex.com/', 'discovery'],
  ['Google', 'https://www.google.com/', 'discovery'],
  ['DuckDuckGo', 'https://duckduckgo.com/', 'discovery'],
  ['IndexNow API', 'https://api.indexnow.org/indexnow', 'submission'],
  ['Bing Webmaster', 'https://www.bing.com/webmasters', 'submission'],
  ['Yandex Webmaster', 'https://webmaster.yandex.com/', 'submission'],
  ['Cloudflare dashboard', 'https://dash.cloudflare.com/', 'submission'],

  /* Distribution: where a link can be published from here. */
  ['GitHub', 'https://github.com/', 'distribution'],
  ['dev.to', 'https://dev.to/', 'distribution'],
  ['Indie Hackers', 'https://www.indiehackers.com/', 'distribution'],
  ['Product Hunt', 'https://www.producthunt.com/', 'distribution'],
  ['AlternativeTo', 'https://alternativeto.net/', 'distribution'],
  ['Hacker News', 'https://news.ycombinator.com/', 'distribution'],
  ['Reddit', 'https://www.reddit.com/', 'distribution'],
  ['Medium', 'https://medium.com/', 'distribution'],
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const TIMEOUT_MS = 8000;

async function probe(url) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ac.signal });
    return { reachable: true, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { reachable: false, status: 0, ms: Date.now() - t0, error: (e && e.message) || 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

(async function () {
  console.log('Reachability from this machine — ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  console.log('Read-only. A blocked line means no HTTP response at all within '
    + (TIMEOUT_MS / 1000) + 's.\n');

  const rows = [];
  let group = '';
  for (const [name, url, kind] of CHANNELS) {
    if (kind !== group) { group = kind; console.log('\n' + kind.toUpperCase()); }
    const r = await probe(url);
    rows.push({ name: name, kind: kind, r: r });
    /* A 4xx is an ANSWER, not a block: Cloudflare-fronted sites refuse this
       scripted user agent while loading fine in a browser, and a bare GET on an
       API endpoint is supposed to be rejected. Only "no HTTP response at all" is
       a block, and conflating the two would cross real channels off the list. */
    const verdict = !r.reachable ? 'BLOCKED'
      : r.status === 403 || r.status === 429 ? 'reachable (' + r.status + ', bot-protected)'
        : r.status >= 400 ? 'reachable (' + r.status + ', endpoint answered)'
          : 'reachable';
    console.log('  ' + name.padEnd(22) + verdict.padEnd(30) + (r.reachable ? '' : r.error));
  }

  const blocked = rows.filter(function (x) { return !x.r.reachable; });
  const reachable = rows.filter(function (x) { return x.r.reachable; });
  console.log('\n' + reachable.length + ' of ' + rows.length + ' answered.');
  if (blocked.length) {
    console.log('\nNo response from:');
    blocked.forEach(function (x) { console.log('  · ' + x.name); });
  }
  if (reachable.length === 0) {
    /* Everything timing out means the measurement says nothing about any single
       channel. Say so instead of printing a table that reads like a verdict. */
    console.log('\nNothing answered at all — this is the connection here, so the '
      + 'table above is not a verdict on any channel. Re-run when the network settles.');
    process.exit(2);
  }
  console.log('\nNote: the set of blocked hosts is a property of the connection, not of '
    + 'the site. Re-run this if the answer matters to a decision.');
})();
