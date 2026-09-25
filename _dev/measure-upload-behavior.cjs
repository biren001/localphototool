/**
 * Measures whether online image compressors send your file to a server.
 *
 * Method, and why it is shaped this way:
 *
 * 1. A probe JPEG carries a unique marker in its EXIF. If that byte string
 *    appears in an outbound request body, bytes from the file left the
 *    browser. That is a fact, not an interpretation.
 * 2. The hook runs inside the page and patches fetch, XMLHttpRequest and
 *    sendBeacon, because the browser's own devtools protocol drops large and
 *    streamed request bodies. CDP showed iLoveIMG's multipart upload as 1144
 *    bytes - the wrapper with the file missing - which would have produced a
 *    false "nothing was uploaded".
 * 3. Events are written to sessionStorage, because several tools navigate to
 *    a results page after uploading (iLoveIMG goes to /download/...), and a
 *    new document wipes an in-memory array. Sizes are recorded synchronously
 *    so they survive even if the marker check does not finish first.
 * 4. LocalPhotoTool is measured as a negative control. A probe that cannot
 *    show the marker staying home is not fit to show it leaving.
 *
 * Verdicts are graded. "Inconclusive" is a valid outcome and is preferred
 * over guessing: claiming a tool is private because our automation failed to
 * start it would be a fabrication.
 *
 * Usage
 *   node _dev/measure-upload-behavior.cjs run [site-id ...]
 *   node _dev/measure-upload-behavior.cjs report
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const ROOT = path.resolve(__dirname, '..');
const META = JSON.parse(fs.readFileSync(path.join(ROOT, '_dev/.tmp/probe-meta.json'), 'utf8'));
const PROBE = META.path;
const MARKER = META.marker;
const FILE_BYTES = META.bytes;
const OUT_DIR = path.join(ROOT, '_dev/measured/upload-behavior');

const SITES = [
  { id: 'localphototool', name: 'LocalPhotoTool', url: 'https://localphototool.com/compress/', control: true, click: null },
  { id: 'tinypng',        name: 'TinyPNG',        url: 'https://tinypng.com/', click: null },
  { id: 'squoosh',        name: 'Squoosh',        url: 'https://squoosh.app/', click: null },
  { id: 'iloveimg',       name: 'iLoveIMG',       url: 'https://www.iloveimg.com/compress-image', click: 'Compress IMAGES' },
  { id: 'compressjpeg',   name: 'CompressJPEG',   url: 'https://compressjpeg.com/', click: 'COMPRESS' },
  { id: 'imagecompressor',name: 'ImageCompressor',url: 'https://imagecompressor.com/', click: 'COMPRESS' },
  { id: 'freeconvert',    name: 'FreeConvert',    url: 'https://www.freeconvert.com/image-compressor', click: null },
  { id: 'privateimagecompressor', name: 'Private Image Compressor', url: 'https://privateimagecompressor.com/', click: null },
  { id: 'jpegoptimizer',  name: 'JPEG Optimizer', url: 'https://www.jpeg-optimizer.com/', click: 'COMPRESS' },
];

// Endpoints whose very name implies receiving a file. Deliberately excludes
// generic words like "process", which local-only tools also use.
const UPLOAD_URL = /\/upload|\/store|\/chunk|\/opt\/|\/files?\b|\/image-upload/i;

function hook(marker) {
  const KEY = '__lpt_events';
  window.__lptLoad = function () {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  };
  window.__lptSave = function (arr) {
    try { sessionStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) { /* quota */ }
  };
  if (!window.__lptInstalled) {
    window.__lptInstalled = true;

    const hasMarker = (buf) => {
      if (!buf || !buf.byteLength) return false;
      const view = new Uint8Array(buf);
      const needle = new TextEncoder().encode(marker);
      outer:
      for (let i = 0; i + needle.length <= view.length; i++) {
        for (let j = 0; j < needle.length; j++) if (view[i + j] !== needle[j]) continue outer;
        return true;
      }
      return false;
    };

    // Sizes are synchronous (Blob.size, FormData file sizes) so they survive
    // a navigation that happens before the async marker read completes.
    function describe(body) {
      const out = { kind: 'none', bytes: 0, marker: null };
      if (body == null) return out;
      if (typeof body === 'string') { out.kind = 'string'; out.bytes = body.length; out.marker = body.indexOf(marker) !== -1; return out; }
      if (body instanceof URLSearchParams) { const s = body.toString(); out.kind = 'usp'; out.bytes = s.length; out.marker = s.indexOf(marker) !== -1; return out; }
      if (body instanceof ArrayBuffer) { out.kind = 'arraybuffer'; out.bytes = body.byteLength; out.marker = hasMarker(body); return out; }
      if (ArrayBuffer.isView(body)) { out.kind = 'view'; out.bytes = body.byteLength; out.marker = hasMarker(body.buffer); return out; }
      if (typeof Blob !== 'undefined' && body instanceof Blob) {
        out.kind = 'blob'; out.bytes = body.size;
        return { out: out, later: body.arrayBuffer().then((b) => { out.marker = hasMarker(b); }).catch(() => {}) };
      }
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        out.kind = 'formdata'; out.parts = [];
        const pending = [];
        for (const [k, v] of body.entries()) {
          if (typeof v === 'string') {
            out.parts.push({ key: k, kind: 'string', bytes: v.length, marker: v.indexOf(marker) !== -1 });
          } else {
            const p = { key: k, kind: 'file', name: v.name || null, bytes: v.size || 0, marker: null };
            out.parts.push(p);
            pending.push(v.arrayBuffer().then((b) => { p.marker = hasMarker(b); }).catch(() => {}));
          }
        }
        out.bytes = out.parts.reduce((s, p) => s + (p.bytes || 0), 0);
        return { out: out, later: Promise.all(pending).then(() => { out.marker = out.parts.some((p) => p.marker); }) };
      }
      if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) { out.kind = 'stream'; return { out: out }; }
      out.kind = 'unknown:' + Object.prototype.toString.call(body);
      return { out: out };
    }

    const push = (url, method, body) => {
      try {
        const rec = { url: String(url), method: method, ts: Date.now(), seq: window.__lptSeq = (window.__lptSeq || 0) + 1 };
        const desc = describe(body);
        rec.body = desc.out;
        const arr = window.__lptLoad();
        arr.push(rec);
        window.__lptSave(arr);
        if (desc.later) desc.later.then(() => { const a = window.__lptLoad(); const hit = a.find((x) => x.seq === rec.seq); if (hit) { hit.body = desc.out; window.__lptSave(a); } });
      } catch (e) { /* never break the site we are measuring */ }
    };

    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      try { const u = typeof input === 'string' ? input : (input && input.url); push(u, (init && init.method) || 'GET', init && init.body); } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    const os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (b) { try { push(this.__u || '(xhr)', this.__m || '(xhr)', b); } catch (e) {} return os.apply(this, arguments); };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { try { this.__m = m; this.__u = u; } catch (e) {} return oo.apply(this, arguments); };
    if (navigator.sendBeacon) {
      const ob = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (u, d) { try { push(u, 'BEACON', d); } catch (e) {} return ob(u, d); };
    }
  }
}

