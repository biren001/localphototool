/**
 * _dev/vet-writer-targets.cjs
 *
 * Vets the pages of writers who have already published something about image
 * compressors, before anyone emails them.
 *
 * The question asked is not "is this a nice site" - it is the only one worth
 * asking: if this page wrote a sentence about our measurement, would the link
 * that sentence contains pass equity to us? So every anchor is read for its
 * `rel`, and only `nofollow` / `sponsored` / `ugc` count as blocking. `noopener`
 * and `noreferrer` are followed and are not blockers - the earlier rounds of this
 * work mis-read that once, so this script prints the distinction.
 *
 * It also looks for the two things an email needs: a mailto: on the page, and a
 * byline with a human name. A page with neither is not a target a cold email
 * can reach, and finding that out here saves the attempt.
 *
 * Usage: node _dev/vet-writer-targets.cjs
 */

const { chromium } = require('playwright-core');

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const TARGETS = [
  {
    id: 'orthogonal-tinypng',
    name: 'orthogonal.info — Best TinyPNG Alternatives',
    url: 'https://orthogonal.info/best-tinypng-alternatives/',
    why: 'independent dev blog, already recommends client-side compressors, has its own local-first tool',
  },
  {
    id: 'orthogonal-benchmark',
    name: 'orthogonal.info — benchmarked 5 compressors',
    url: 'https://orthogonal.info/',
    why: 'their benchmark article was measured earlier as emitting followed links to tools',
  },
  {
    id: 'smashing-tools',
    name: 'Smashing Magazine — Powerful Image Optimization Tools',
    url: 'https://www.smashingmagazine.com/2023/12/powerful-image-optimization-tools/',
    why: 'tools roundup; earlier round found all 5 outbound anchors on it no-rel',
  },
  {
    id: 'compresso-roundup',
    name: 'compresso.io — 10 tools compared',
    url: 'https://compresso.io/blog/best-image-compression-tools-2026',
    why: 'candidate from search; suspected template farm, needs the rel and depth check to confirm',
  },
  {
    id: 'wildandfree-roundup',
    name: 'wildandfreetools.com — 8 compressors tested',
    url: 'https://wildandfreetools.com/blog/best-free-image-compressors-compared',
    why: 'candidate from search; they publish a measured table already, so they may value a stricter one',
  },
];

const BLOCKING = /nofollow|sponsored|ugc/i;

function hostOf(u) {
  try { return new URL(u).host; } catch (e) { return ''; }
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function tally(html, pageHost) {
  const body = stripTags(html);
  const anchors = [...body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi)];
  const links = [];
  for (const m of anchors) {
    const href = m[1];
    if (/^(mailto:|tel:|#)/i.test(href)) continue;
    const h = hostOf(href);
    if (!h) continue;
    const tagOk = m[0].endsWith('>') || /rel\s*=/.test(m[0]);
    const relMatch = m[0].match(/rel\s*=\s*["']([^"']+)["']/i);
    const rel = relMatch ? relMatch[1] : '';
    const relAttrs = rel.toLowerCase().split(/\s+/);
    const blocking = relAttrs.some((r) => BLOCKING.test(r));
    const noopener = relAttrs.includes('noopener');
    const noreferrer = relAttrs.includes('noreferrer');
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    links.push({ href, host: h, external: h !== pageHost, blocking, noopener, noreferrer, text, tagOk });
  }
  return links;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = [];

  for (const t of TARGETS) {
    const row = { id: t.id, name: t.name, url: t.url, why: t.why };
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    let html = '';
    try {
      const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      row.httpStatus = resp ? resp.status() : null;
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) { /* fine */ }
      html = await page.content();
    } catch (e) {
      row.error = String(e.message || e).split('\n')[0].slice(0, 140);
      out.push(row);
      await ctx.close().catch(() => {});
      console.log('!! ' + t.id + ' -> ' + row.error);
      continue;
    }

    const pageHost = hostOf(t.url);
    const links = tally(html, pageHost);
    const ext = links.filter((l) => l.external);
    const blocking = ext.filter((l) => l.blocking);
    const followed = ext.filter((l) => !l.blocking);

    row.httpStatus = row.httpStatus || 0;
    row.totalAnchors = links.length;
    row.externalAnchors = ext.length;
    row.blocking = blocking.length;
    row.followed = followed.length;
    row.blockingRatio = ext.length ? Math.round((blocking.length / ext.length) * 100) + '%' : 'n/a';
    row.sampleFollowed = followed.slice(0, 8).map((l) => l.host);
    row.sampleBlocking = blocking.slice(0, 8).map((l) => l.host);
    row.mailto = (html.match(/mailto:\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i) || [])[1] || null;
    row.byline = (html.match(/<meta[^>]+name\s*=\s*["']author["'][^>]+content\s*=\s*["']([^"']{2,60})["']/i) || [])[1]
      || (html.match(/rel\s*=\s*["']author["'][^>]*href\s*=\s*["'][^"']*\/u\/([A-Za-z0-9_-]+)/i) || [])[1]
      || null;
    row.hasToolDemo = /<input[^>]+type\s*=\s*["']file["']/i.test(html);

    out.push(row);
    await ctx.close().catch(() => {});

    console.log(
      t.id.padEnd(22) +
        ' http=' + row.httpStatus +
        ' ext=' + String(ext.length).padStart(4) +
        ' blocking=' + String(blocking.length).padStart(4) + ' (' + row.blockingRatio + ')' +
        ' followed=' + String(followed.length).padStart(4) +
        (row.mailto ? ' mailto=' + row.mailto : '') +
        (row.byline ? ' byline=' + row.byline : '') +
        (row.hasToolDemo ? ' [has file input]' : '')
    );
    if (followed.length) console.log('      followed -> ' + [...new Set(row.sampleFollowed)].join(', '));
  }

  const fs = require('fs');
  const p = require('path');
  const dir = p.join(__dirname, '.tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const f = p.join(dir, 'writer-targets.json');
  fs.writeFileSync(f, JSON.stringify({ measuredAt: new Date().toISOString(), rows: out }, null, 2));
  console.log('');
  console.log('written: ' + f);
  await browser.close();
})();
