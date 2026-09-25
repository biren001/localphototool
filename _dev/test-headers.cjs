/* Serve the site WITH the _headers file applied, then verify the compression
   engine still works — i.e. the CSP does not block the esm.sh WASM codecs,
   the module worker, or blob URLs. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const SITE = path.join(WS_ROOT, 'localphototool');
const PORT = 8804;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json'
};

/* ---- parse Cloudflare Pages _headers ---- */
function parseHeaders(file) {
  const groups = [];
  let cur = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const i = line.indexOf(':');
      if (i > 0 && cur) cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    } else {
      cur = { pattern: line, headers: [] };
      groups.push(cur);
    }
  }
  return groups;
}

function headersFor(urlPath) {
  const groups = parseHeaders(path.join(SITE, '_headers'));
  const out = {};
  for (const g of groups) {
    let hit = false;
    if (g.pattern === '/*') hit = true;
    else if (g.pattern.endsWith('/*')) {
      const base = g.pattern.slice(0, -1);
      hit = urlPath.startsWith(base);
    } else hit = g.pattern === urlPath;
    if (hit) for (const [k, v] of g.headers) out[k] = v;
  }
  return out;
}

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(WS_ROOT, p));
  if (!file.startsWith(path.normalize(WS_ROOT))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, d) => {
    if (e) {
      fs.readFile(path.join(SITE, '404.html'), (e2, d2) => {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(e2 ? 'Not found' : d2);
      });
      return;
    }
    const extra = headersFor(p.startsWith('/localphototool/') ? p.slice('/localphototool'.length) : p);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }, extra));
    res.end(d);
  });
}).listen(PORT, run);

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}
// Non-scoring line. Used when the machine's network — not the site — is what
// failed, so a CDN outage is reported loudly without being graded as a defect.
function info(name, detail) {
  console.log('  note  ' + name + (detail ? '  — ' + detail : ''));
}