async function trySubmit(page, wanted) {
  const clicked = [];
  const cands = page.locator('button, input[type=submit], a[class*="btn" i], [role=button]');
  const n = await cands.count();
  for (let i = 0; i < n; i++) {
    const el = cands.nth(i);
    let text = '';
    try { text = ((await el.innerText({ timeout: 1200 })) || '').trim(); } catch (e) { continue; }
    if (!text || text.length > 40) continue;
    // "Start Over" is not a start button. Clicking it reset one tool and
    // produced a false negative.
    if (/\b(over|again|reset|clear|new|another|download|save)\b/i.test(text)) continue;
    const ok = wanted ? new RegExp(wanted, 'i').test(text)
                      : /^(compress|optimize|optimise|reduce|start|go|process)\b/i.test(text);
    if (!ok) continue;
    try { await el.click({ timeout: 4000 }); clicked.push(text); await page.waitForTimeout(1500); break; } catch (e) { /* keep looking */ }
  }
  return clicked;
}

async function measure(browser, site) {
  const ctx = await browser.newContext({ acceptDownloads: true, ignoreHTTPSErrors: true });
  await ctx.addInitScript(hook, MARKER);
  const page = await ctx.newPage();

  const net = [];
  page.on('request', (r) => {
    const h = r.headers();
    net.push({ url: r.url(), method: r.method(), type: r.resourceType(), contentLength: Number(h['content-length'] || 0) });
  });
  let downloads = 0;
  page.on('download', () => { downloads++; });

  const result = {
    id: site.id, name: site.name, url: site.url, control: !!site.control,
    measuredAt: new Date().toISOString(),
    probe: { marker: MARKER, bytes: FILE_BYTES, sha256: META.sha256, path: 'generated per run, see gen-probe-image.py' },
    ok: false,
  };

  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    const n = await page.locator('input[type=file]').count();
    result.fileInputsFound = n;
    if (n === 0) {
      result.status = 'no-file-input';
    } else {
      await page.locator('input[type=file]').first().setInputFiles(PROBE, { timeout: 20000 });
      result.fileSet = true;
      await page.waitForTimeout(2000);
      result.clicked = await trySubmit(page, site.click);
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) { await page.waitForTimeout(1000); if (downloads > 0) break; }
      result.downloads = downloads;
      result.ok = true;
      result.status = downloads > 0 ? 'completed-with-download' : 'completed';
    }
  } catch (e) {
    result.error = String(e.message || e).slice(0, 300);
    result.status = 'error';
  }

  // Read hook events out of every frame, and fall back to sessionStorage so
  // results survive the post-upload navigation.
  const events = [];
  for (const f of page.frames()) {
    try {
      const arr = await f.evaluate(() => (window.__lptLoad ? window.__lptLoad() : []));
      if (Array.isArray(arr)) events.push(...arr);
    } catch (e) { /* frame gone */ }
  }
  result.hookEvents = events;

  const bodies = events.filter((e) => e.body && e.body.bytes > 0);
  const markerHits = bodies.filter((e) => e.body.marker === true);
  const maxPayload = bodies.reduce((m, e) => Math.max(m, e.body.bytes), 0);
  const uploadEndpoint = events.filter((e) => e.method !== 'GET' && UPLOAD_URL.test(e.url));

  let snippet = '';
  try { snippet = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500)); } catch (e) { /* navigated */ }
  result.pageSnippet = snippet;

  const kb1000 = Math.round(FILE_BYTES / 1000);
  const kb1024 = (FILE_BYTES / 1024).toFixed(2);
  const ingestShown = /probe/i.test(snippet)
    || new RegExp(kb1024.replace('.', '\\.') + '\\s?KB', 'i').test(snippet)
    || new RegExp(kb1000 + '\\s?kB', 'i').test(snippet);

  result.evidence = {
    requestsSeen: net.length,
    hookEvents: events.length,
    bodiesWithBytes: bodies.length,
    markerHits: markerHits.length,
    markerHitUrls: markerHits.map((e) => e.url),
    maxPayloadBytes: maxPayload,
    fileSizedPayload: maxPayload >= FILE_BYTES * 0.5,
    uploadEndpointCalls: uploadEndpoint.length,
    uploadEndpointUrls: [...new Set(uploadEndpoint.map((e) => e.url))].slice(0, 5),
    largestPayloads: bodies.sort((a, b) => b.body.bytes - a.body.bytes).slice(0, 5)
      .map((e) => ({ bytes: e.body.bytes, kind: e.body.kind, marker: e.body.marker, url: e.url })),
    ingestShown,
    downloadFired: downloads > 0,
    finalUrl: page.url(),
  };

  const ev = result.evidence;
  if (ev.markerHits > 0) result.verdict = 'server-side';
  else if (ev.fileSizedPayload) result.verdict = 'server-side';
  else if (ev.uploadEndpointCalls > 0 && ev.ingestShown) result.verdict = 'server-side';
  else if (ev.ingestShown && ev.uploadEndpointCalls === 0 && !ev.fileSizedPayload) result.verdict = 'local';
  else result.verdict = 'inconclusive';

  result.confidence = ev.markerHits > 0 ? 'high'
    : (ev.fileSizedPayload || (ev.uploadEndpointCalls > 0 && ev.ingestShown)) ? 'high'
    : ev.ingestShown ? 'medium' : 'low';

  await ctx.close();
  return result;
}

