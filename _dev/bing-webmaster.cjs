/* Talk to the Bing Webmaster API directly, so the dashboard steps stop being
   manual. Every method here is a documented Webmaster API call; nothing is
   scraped from the HTML UI.

   Why this exists: the "Import from Google Search Console" button lives in the
   *add a site* wizard and disappears once the site is registered, so once the
   property is in there is nothing left to import — what remains is submitting
   the sitemap and reading the crawl/index numbers, both of which the API does
   without a browser.

   Key resolution order (never printed, only fingerprinted):
     1. --key-file <path>
     2. BING_API_KEY in the environment
     3. _dev/.tmp/bing-api-key.txt      (gitignored)

   Commands:
     sites                  list verified sites — the auth smoke test
     sitemap-list           sitemaps Bing already knows about
     sitemap-submit         submit localphototool.com/sitemap.xml
     quota                  how many URL submissions are left today
     urls [--apply]         submit every URL in the local sitemap (dry run by default)
     stats                  rank & traffic (this is where "is it indexed" shows up)
     crawl                  crawl stats and crawl issues
     query-stats            query-level impressions, if any have accumulated
     urlinfo [url ...]      per-URL index status — works before crawl stats exist
     raw <Method> [k=v]     call any documented method and dump the JSON

   The site URL must match Bing's registration exactly, trailing slash
   included, which is why SITE below is a constant rather than derived:
     node _dev/bing-webmaster.cjs sites        # then confirm the exact string
*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCAL_SITEMAP = path.join(ROOT, 'localphototool', 'sitemap.xml');
const DEFAULT_KEY_FILE = path.join(__dirname, '.tmp', 'bing-api-key.txt');
const SITE = 'https://localphototool.com/';
const API = 'https://ssl.bing.com/webmaster/api.svc/json/';

const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith('--')) || '';
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

function loadKey() {
  const explicit = flag('key-file');
  const file = explicit && explicit !== true ? explicit : DEFAULT_KEY_FILE;
  if (fs.existsSync(file)) return { key: fs.readFileSync(file, 'utf8').trim(), from: file };
  if (process.env.BING_API_KEY) {
    return { key: process.env.BING_API_KEY.trim(), from: 'BING_API_KEY env' };
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Bing throttles per host, not per key: past roughly nine calls in quick
   succession it answers HTTP 400 with {"ErrorCode":5,"Message":"ThrottleHost"}
   — which looks exactly like a malformed request unless you read the body.
   Measured 2026-09-24 on this site: request 10 onward of a 13-URL loop all
   failed that way, so a loop over the sitemap cannot work without backing off.
   Transport failures are retried too; "fetch failed" was observed at roughly
   1 in 4 on the first attempt of the day and then never again. */
const MIN_GAP_MS = 900;
let lastCallAt = 0;

async function api(method, { query = {}, body = null, key } = {}) {
  const gap = Date.now() - lastCallAt;
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);

  const url = new URL(API + method);
  url.searchParams.set('apikey', key);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const init = body
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      }
    : {};

  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      lastCallAt = Date.now();
      res = await fetch(url, init);
    } catch (err) {
      // undici collapses DNS, TCP, TLS and reset failures into "fetch failed"
      // and hides the reason in .cause — print it, or the next reader learns
      // nothing from the error.
      const cause = err.cause ? err.cause.code || err.cause.message : 'no cause reported';
      if (attempt < MAX_ATTEMPTS) {
        await sleep(600 * attempt);
        continue;
      }
      throw new Error(`transport failure after ${attempt} attempts: ${cause} (host ${url.host}, ${method})`);
    }

    const text = await res.text();

    if (res.status === 400 && /ThrottleHost/i.test(text) && attempt < MAX_ATTEMPTS) {
      await sleep(1200 * attempt);
      continue;
    }

    if (!res.ok) {
      const e = new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
      e.status = res.status;
      throw e;
    }

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* some methods return an empty 200 body */
    }
    return json && Object.prototype.hasOwnProperty.call(json, 'd') ? json.d : json;
  }
}

