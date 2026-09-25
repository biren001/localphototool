'use strict';
/*
Two questions, both measurable, both raised by the three pages Google crawled and
declined to index:

  1. Is a held-back page near-identical to a sibling? Shared nav and footer would
     make every page look alike, so only the <main> region is compared.
  2. How many internal links point at it? A page nothing links to is a page
     Google has no reason to prefer.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'localphototool');
const SKIP = new Set(['404.html', 'offline.html', 'stats/index.html']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function pageUrl(file) {
  let rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  return '/' + rel.replace(/index\.html$/, '');
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mainRegion(html) {
  const open = html.search(/<main\b/i);
  if (open === -1) return html;
  const close = html.lastIndexOf('</main>');
  return close > open ? html.slice(open, close) : html.slice(open);
}

const files = walk(ROOT).filter((f) => !SKIP.has(path.relative(ROOT, f).split(path.sep).join('/')));
const pages = files.map((f) => {
  const html = fs.readFileSync(f, 'utf8');
  const main = mainRegion(html);
  const text = stripTags(main).toLowerCase();
  return { file: f, url: pageUrl(f), html, text };
});

console.log(`pages: ${pages.length}\n`);

/* ---------- 1. unique-content similarity ---------- */

function shingles(text, n = 5) {
  const w = text.split(' ').filter(Boolean);
  const s = new Set();
  for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
  return s;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

for (const p of pages) p.sh = shingles(p.text);

console.log('--- unique <main> text, and the closest sibling ---');
console.log('page'.padEnd(38) + 'words'.padStart(7) + '   closest');
for (const p of pages) {
  let best = null;
  for (const q of pages) {
    if (q === p) continue;
    const j = jaccard(p.sh, q.sh);
    if (!best || j > best.j) best = { j, url: q.url };
  }
  console.log(`${p.url.padEnd(38)}${String(p.text.split(' ').length).padStart(7)}   ${(best.j * 100).toFixed(1)}%  ${best.url}`);
}

/* ---------- 2. inbound internal links, chrome vs body ---------- */
/*
The first run showed exactly 12 inbound links for every page, which is the shape
of a shared template rather than of editorial linking. Google discounts
site-wide nav and footer links, so the count that matters is how many links sit
inside <main> — a link a human placed while writing the page.
*/
const inbound = new Map();
const inboundBody = new Map();
for (const p of pages) {
  inbound.set(p.url, []);
  inboundBody.set(p.url, []);
}

function resolve(p, href) {
  if (/^(https?:|mailto:|#|data:|tel:)/i.test(href)) return null;
  let target;
  if (href.startsWith('/')) target = href;
  else target = path.posix.join(p.url === '/' ? '/' : p.url, href);
  target = path.posix.normalize(target.split('#')[0].split('?')[0]);
  if (!target.endsWith('/') && !/\.(html|xml|txt|png|jpg|svg|webp|js|css|json|ico|webmanifest)$/i.test(target)) {
    target += '/';
  }
  return target;
}

for (const p of pages) {
  const body = mainRegion(p.html);
  const seen = new Set();
  const seenBody = new Set();

  for (const m of p.html.matchAll(/href="([^"]+)"/g)) {
    const target = resolve(p, m[1]);
    if (!target || target === p.url || !inbound.has(target) || seen.has(target)) continue;
    seen.add(target);
    inbound.get(target).push(p.url);
  }
  for (const m of body.matchAll(/href="([^"]+)"/g)) {
    const target = resolve(p, m[1]);
    if (!target || target === p.url || !inboundBody.has(target) || seenBody.has(target)) continue;
    seenBody.add(target);
    inboundBody.get(target).push(p.url);
  }
}

console.log('\n--- inbound links: all vs inside <main> only ---');
console.log('page'.padEnd(38) + 'all'.padStart(5) + 'body'.padStart(6) + '   body links come from');
const rows = [...inbound.entries()].sort((a, b) => inboundBody.get(b[0]).length - inboundBody.get(a[0]).length);
for (const [url] of rows) {
  const all = inbound.get(url).length;
  const body = inboundBody.get(url);
  console.log(`${url.padEnd(38)}${String(all).padStart(5)}${String(body.length).padStart(6)}   ${body.join(', ') || '(navigation and footer only)'}`);
}

const thin = ['/compress-photos-for-email/', '/png-to-jpg/', '/share/'];
console.log('\n--- the three Google held back ---');
for (const u of thin) {
  const from = inbound.get(u) || [];
  const body = inboundBody.get(u) || [];
  console.log(`\n  ${u}`);
  console.log(`    inbound: ${from.length} total, ${body.length} from inside <main>`);
  console.log(`    body link sources: ${body.join(', ') || '(none — nav and footer only)'}`);
  const p = pages.find((x) => x.url === u);
  if (p) {
    console.log(`    main words: ${p.text.split(' ').length}`);
    const others = pages.filter((x) => x !== p).map((x) => ({ url: x.url, j: jaccard(p.sh, x.sh) })).sort((a, b) => b.j - a.j).slice(0, 3);
    for (const o of others) console.log(`    ${(o.j * 100).toFixed(1)}% like ${o.url}`);
  }
}
process.exit(0);