async function main() {
  const mode = process.argv[2] || 'run';
  const only = process.argv.slice(3);
  const sites = only.length ? SITES.filter((s) => only.includes(s.id)) : SITES;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (mode === 'report') {
    const rows = [];
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
      rows.push(j);
    }
    rows.sort((a, b) => (b.control ? 1 : 0) - (a.control ? 1 : 0) || a.name.localeCompare(b.name));
    for (const j of rows) {
      const e = j.evidence || {};
      console.log(j.name.padEnd(26) + (j.control ? '[CONTROL] ' : '').padEnd(11)
        + String(j.verdict || '?').padEnd(14)
        + 'conf=' + String(j.confidence || '?').padEnd(7)
        + 'marker=' + e.markerHits
        + ' maxBody=' + e.maxPayloadBytes
        + ' uploadEp=' + e.uploadEndpointCalls
        + ' ingest=' + (e.ingestShown ? 'Y' : 'N'));
      (e.uploadEndpointUrls || []).forEach((u) => console.log('      -> ' + u.slice(0, 100)));
      (e.largestPayloads || []).slice(0, 2).forEach((p) => console.log('      ' + p.bytes + 'B ' + p.kind + ' marker=' + p.marker + '  ' + p.url.slice(0, 80)));
    }
    return;
  }

  const browser = await chromium.launch({ executablePath: EXE });
  for (const site of sites) {
    const r = await measure(browser, site);
    fs.writeFileSync(path.join(OUT_DIR, r.id + '.json'), JSON.stringify(r, null, 2));
    const e = r.evidence || {};
    console.log('=== ' + r.name + (r.control ? ' [CONTROL]' : ''));
    console.log('   status :', r.status, r.error ? '| ' + r.error : '');
    console.log('   clicked:', JSON.stringify(r.clicked || []), '| finalUrl:', (e.finalUrl || '').slice(0, 70));
    console.log('   marker :', e.markerHits, '| maxBody:', e.maxPayloadBytes, '| uploadEp:', e.uploadEndpointCalls, '| ingest:', e.ingestShown);
    console.log('   VERDICT:', r.verdict, '(confidence ' + r.confidence + ')');
    (e.uploadEndpointUrls || []).forEach((u) => console.log('       -> ' + u.slice(0, 100)));
    console.log('');
  }
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
