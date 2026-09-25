#!/usr/bin/env node
/*
 * check-listing-status.cjs — is a directory listing actually worth anything?
 *
 *   node _dev/check-listing-status.cjs <listing-url> [control-url]
 *
 * Written because "the page is there" turned out to mean almost nothing. A
 * listing can answer 200, carry your title, your cover and your tagline, and
 * still be worth exactly zero: `noindex` keeps it out of every index, and the
 * link pointing at your site is `nofollow` on the free tier regardless.
 *
 * Three signals decide it, and none of them is visible from the status code:
 *
 *   1. does the directory's sitemap list this URL?
 *   2. what does the page's own <meta name="robots"> say?
 *   3. what is the `rel` on the link that points at you?
 *
 * Pass a verified/known-good listing on the same site as the control. That is
 * what tells you what verification buys *before* you pay its price — on Tiny
 * Startups it turned out to buy indexability of their page, never a followed
 * link.
 *
 * Every page is rendered in a real browser: Next.js sites answer 200 with an
 * empty shell for unknown slugs, so the HTML alone cannot be trusted.
 */

const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const CHROME =
  process.env.CHROME_PATH ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TARGET = (process.argv.find((a) => a.startsWith('--target=')) || '').split('=')[1] || '';
// The control is a different company, so its own outbound link is not ours to
// look for. Give it its site to judge the control's link-attribute, which is
// the whole point of having a control.
const CONTROL_TARGET = (process.argv.find((a) => a.startsWith('--control-target=')) || '').split('=')[1] || '';
if (!args.length) {
  console.error(
    'usage: node _dev/check-listing-status.cjs <listing-url> [control-url] [--target=yourdomain.com] [--control-target=theirdomain.com]'
  );
  process.exit(2);
}

