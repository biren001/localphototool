#!/usr/bin/env node
/**
 * audit-social.cjs — distribution readiness audit.
 *
 * Rationale: when you post a link to Reddit / X / Hacker News / a directory,
 * the platform scrapes Open Graph tags. A page with a missing or relative
 * og:image renders as a bare grey link, which measurably kills click-through.
 * So before any distribution push, every shareable page must carry a complete,
 * ABSOLUTE-url OG + Twitter card set, a canonical, and a sane title length.
 *
 * Read-only: fetches live pages, prints a table, asserts exit code.
 * Usage: node _dev/audit-social.cjs [base-url]
 */
const BASE = process.argv[2] || 'https://localphototool.com';

const PAGES = [
  '/', '/compress/', '/heic-to-jpg/', '/compress-to-100kb/', '/png-to-jpg/',
  '/jpg-to-webp/', '/share/', '/about/', '/privacy/', '/terms/',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const attr = (html, tag, key, val) => {
  const re = new RegExp(`<meta[^>]+${key}=["']${tag}["'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  const c = m[0].match(new RegExp(`${val}=["']([^"']*)["']`, 'i'));
  return c ? c[1] : '';
};
const metaName = (h, n) => attr(h, n, 'name', 'content');
const metaProp = (h, p) => attr(h, p, 'property', 'content');
const linkRel = (h, r) => {
  const m = h.match(new RegExp(`<link[^>]+rel=["']${r}["'][^>]*>`, 'i'));
  if (!m) return null;
  const c = m[0].match(/href=["']([^"']*)["']/i);
  return c ? c[1] : '';
};
const title = (h) => decode((h.match(/<title[^>]*>([^<]*)<\/title>/i) || [, ''])[1]).trim();

// Length must be measured AFTER entity decoding: raw HTML counts "&amp;" as
// five characters, which once produced a phantom "title too long" failure.
const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&nbsp;/g, ' ')
  .replace(/&hellip;/g, '\u2026').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, hx) => String.fromCharCode(parseInt(hx, 16)));

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log(`  PASS  ${m}${d ? '  ' + d : ''}`); };
const no = (m, d = '') => { fail++; console.log(`  FAIL  ${m}${d ? '  ' + d : ''}`); };

// The sandbox network occasionally drops a connection (Cloudflare edge from CN
// is flaky in bursts). Retry beats reporting a phantom failure.
async function fetchRetry(url, init = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) } });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}

async function get(path) {
  const res = await fetchRetry(BASE + path, { redirect: 'follow' });
  return { status: res.status, html: await res.text() };
}

(async () => {
  console.log(`Social / sharing metadata audit — ${BASE}\n`);

  const ogImages = new Set();
  for (const path of PAGES) {
    const { status, html } = await get(path);
    if (status !== 200) { no(`${path} loads`, `status ${status}`); continue; }

    const t = title(html);
    const ogT = decode(metaProp(html, 'og:title'));
    const ogD = decode(metaProp(html, 'og:description'));
    const ogU = metaProp(html, 'og:url');
    const ogI = metaProp(html, 'og:image');
    const ogTt = metaProp(html, 'og:type');
    const tw = metaName(html, 'twitter:card');
    const twI = metaName(html, 'twitter:image');
    const can = linkRel(html, 'canonical');

    const problems = [];
    if (!t || t.length < 15) problems.push(`title too short (${t.length})`);
    else if (t.length > 65) problems.push(`title too long for SERP (${t.length})`);
    else if (t.length > 60) console.log(`  note  ${path} title is ${t.length} chars — may truncate in Google`);
    if (!ogT) problems.push('og:title');
    if (!ogD || ogD.length < 50) problems.push(`og:description ${ogD ? ogD.length : 0} chars`);
    if (!ogU) problems.push('og:url');
    if (ogU && !ogU.startsWith('https://')) problems.push('og:url not absolute');
    if (!ogI) problems.push('og:image');
    else if (!ogI.startsWith('https://')) problems.push('og:image NOT ABSOLUTE (no preview when shared)');
    if (!ogTt) problems.push('og:type');
    if (!tw) problems.push('twitter:card');
    // If a page has an og:image but no twitter:image, X falls back to og:image
    // (fine); a missing og:image is what actually breaks the preview.
    if (!twI && !ogI) problems.push('twitter:image');
    if (!can) problems.push('canonical');
    if (can && !can.startsWith('https://')) problems.push('canonical not absolute');

    // og:title should not duplicate the page title verbatim on tool pages — it
    // should lead with the action, but this is a note, not a failure.
    if (ogI) ogImages.add(ogI);
    if (problems.length === 0) ok(`${path} has a complete share card`, `og:image ok`);
    else no(`${path} has a complete share card`, problems.join(', '));
  }

  // Distinct og:image values across pages: one shared cover everywhere is
  // acceptable, but per-page covers win more clicks on directories.
  ok(`og:image values in use`, `${ogImages.size} distinct across ${PAGES.length} pages`);

  // The image itself must actually resolve, otherwise the scrape is a 404.
  for (const url of ogImages) {
    try {
      const r = await fetchRetry(url, { method: 'GET' });
      const len = Buffer.byteLength(await r.text(), 'utf8');
      const ct = r.headers.get('content-type') || '';
      r.status === 200 && /image\//.test(ct)
        ? ok(`og:image resolves`, `${url.replace(BASE, '')}  ${ct}  ${(len / 1024).toFixed(0)} KB`)
        : no(`og:image resolves`, `${url} → ${r.status} ${ct}`);
      // Scrapers (X, Slack, iMessage) refuse covers above ~5 MB and slow ones.
      // 200 KB is our own budget so previews stay fast.
      if (len > 300 * 1024) no(`og:image stays under 300 KB`, `${(len / 1024).toFixed(0)} KB — scrapers may skip it`);
      else ok(`og:image stays under 300 KB`, `${(len / 1024).toFixed(0)} KB`);
    } catch (e) { no(`og:image resolves`, `${url} → ${e.message}`); }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