function run() {
  (async () => {
    const browser = await chromium.launch({
      executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
    });
    const page = await browser.newPage();
    const violations = [];
    const cspBlocks = [];
    const cdnFailures = [];
    const pageErrors = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy|Refused to/i.test(t)) violations.push(t.slice(0, 200));
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    // Three buckets, because they mean three different things.
    //   violations  — a console CSP message (browsers emit these for inline
    //                 script/style refusals).
    //   cspBlocks   — a request Chromium refused under our own CSP. It arrives
    //                 here, NOT in the console, with errorText exactly 'csp'.
    //                 This is the shape a broken CDN allowlist takes, and it is
    //                 the single most important thing this suite exists to
    //                 catch. Do not fold it into the network bucket.
    //   cdnFailures — net::ERR_*, i.e. the sandbox's network. Grading that as a
    //                 defect trained the eye to ignore this suite.
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (!/esm\.sh|jsdelivr/.test(u)) return;
      const err = (r.failure() && r.failure().errorText) || '';
      if (err === 'csp') cspBlocks.push(u + ' :: ' + err);
      else cdnFailures.push(u + ' :: ' + err);
    });

    const base = 'http://localhost:' + PORT;
    await page.goto(base + '/localphototool/compress/', { waitUntil: 'load' });

    const respHeaders = await page.evaluate(() => 'ok');
    console.log('    served headers probe: ' + respHeaders);

    /* --- does the CSP header actually arrive? --- */
    const probe = await page.evaluate(async (b) => {
      const r = await fetch(b + '/localphototool/compress/');
      const csp = r.headers.get('content-security-policy');
      return { csp: csp ? csp.slice(0, 60) + '…' : null };
    }, base);
    check('CSP header is applied to HTML', !!probe.csp, probe.csp || 'missing');

    /* --- the codecs have to arrive under this CSP ---
       They are deliberately not fetched on page load any more (that billed
       every visitor and raced the format they had picked), so reaching for the
       tool is how a visitor — and now this test — asks for them. The wait has
       to cover the first encode, which compiles the WASM: 12.6s for MozJPEG on
       a cold cache, measured. */
    await page.dispatchEvent('#dropzone', 'pointerdown');
    let status = '';
    const loaded = () => /MozJPEG/i.test(status) && /libwebp/i.test(status);
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1500);
      status = (await page.textContent('#engineStatus')).replace(/\s+/g, ' ').trim();
      if (loaded()) break;
    }

    // One clean retry, but only when the sole problem was the network. A
    // broken CSP produces identical cspBlocks on the retry, so this cannot
    // hide a regression.
    if (!loaded() && violations.length === 0 && cspBlocks.length === 0 && cdnFailures.length > 0) {
      info('CDN unreachable on the first attempt, retrying', cdnFailures[0].slice(0, 90));
      cdnFailures.length = 0;
      await page.goto(base + '/localphototool/compress/', { waitUntil: 'load' });
      await page.dispatchEvent('#dropzone', 'pointerdown');
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(1500);
        status = (await page.textContent('#engineStatus')).replace(/\s+/g, ' ').trim();
        if (loaded()) break;
      }
    }

    const blocked = [...violations, ...cspBlocks];
    if (loaded() && blocked.length === 0) {
      check('WASM codecs loaded under CSP', true, status.slice(0, 110));
    } else if (blocked.length > 0) {
      // The header, not the network. This is the regression the suite guards.
      check('WASM codecs loaded under CSP', false,
        (loaded() ? 'codecs loaded but ' : '') + blocked.length + ' CSP refusal(s) — ' + blocked[0].slice(0, 80));
    } else if (cdnFailures.length > 0) {
      // Not our defect and not verifiable here. Say so instead of scoring it.
      info('WASM codecs could NOT be verified — the CDN is unreachable from this machine',
        cdnFailures.length + ' failed request(s), e.g. ' + cdnFailures[0].slice(0, 80));
      check('the site tried to load the codecs, i.e. the CSP did not refuse them up front',
        !/Refused to/i.test(status), status.slice(0, 110));
    } else {
      // No CSP refusal, no failed request, and still nothing: an engine
      // regression with no network excuse.
      check('WASM codecs loaded under CSP', false, 'no CSP error and no failed request, yet: ' + status.slice(0, 110));
    }

    // Scored separately from the load, so a CDN outage can never mask a real
    // CSP refusal. Catches the case where the codecs happened to load (e.g.
    // from cache) while the header is in fact broken.
    check('nothing was refused by the CSP', blocked.length === 0,
      blocked.length ? blocked[0] : 'clean');

    /* --- actually compress a file --- */
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 900; c.height = 700;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 900, 700);
      g.addColorStop(0, '#4f46e5'); g.addColorStop(1, '#06b6d4');
      x.fillStyle = g; x.fillRect(0, 0, 900, 700);
      x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif';
      x.fillText('CSP TEST', 80, 360);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const buf = new Uint8Array(await blob.arrayBuffer());
      return Array.from(buf);
    });
    const tmp = path.join(WS_ROOT, '_dev', 'out', 'csp-probe.png');
    fs.writeFileSync(tmp, Buffer.from(png));
    await page.setInputFiles('#fileInput', tmp);
    await page.waitForFunction(() => {
      const r = document.querySelector('.result');
      return r && r.querySelector('[data-act="download"]');
    }, { timeout: 90000 });
    const meta = await page.textContent('.result');
    check('compression still works under CSP', /−\d+%|-\d+%/.test(meta), meta.replace(/\s+/g, ' ').slice(0, 110));
    check('no JS errors during the run', pageErrors.length === 0, pageErrors[0] || 'clean');

    await browser.close();
    srv.close();
    const passed = results.filter(Boolean).length;
    // Visible but not scored: a partly degraded CDN still made the codecs
    // arrive, so the CSP is fine — but the next run may not be so lucky.
    if (cdnFailures.length > 0) {
      info('some CDN requests failed but the codecs still loaded',
        cdnFailures.length + ' request(s), e.g. ' + cdnFailures[0].slice(0, 80));
    }

    console.log('\n' + passed + ' / ' + results.length + ' header+functionality checks passed');
    process.exit(passed === results.length ? 0 : 1);
  })().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}