async function sitemapMembership(url) {
  const origin = new URL(url).origin;
  const out = { sitemap: origin + '/sitemap.xml', listed: null, total: 0, error: null };
  try {
    const r = await fetch(out.sitemap, { headers: { 'user-agent': UA } });
    if (!r.ok) {
      out.error = `HTTP ${r.status}`;
      return out;
    }
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    // a sitemap index points at child sitemaps, which hold the real URLs
    const children = locs.filter((u) => /\.xml(\?|$)/.test(u));
    let all = locs;
    for (const c of children.slice(0, 8)) {
      try {
        const cr = await fetch(c, { headers: { 'user-agent': UA } });
        if (cr.ok) {
          const t = await cr.text();
          all = all.concat([...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()));
        }
      } catch {
        /* a child sitemap that will not load is not fatal to the verdict */
      }
    }
    out.total = all.length;
    const norm = (u) => u.replace(/\/$/, '').replace(/[?#].*$/, '');
    out.listed = all.some((u) => norm(u) === norm(url));
  } catch (e) {
    out.error = e.cause ? e.cause.code || e.cause.message : e.message;
  }
  return out;
}

async function inspect(browser, url) {
  const page = await browser.newPage();
  const result = { url, http: null, title: '', robots: '(none)', canonical: '(none)', links: [], mentions: false, error: null };
  page.on('response', (r) => {
    if (r.url() === url) result.http = r.status();
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);
    result.title = await page.title();
    const meta = await page.evaluate(() => ({
      robots: document.querySelector('meta[name="robots"]')?.content || '(none)',
      canonical: document.querySelector('link[rel="canonical"]')?.href || '(none)',
    }));
    result.robots = meta.robots;
    result.canonical = meta.canonical;
    result.links = await page.evaluate((host) => {
      const here = new URL(host).hostname.replace(/^www\./, '');
      return [...document.querySelectorAll('a')]
        .filter((a) => a.href.startsWith('http') && !new URL(a.href).hostname.replace(/^www\./, '').endsWith(here))
        .map((a) => ({
          // take the hostname first, then compare — filtering on the raw href
          // also matches the ?utm_source=<directory> every link carries
          host: new URL(a.href).hostname.replace(/^www\./, ''),
          rel: a.getAttribute('rel') || '(none)',
          text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
          href: a.href.slice(0, 80),
        }));
    }, url);
    const text = await page.evaluate(() => document.body.innerText || '');
    result.mentions = /localphototool/i.test(text);
    result.excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  } catch (e) {
    result.error = e.message;
  }
  await page.close();
  return result;
}

function report(label, r, sitemap, want) {
  console.log(`\n===== ${label}`);
  console.log(`  ${r.url}`);
  if (r.error) {
    console.log(`  FAILED: ${r.error}`);
    return;
  }
  console.log(`  http          ${r.http}`);
  console.log(`  title         ${r.title}`);
  console.log(`  robots meta   ${r.robots}${/noindex/i.test(r.robots) ? '   <== will never be indexed' : ''}`);
  console.log(`  canonical     ${r.canonical}`);
  console.log(`  in sitemap    ${sitemap.listed === null ? 'unknown (' + sitemap.error + ')' : sitemap.listed ? `YES of ${sitemap.total}` : `NO  (sitemap holds ${sitemap.total} URLs)`}`);
  console.log(`  body starts   ${r.excerpt || '(empty)'}`);

  const byHost = new Map();
  for (const l of r.links) {
    if (!byHost.has(l.host)) byHost.set(l.host, l);
  }
  console.log(`  external anchors: ${r.links.length} across ${byHost.size} host(s)`);

  // The link that matters. Everything else on these pages is the operator's
  // own network — footer directories, partner sites — which is identical on
  // every listing and is not what a submission buys. Print that one first, on
  // its own, or it gets lost in the noise.
  if (want) {
    const t = want.replace(/^www\./, '');
    const mine = r.links.filter((l) => l.host === t || l.host.endsWith('.' + t));
    r.target = t;
    if (!mine.length) {
      console.log(`  link to ${t}: NONE`);
      r.hasTarget = false;
    } else {
      r.hasTarget = true;
      r.targetFollowed = mine.some((l) => !/\bnofollow\b/.test(l.rel));
      for (const l of mine) {
        const nf = /\bnofollow\b/.test(l.rel);
        console.log(`  link to ${t}: rel="${l.rel}"  ${nf ? '<== passes no weight' : '<== FOLLOWED'}`);
        console.log(`     ${l.href}`);
      }
    }
  }

  const followed = [...byHost.values()].filter((l) => !/\bnofollow\b/.test(l.rel));
  console.log(`  other followed links on the page: ${followed.length} (operator's own network — same on every listing, ignore)`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const seen = [];
  try {
    for (const [i, url] of args.entries()) {
      const r = await inspect(browser, url);
      const sm = await sitemapMembership(url);
      const label = i === 0 ? 'subject' : `control #${i}`;
      report(label, r, sm, i === 0 ? TARGET : CONTROL_TARGET);
      seen.push({ label, r, sm });
    }
  } finally {
    await browser.close();
  }

  console.log('\n===== verdict');
  for (const { label, r, sm } of seen) {
    if (r.error) {
      console.log(`  ${label.padEnd(10)} unreadable (${r.error})`);
      continue;
    }
    const indexable = !/noindex/i.test(r.robots);
    const inSitemap = sm.listed === true;
    const t = r.target || 'the target domain';
    let worth;
    if (!indexable && !inSitemap) worth = 'WORTH NOTHING YET — cannot be indexed, cannot be found through search';
    else if (!indexable) worth = 'noindex — offered in the sitemap but barred from indexing';
    else if (r.hasTarget === false) worth = `indexable, but no link to ${t} on the page`;
    else if (r.targetFollowed === true) worth = `FOLLOWED LINK to ${t} — this is the real thing`;
    else if (r.targetFollowed === false) worth = `discovery only — indexable, but the link to ${t} is nofollow`;
    else worth = 'indexable (pass --target= / --control-target= to judge the link)';
    console.log(`  ${label.padEnd(10)} ${worth}`);
  }

  console.log(`
How to read it:
  - in sitemap = NO  -> the directory does not offer this page to search engines
  - robots noindex   -> it cannot rank or be found through search at all
  - link rel=nofollow-> this listing passes no weight, whatever it costs
  A control that is verified and indexable still showing nofollow is the answer
  to "what does verification buy?" — measure that before paying for it.
`);
})();