function localSitemapUrls() {
  const xml = fs.readFileSync(LOCAL_SITEMAP, 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/* GetUrlInfo is served by an ASP.NET stack, so dates arrive as .NET's
   "/Date(1789785741000)/" wrapper rather than ISO, and unavailable numbers
   arrive as 0 rather than null. Both would read as real values if printed
   raw — a HttpStatus of 0 is not "HTTP 0", it is "we have no status", and
   that distinction is the whole point of asking. */
function netDate(value) {
  const m = typeof value === 'string' && value.match(/\/Date\((\d+)\)\//);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

function formatUrlInfo(short, info) {
  if (!info || typeof info !== 'object') return `${short.padEnd(34)} no data`;
  const status = Number(info.HttpStatus);
  const discovered = netDate(info.DiscoveryDate);
  const crawled = netDate(info.LastCrawledDate);

  // A page Bing has never recorded answers with every field zeroed. Saying
  // "never fetched" whenever HttpStatus is 0 was wrong: /compress/ had a real
  // crawl date alongside a 0 status, so 0 means "not recorded", not "not
  // fetched". Print nothing rather than something false.
  if (!discovered && !crawled && !status) return `${short.padEnd(34)} no record at all`;

  const bits = [];
  if (status > 0) bits.push(`http ${status}`);
  if (discovered) bits.push('found ' + discovered);
  if (crawled) bits.push('crawled ' + crawled);
  if (Number(info.DocumentSize) > 0) bits.push(`${Math.round(Number(info.DocumentSize) / 1024)}KB`);
  // AnchorCount is inbound links Bing has seen. Zero on every page is the
  // measured version of "the site has no authority yet" — worth printing,
  // because it is the number this whole distribution effort is meant to move.
  bits.push(`${Number(info.AnchorCount) || 0} inbound anchor(s)`);
  if (info.IsBlocked) bits.push('BLOCKED');
  return `${short.padEnd(34)} ${bits.join('  ')}`;
}

const COMMANDS = {
  async sites({ key }) {
    const sites = await api('GetUserSites', { key });
    if (!Array.isArray(sites) || !sites.length) {
      console.log('No sites on this account.');
      return;
    }
    console.log('Sites on this key:');
    for (const s of sites) console.log('  ' + s.Url);
    const exact = sites.find((s) => s.Url === SITE);
    console.log(
      exact
        ? `\nmatch: ${SITE} is registered exactly as this script assumes.`
        : `\nWARNING: ${SITE} is not in that list verbatim. Copy the exact Url above into SITE.`
    );
  },

  async 'sitemap-list'({ key }) {
    const feeds = await api('GetFeeds', { key, query: { siteUrl: SITE } });
    if (!Array.isArray(feeds) || !feeds.length) {
      console.log(`Bing knows of no sitemap for ${SITE} yet. Run: sitemap-submit`);
      return;
    }
    for (const f of feeds) {
      console.log(`${f.Url}\n  type=${f.Type ?? '?'}  status=${f.Status ?? '?'}  urls=${f.UrlCount ?? '?'}`);
    }
  },

  async 'sitemap-submit'({ key }) {
    const feedUrl = SITE + 'sitemap.xml';
    console.log(`POST SubmitFeed  siteUrl=${SITE}  feedUrl=${feedUrl}`);
    await api('SubmitFeed', { key, body: { siteUrl: SITE, feedUrl } });
    console.log('accepted — Bing will re-read it on its own schedule.');
  },

  async quota({ key }) {
    const q = await api('GetUrlSubmissionQuota', { key, query: { siteUrl: SITE } });
    console.log(JSON.stringify(q, null, 2));
  },

  async urls({ key }) {
    const urls = localSitemapUrls();
    console.log(`${urls.length} URLs derived from ${path.relative(ROOT, LOCAL_SITEMAP)}:`);
    for (const u of urls) console.log('  ' + u);
    if (!flag('apply')) {
      console.log('\ndry run — nothing submitted. Add --apply to send them.');
      return;
    }
    // Documented batch limit is 500 URLs per call; 13 is far below it, but the
    // chunking stays so this keeps working when the site grows.
    const CHUNK = 500;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const urlList = urls.slice(i, i + CHUNK);
      await api('SubmitUrlBatch', { key, body: { siteUrl: SITE, urlList } });
      console.log(`submitted ${urlList.length} URLs (batch starting at ${i})`);
    }
  },

  async stats({ key }) {
    const rows = await api('GetRankAndTrafficStats', { key, query: { siteUrl: SITE } });
    if (!Array.isArray(rows) || !rows.length) {
      console.log('No traffic data yet — a new property takes a day or two to report.');
      return;
    }
    console.log('date         clicks  impressions');
    for (const r of rows.slice(-14)) {
      console.log(`${r.Date.slice(0, 10)}  ${String(r.Clicks).padStart(6)}  ${String(r.Impressions).padStart(11)}`);
    }
  },

  async crawl({ key }) {
    const stats = await api('GetCrawlStats', { key, query: { siteUrl: SITE } });
    if (Array.isArray(stats) && stats.length) {
      console.log('date         crawled  inIndex  errors');
      for (const r of stats.slice(-14)) {
        console.log(
          `${r.Date.slice(0, 10)}  ${String(r.CrawledPages).padStart(7)}  ${String(r.InIndex).padStart(7)}  ${String(r.CrawlErrors).padStart(6)}`
        );
      }
    } else {
      console.log('no crawl stats yet');
    }
    const issues = await api('GetCrawlIssues', { key, query: { siteUrl: SITE } });
    if (Array.isArray(issues) && issues.length) {
      console.log(`\n${issues.length} crawl issue(s):`);
      for (const i of issues) console.log(`  ${i.HttpCode}  ${i.Url}  — ${i.IssueType}`);
    } else {
      console.log('no crawl issues reported');
    }
  },

  async 'query-stats'({ key }) {
    const rows = await api('GetQueryStats', { key, query: { siteUrl: SITE } });
    if (!Array.isArray(rows) || !rows.length) {
      console.log('no query data yet');
      return;
    }
    for (const r of rows.slice(0, 25)) {
      console.log(`${String(r.Impressions).padStart(6)}  pos ${String(r.AvgImpressionPosition).padStart(5)}  ${r.Query}`);
    }
  },

  /* Ask Bing about each page individually. GetCrawlStats is aggregate and
     stays empty for days on a new property, but GetUrlInfo answers per URL,
     which is the question that actually matters: is this page in the index?
     Field names differ between API revisions, so the first thing printed is
     the raw object for the first URL, then a compact table. */
  async urlinfo({ key }) {
    const only = argv.filter((a) => a.startsWith('http'));
    const urls = only.length ? only : localSitemapUrls();
    console.log(`${urls.length} URL(s)\n`);

    let printedShape = false;
    for (const url of urls) {
      try {
        const info = await api('GetUrlInfo', { key, query: { siteUrl: SITE, url } });
        if (!printedShape && info) {
          console.log('raw shape for the first URL:');
          console.log(JSON.stringify(info, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
          console.log('');
          printedShape = true;
        }
        const short = url.replace(/^https:\/\/localphototool\.com/, '') || '/';
        console.log(formatUrlInfo(short, info));
      } catch (err) {
        console.log(`${url.padEnd(34)} FAILED: ${err.message}`);
      }
    }
  },

  /* Escape hatch: call any documented method with ad-hoc query parameters.
       node _dev/bing-webmaster.cjs raw GetUrlTrafficInfo siteUrl=... url=...
     Keeps this script from needing an edit every time one more method is
     wanted, and prints the raw JSON so field names can be read rather than
     guessed at. */
  async raw({ key }) {
    const rest = argv.filter((a) => a !== 'raw' && !a.startsWith('--key-file'));
    const method = rest.find((a) => !a.includes('='));
    if (!method) {
      console.error('usage: raw <MethodName> [key=value ...]');
      process.exit(2);
    }
    const query = {};
    for (const pair of rest) {
      const i = pair.indexOf('=');
      if (i > 0) query[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const data = await api(method, { key, query });
    console.log(JSON.stringify(data, null, 2));
  },
};

(async () => {
  const found = loadKey();
  if (!found) {
    console.error('No API key found. Get one at:');
    console.error('  bing.com/webmasters  ->  Settings (gear, top right)  ->  API Access  ->  generate');
    console.error(`then either save it to ${path.relative(ROOT, DEFAULT_KEY_FILE)}`);
    console.error('or set BING_API_KEY, or pass --key-file <path>.');
    console.error('\nThe key is per-user, not per-site, and can be regenerated at any time.');
    process.exit(2);
  }

  if (!COMMANDS[cmd]) {
    console.error(`Unknown command: ${cmd || '(none)'}\n`);
    console.error('Commands: ' + Object.keys(COMMANDS).join(', '));
    process.exit(2);
  }

  const { key, from } = found;
  console.log(`key ${key.slice(0, 4)}…${'*'.repeat(6)} (${key.length} chars, from ${from})`);
  try {
    await COMMANDS[cmd]({ key });
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    if (err.status === 401 || err.status === 403) {
      console.error('That is an auth rejection — the key may be mistyped, revoked, or the site not verified.');
    }
    process.exit(1);
  }
})();
