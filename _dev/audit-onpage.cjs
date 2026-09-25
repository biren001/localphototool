/* On-page SEO/GEO audit, run against the local files that get deployed.
   Reading the tree rather than the live site means the result does not depend
   on a flaky outbound link, and it audits exactly what the next zip will carry.

   Reports per page: title, meta description, h1 count, visible word count,
   JSON-LD types, internal links, canonical, og tags, image alt coverage.
   Flags anything that is a known ranking-relevant gap rather than a preference. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'localphototool');

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function strip(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
}

function textOf(html) {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  const t = strip(body)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

function jsonLdTypes(html) {
  const types = new Set();
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    let j;
    try {
      j = JSON.parse(m[1]);
    } catch {
      types.add('INVALID_JSON');
      continue;
    }
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o['@type']) [].concat(o['@type']).forEach((t) => types.add(t));
      if (o['@graph']) walk(o['@graph']);
    };
    walk(j);
  }
  return [...types];
}

const files = htmlFiles(ROOT).sort();
const rows = [];

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const rel = '/' + path.relative(ROOT, f).replace(/\\/g, '/');
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const metaDesc =
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [, ''])[1] ||
    (html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [, ''])[1];
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').trim()
  );
  const text = textOf(html);
  const words = text.split(/\s+/).filter(Boolean).length;
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) || [
    ,
    '',
  ])[1];
  const hasOg = /property=["']og:(title|description|image)["']/i.test(html);
  const ogUrlTags = [...html.matchAll(/property=["']og:url["'][^>]+content=["']([^"']*)["']/gi)].map(
    (m) => m[1]
  );
  const ogTitleCount = (html.match(/property=["']og:title["']/gi) || []).length;
  // Signature of a page cloned from /privacy/ whose shared footer link was never
  // rewritten: a "Privacy" label resolving to "./" lands on the page you are on.
  const selfPrivacyLink = /href=["']\.\/["'][^>]*>\s*Privacy\s*</i.test(html);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imgsMissingAlt = imgs.filter((s) => !/\balt\s*=/i.test(s)).length;
  const internal = [...html.matchAll(/href=["'](?!https?:|mailto:|#)([^"'#]+)["']/g)].map(
    (m) => m[1]
  );
  const types = jsonLdTypes(html);
  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].length;
  const lang = (html.match(/<html[^>]*\slang=["']([^"']*)["']/i) || [, ''])[1];
  // A page can tell the reader that code, data or a repository is published.
  // If it links no code host, the reader has nowhere to go: the claim is
  // unverifiable, which is the one thing these pages cannot afford to be.
  const codeHosts = [
    ...html.matchAll(
      /href=["']https?:\/\/(?:www\.)?(?:github|gitlab|codeberg)\.(?:com|org)[^"']*["']/gi
    ),
  ];
  const claimsPublished = /\b(repository|source code|open[- ]sourced?)\b/i.test(text);

  rows.push({
    rel,
    title,
    titleLen: [...title].length,
    desc: metaDesc,
    descLen: [...metaDesc].length,
    h1: h1s.length,
    h2,
    words,
    canonical: canonical ? canonical.replace(/^https:\/\/localphototool\.com/, '') : '',
    types,
    internal: internal.length,
    hasOg,
    ogUrlTags,
    ogTitleCount,
    selfPrivacyLink,
    claimsPublished,
    codeHosts: codeHosts.length,
    imgTotal: imgs.length,
    imgNoAlt: imgsMissingAlt,
    lang,
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad('page', 32) + pad('title', 6) + pad('desc', 6) + pad('h1', 4) + pad('h2', 4) +
  pad('words', 7) + pad('links', 7) + 'schema'
);
console.log('-'.repeat(110));
for (const r of rows) {
  console.log(
    pad(r.rel, 32) +
      pad(r.titleLen, 6) +
      pad(r.descLen, 6) +
      pad(r.h1, 4) +
      pad(r.h2, 4) +
      pad(r.words, 7) +
      pad(r.internal, 7) +
      (r.types.join(',') || '—')
  );
}

console.log('\n=== GAPS (things known to matter, not preferences) ===');
const gaps = [];
for (const r of rows) {
  if (!r.desc) gaps.push(`${r.rel}: no meta description`);
  else if (r.descLen < 70) gaps.push(`${r.rel}: meta description only ${r.descLen} chars (aim 120-158)`);
  else if (r.descLen > 165) gaps.push(`${r.rel}: meta description ${r.descLen} chars (will be truncated)`);
  if (r.titleLen > 60) gaps.push(`${r.rel}: title ${r.titleLen} chars (truncated in SERPs)`);
  if (r.h1 !== 1) gaps.push(`${r.rel}: ${r.h1} h1 (want exactly 1)`);
  if (r.words < 300) gaps.push(`${r.rel}: only ${r.words} visible words — thin page`);
  if (r.imgNoAlt > 0) gaps.push(`${r.rel}: ${r.imgNoAlt}/${r.imgTotal} images without alt`);
  if (!r.lang) gaps.push(`${r.rel}: no lang attribute on <html>`);
  if (!r.canonical) gaps.push(`${r.rel}: no canonical`);
  if (r.claimsPublished && r.codeHosts === 0) {
    gaps.push(
      `${r.rel}: body mentions a repository / source code but links no code host ` +
        `(a claim the reader cannot follow)`
    );
  }
  if (r.canonical) {
    // og:url must be unique and agree with canonical — a duplicated head block
    // (typical when a page is cloned from a template) silently sends social
    // previews and canonical signals to a different URL.
    const expectedOgUrl = 'https://localphototool.com' + r.canonical;
    if (r.ogUrlTags.length !== 1) {
      gaps.push(`${r.rel}: ${r.ogUrlTags.length} og:url tags (want exactly 1)`);
    } else if (r.ogUrlTags[0] !== expectedOgUrl) {
      gaps.push(`${r.rel}: og:url is ${r.ogUrlTags[0]} but canonical is ${expectedOgUrl}`);
    }
    if (r.ogTitleCount !== 1) {
      gaps.push(`${r.rel}: ${r.ogTitleCount} og:title tags (want exactly 1)`);
    }
    // On /privacy/ itself, "./" is the correct target, so only other pages can be wrong.
    if (r.selfPrivacyLink && r.canonical !== '/privacy/') {
      gaps.push(`${r.rel}: a "Privacy" link points at this page itself ("./" not "../privacy/")`);
    }
  }
}

const noSchema = rows.filter((r) => r.types.length === 0);
if (noSchema.length) gaps.push(`no JSON-LD at all on: ${noSchema.map((r) => r.rel).join(', ')}`);

const siteWide = {
  BreadcrumbList: rows.filter((r) => r.types.includes('BreadcrumbList')).length,
  Organization: rows.filter((r) => r.types.includes('Organization')).length,
  WebSite: rows.filter((r) => r.types.includes('WebSite')).length,
  SoftwareApplication: rows.filter((r) => r.types.includes('SoftwareApplication')).length,
  WebApplication: rows.filter((r) => r.types.includes('WebApplication')).length,
  FAQPage: rows.filter((r) => r.types.includes('FAQPage')).length,
  HowTo: rows.filter((r) => r.types.includes('HowTo')).length,
  ImageObject: rows.filter((r) => r.types.includes('ImageObject')).length,
};
console.log('\nschema coverage across ' + rows.length + ' pages:');
for (const [k, v] of Object.entries(siteWide)) console.log(`  ${pad(k, 22)} ${v}`);

console.log('\n' + (gaps.length ? gaps.map((g) => '  - ' + g).join('\n') : '  none'));
console.log(`\n${gaps.length} gap(s) across ${rows.length} pages`);
