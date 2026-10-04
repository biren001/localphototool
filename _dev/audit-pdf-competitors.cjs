/* audit-pdf-competitors — the PDF-side sister of audit-competitor-pages.cjs.

   v83 put /merge-pdf/ and /compress-pdf/ on the site, so the next gap, if there
   is one, is another PDF intent. The same rule as the image side applies: do
   not count a competitor's total URLs, count how many *intents* they claim,
   because most of these sites multiply by language and the倍数 is noise.

   What this adds over the image-side script: an intent tally. Every sitemap URL
   is matched against the PDF jobs a real person asks for (split, merge,
   compress, rotate, reorder, delete pages, protect, unlock, sign, extract
   images, convert to/from word) so the report answers one question directly:

     which of these intents do the competitors all claim a page for, and which
     one is contested only by new sites rather than by Adobe?

   Run: NODE_PATH=... node _dev/audit-pdf-competitors.cjs          (needs network)
        NODE_PATH=... node _dev/audit-pdf-competitors.cjs --search=split
*/
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const OUT_DIR = path.join(__dirname, 'measured');
const OUT_JSON = path.join(OUT_DIR, 'pdf-competitor-map.json');

const SITES = [
  { name: 'ilovepdf', root: 'https://ilovepdf.com' },
  { name: 'pdf24', root: 'https://www.pdf24.org' },
  { name: 'smallpdf', root: 'https://smallpdf.com' },
  { name: 'sejda', root: 'https://www.sejda.com' },
  { name: 'pdfsam', root: 'https://www.pdfsam.org' },
  { name: 'pdfcandy', root: 'https://pdfcandy.com' },
  { name: 'updf', root: 'https://www.updf.com' },
  { name: 'pdfshaper', root: 'https://www.pdfshaper.com' },
  { name: 'freeconvert', root: 'https://www.freeconvert.com' },
  /* the small ones v83 actually measured: if they still hold a page for an
     intent, that intent is being served by sites with no authority at all. */
  { name: 'merge-papers', root: 'https://merge-papers.com' },
  { name: 'digitaltoolpad', root: 'https://digitaltoolpad.com' },
  { name: 'technosuffice', root: 'https://technosuffice.com' },
  { name: 'pdfguru', root: 'https://pdfguru.online' },
  { name: 'utildaily', root: 'https://utildaily.com' }
];

/* The PDF jobs a person types. Each entry is the thing we might be able to
   answer, and the regex is what a competitor's own URL looks like when they
   claim that job. */
const INTENTS = [
  { key: 'merge', re: /\/merge|\/combine/i },
  { key: 'split', re: /\/split/i },
  { key: 'compress', re: /\/compress|\/shrink/i },
  { key: 'pdf-to-jpg', re: /pdf[-_]?to[-_]?(jpg|jpeg|png|image)|extract[-_]?images/i },
  { key: 'jpg-to-pdf', re: /(jpg|jpeg|png|photo)[-_]?to[-_]?pdf|images[-_]?to[-_]?pdf/i },
  { key: 'rotate', re: /\/rotate/i },
  { key: 'reorder', re: /reorder|re-?order|sort[-_]?pages|\/rearrange/i },
  { key: 'delete-pages', re: /delete[-_]?pages|remove[-_]?pages|\/trim/i },
  { key: 'protect', re: /\/protect|\/encrypt|password[-_]?protect/i },
  { key: 'unlock', re: /\/unlock|\/decrypt/i },
  { key: 'sign', re: /\/sign|signature/i },
  { key: 'to-word', re: /to[-_]?word|\/docx/i },
  { key: 'size-target', re: /(kb|mb)[-_](target|goal|size)|compress[-_]\d|to[-_]\d+(kb|mb)/i }
];

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

async function expand(xml, depth = 0) {
  const l = locs(xml);
  if (!/<sitemapindex/i.test(xml) || depth > 0) return l;
  const out = [];
  for (const child of l.slice(0, 15)) {
    try { out.push(...locs(await get(child))); } catch { /* ignore */ }
  }
  return out.length ? out : l;
}

async function sitemapFor(root) {
  for (const c of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap1.xml']) {
    try {
      const xml = await get(root + c);
      if (!/<urlset|<sitemapindex/i.test(xml)) continue;
      const list = await expand(xml);
      if (list.length) return { via: c, list };
    } catch { /* next */ }
  }
  try {
    const r = await get(root + '/robots.txt');
    const sm = [...r.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    const out = [];
    for (const s of sm.slice(0, 15)) {
      try { out.push(...(await expand(await get(s)))); } catch { /* ignore */ }
    }
    if (out.length) return { via: 'robots.txt', list: out };
  } catch { /* ignore */ }
  return null;
}

(async () => {
  const only = (process.argv.indexOf('--search=') === 0 ? null : null);
  const arg = process.argv.find((a) => a.startsWith('--search='));
  const want = arg ? arg.slice('--search='.length) : null;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), sites: [] };

  for (const s of SITES) {
    const rec = { name: s.name, root: s.root, status: 'FAIL', via: null, total: 0, title: null, intents: {}, examples: {}, top: [] };
    try {
      const sm = await sitemapFor(s.root);
      if (sm) {
        rec.status = 'OK';
        rec.via = sm.via;
        rec.total = sm.list.length;
        rec.intents = {};
        rec.examples = {};
        const segs = {};
        for (const u of sm.list) {
          let p; try { p = new URL(u); } catch { continue; }
          for (const it of INTENTS) {
            if (it.re.test(p.pathname + u)) {
              rec.intents[it.key] = (rec.intents[it.key] || 0) + 1;
              if (!rec.examples[it.key]) rec.examples[it.key] = p.pathname;
            }
          }
          const parts = p.pathname.split('/').filter(Boolean);
          if (!parts.length) { segs['(root)'] = (segs['(root)'] || 0) + 1; continue; }
          const k = parts.length >= 2 ? parts[0] + '/…' : parts[0];
          segs[k] = (segs[k] || 0) + 1;
        }
        rec.top = Object.entries(segs).sort((a, b) => b[1] - a[1]).slice(0, 12);
        const show = want ? [want] : rec.intents && Object.keys(rec.intents).length ? Object.keys(rec.intents) : [];
        rec._show = show;
      }
    } catch { /* keep FAIL */ }
    try {
      const html = await get(s.root + '/');
      const m = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
      if (m) rec.title = m[1].replace(/\s+/g, ' ').trim();
    } catch { /* ignore */ }
    report.sites.push(rec);

    console.log(`\n=== ${rec.name}  [${rec.status}${rec.via ? ' via ' + rec.via : ''}]  total=${rec.total}`);
    if (rec.title) console.log('  title: ' + rec.title);
    const keys = want ? [want] : Object.keys(rec.intents || {});
    for (const k of keys) {
      const n = (rec.intents || {})[k];
      console.log('  ' + String(n || 0).padStart(5) + '  ' + k.padEnd(12) + (n ? '  ' + rec.examples[k] : ''));
    }
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n[saved] ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + e); process.exit(1); });
