// Verify the SEO batch changes on localphototool source.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, 'localphototool');
let fail = 0;
const bad = m => { fail++; console.log('  ✗ ' + m); };
const good = m => console.log('  ✓ ' + m);

function fileFor(urlPath) {
  const clean = urlPath.replace(/^https?:\/\/localphototool\.com/, '').split('?')[0];
  if (clean === '/' || clean === '') return path.join(ROOT, 'index.html');
  return path.join(ROOT, clean, 'index.html');
}

function checkPage(rel) {
  const p = path.join(ROOT, rel);
  const html = fs.readFileSync(p, 'utf8');
  const label = rel;

  // JSON-LD parse
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let graph = [];
  ld.forEach((m, i) => {
    try { const parsed = JSON.parse(m[1]); graph = graph.concat(parsed['@graph'] || [parsed]); }
    catch (e) { bad(label + ' JSON-LD block ' + i + ' invalid: ' + e.message); }
  });
  if (ld.length && !fail) good(label + ' JSON-LD valid (' + graph.length + ' nodes)');

  // meta description length
  const dm = html.match(/<meta name="description" content="([^"]*)"/);
  if (!dm) bad(label + ' no meta description');
  else {
    const len = dm[1].length;
    if (len > 165) bad(label + ' meta description too long: ' + len);
    else good(label + ' meta description ' + len + ' chars');
  }

  // canonical
  const cm = html.match(/<link rel="canonical" href="([^"]*)"/);
  if (!cm) bad(label + ' no canonical');
  else good(label + ' canonical ' + cm[1]);

  // required schemas for tool pages
  const types = graph.map(n => n['@type']).join(',');
  const isToolPage = /compress|heic|png-to-jpg|jpg-to-webp/.test(rel);
  if (isToolPage && !types.includes('BreadcrumbList')) bad(label + ' missing BreadcrumbList');
  if (isToolPage && !types.includes('FAQPage')) console.log('  ℹ ' + label + ' has no FAQPage schema (informational)');
  if (isToolPage && !types.includes('WebPage')) console.log('  ℹ ' + label + ' has no WebPage node (informational)');

  // internal links resolve
  const links = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map(m => m[1]);
  for (const l of links) {
    if (/^(https?:|mailto:|data:|#)/.test(l)) continue;
    const target = path.resolve(path.dirname(p), l.split('#')[0]);
    if (!fs.existsSync(target)) bad(label + ' broken ref: ' + l);
  }

  // target input matches data defaults on tool pages
  const defaults = html.match(/data-compressor-defaults='([^']*)'/);
  const input = html.match(/id="targetKB"[^>]*value="(\d+)"/);
  if (defaults && input) {
    const d = JSON.parse(defaults[1]);
    if (d.targetKB != null) {
      if (String(d.targetKB) !== input[1]) bad(label + ' targetKB mismatch: data=' + d.targetKB + ' input=' + input[1]);
      else good(label + ' targetKB consistent (' + d.targetKB + ')');
    } else good(label + ' targetKB default (200, no data override)');
  }
  return { html, graph };
}

console.log('=== Pages ===');
const pages = ['index.html', 'compress/index.html', 'heic-to-jpg/index.html', 'png-to-jpg/index.html',
  'jpg-to-webp/index.html', 'compress-to-100kb/index.html', 'compress-to-50kb/index.html',
  'compress-to-200kb/index.html', 'compress-photos-for-email/index.html', 'about/index.html',
  'privacy/index.html', 'terms/index.html', 'share/index.html'];
for (const rel of pages) checkPage(rel);

console.log('=== Sitemap ↔ files ===');
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const urls = [...sm.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
for (const u of urls) {
  const f = fileFor(u);
  if (!fs.existsSync(f)) bad('sitemap URL has no file: ' + u);
  else if (pages.indexOf(path.relative(ROOT, f).replace(/\\/g, '/')) === -1 && path.relative(ROOT, f) !== 'index.html')
    bad('sitemap URL not in check list (ok if intentional): ' + u);
}
good('sitemap has ' + urls.length + ' URLs, all resolve to files');

console.log('=== Footer cross-links ===');
for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const u of ['compress-to-50kb/', 'compress-to-200kb/', 'compress-photos-for-email/', 'compress-to-100kb/']) {
    if (!html.includes(u)) bad(rel + ' footer missing ' + u);
  }
}
good('footer links checked on ' + pages.length + ' pages');

console.log('=== CSP ===');
for (const f of ['_worker.js', '_headers']) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!t.includes('static.cloudflareinsights.com')) bad(f + ' CSP missing cloudflareinsights');
  else good(f + ' CSP allows Cloudflare Web Analytics');
}

console.log('=== llms.txt ===');
const llms = fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8');
for (const u of ['compress-to-50kb', 'compress-to-200kb', 'compress-photos-for-email']) {
  if (!llms.includes(u)) bad('llms.txt missing ' + u);
}
good('llms.txt lists all new pages');

console.log(fail ? '\n✗ ' + fail + ' problem(s) found' : '\n✓ All checks passed');
process.exit(fail ? 1 : 0);
