'use strict';
/**
 * 竞品页面地图 —— 不依赖 Google 的「竞品反查」替代方案。
 * 做法：读竞品 sitemap + 首页 title，统计它们铺了哪些路径/意图类型，
 *       再和本站 13 页对照，找出「意图缺口」。
 * 用法：node _dev/audit-competitor-pages.cjs
 */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const OUT_DIR = path.join(__dirname, 'measured');
const OUT_JSON = path.join(OUT_DIR, 'competitor-page-map.json');

const SITES = [
  { name: 'iloveimg',        root: 'https://www.iloveimg.com' },
  { name: 'tinypng',         root: 'https://tinypng.com' },
  { name: 'imagecompressor', root: 'https://imagecompressor.com' },
  { name: 'freeconvert',     root: 'https://www.freeconvert.com' },
  { name: 'picresize',       root: 'https://www.picresize.com' },
  { name: 'compressjpeg',    root: 'https://compressjpeg.com' },
  { name: 'jpeg-optimizer',  root: 'https://jpeg-optimizer.com' },
  { name: 'bulkresizephotos',root: 'https://bulkresizephotos.com' },
  { name: 'squoosh',         root: 'https://squoosh.app' },
  { name: 'compresss',       root: 'https://www.imgcompress.com' },
];

async function get(url, asText = true) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return asText ? await res.text() : res;
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
  for (const c of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap1.xml', '/sitemap_index.xml.gz']) {
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

function shape(list) {
  const hosts = {};
  const segs = {};
  for (const u of list) {
    let p;
    try { p = new URL(u); } catch { continue; }
    hosts[p.host] = (hosts[p.host] || 0) + 1;
    const parts = p.pathname.split('/').filter(Boolean);
    if (!parts.length) { segs['(root)'] = (segs['(root)'] || 0) + 1; continue; }
    const k = parts.length >= 2 ? `${parts[0]}/…(${parts.length}层)` : parts[0];
    segs[k] = (segs[k] || 0) + 1;
  }
  return { hosts, segs };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), sites: [] };

  for (const s of SITES) {
    const rec = { name: s.name, root: s.root, status: 'FAIL', via: null, total: 0, title: null, top: [], sample: [] };
    try {
      const sm = await sitemapFor(s.root);
      if (sm) {
        rec.status = 'OK';
        rec.via = sm.via;
        rec.total = sm.list.length;
        const { segs } = shape(sm.list);
        rec.top = Object.entries(segs).sort((a, b) => b[1] - a[1]).slice(0, 18);
        // 找 size/target 型落地页（compress-to-XXXkb 一类）
        rec.sample = sm.list.filter((u) => /(kb|mb|target|size)/i.test(u)).slice(0, 12);
      }
    } catch { /* keep FAIL */ }
    try {
      const html = await get(s.root + '/');
      const m = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
      if (m) rec.title = m[1].replace(/\s+/g, ' ').trim();
    } catch { /* ignore */ }

    report.sites.push(rec);

    console.log(`\n=== ${rec.name}  [${rec.status}${rec.via ? ' via ' + rec.via : ''}]  total=${rec.total}`);
    if (rec.title) console.log(`  title: ${rec.title}`);
    if (rec.top.length) {
      console.log('  路径形态 top:');
      for (const [k, v] of rec.top) console.log(`    ${String(v).padStart(6)}  ${k}`);
    }
    if (rec.sample.length) {
      console.log('  含 size/target 的 URL 抽样:');
      for (const u of rec.sample) console.log(`    ${u}`);
    }
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[saved] ${OUT_JSON}`);
})();
