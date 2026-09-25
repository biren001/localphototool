/* Google Search Console API client.
 *
 *   node _dev/gsc-api.cjs auth            one-time: print the consent URL, catch the code
 *   node _dev/gsc-api.cjs sites           list properties you can see
 *   node _dev/gsc-api.cjs queries         real search queries (days default 28)
 *   node _dev/gsc-api.cjs inspect         index verdict for every sitemap URL
 *   node _dev/gsc-api.cjs submit-sitemap  re-submit the sitemap (idempotent)
 *
 * There is deliberately no npm dependency and no SDK: every endpoint is a plain
 * fetch against the paths read out of the published discovery document, so this
 * stays runnable without touching the environment.
 *
 * What this can NOT do: nothing here can request indexing. urlInspection is
 * read-only, and the separate Indexing API only accepts JobPosting and
 * BroadcastEvent pages. "Request indexing" stays a manual click in Search
 * Console — which matters, because guessing otherwise wastes an afternoon.
 *
 * Credentials live in _dev/.tmp/ (git-ignored). Nothing prints in full. */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, '_dev', '.tmp');
const OUT = path.join(ROOT, '_dev', 'measured');
const CRED = path.join(TMP, 'gsc-oauth.json');
const TOKEN = path.join(TMP, 'gsc-token.json');

const SCOPE = 'https://www.googleapis.com/auth/webmasters';
const REDIRECT_PORT = 8765;
const REDIRECT_URI = 'http://127.0.0.1:' + REDIRECT_PORT + '/';
const API = 'https://searchconsole.googleapis.com/';
const HOST = 'localphototool.com';

/* ---------------------------------------------------------------- plumbing */

function fingerprint(s) {
  return s ? s.slice(0, 4) + '…****** (' + s.length + ' chars)' : '(missing)';
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Measured 2026-09-24: this network reaches Google's API hosts only some of the
   time — the discovery document went 3/3 and then 0/4 within half an hour.
   Every call retries, because a single failure here means nothing. */
async function fetchRetry(url, opts, tries) {
  tries = tries || 4;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      return r;
    } catch (e) {
      last = e;
      const code = (e.cause && e.cause.code) || e.code || e.message;
      await sleep(800 * Math.pow(2, i));
      if (i === tries - 1) throw new Error('network gave up after ' + tries +
        ' tries (' + code + ') — this is the known flaky window, not bad credentials');
    }
  }
  throw last;
}

async function call(pathname, creds, body, method) {
  let token = creds.access_token;
  const headers = Object.assign({ Authorization: 'Bearer ' + token },
    body ? { 'Content-Type': 'application/json' } : {});
  let r = await fetchRetry(API + pathname, {
    method: method || (body ? 'POST' : 'GET'),
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  }, 4);
  if (r.status === 401) {
    token = await refreshAccessToken(creds);
    headers.Authorization = 'Bearer ' + token;
    r = await fetchRetry(API + pathname, {
      method: method || (body ? 'POST' : 'GET'),
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }, 4);
  }
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text.slice(0, 400) }; }
  return { status: r.status, data: json };
}

/* ------------------------------------------------------------------- auth */

async function loadCreds() {
  const c = readJson(CRED);
  if (!c || !c.client_id || !c.client_secret) {
    console.log('missing ' + CRED);
    console.log('write it as: { "client_id": "...apps.googleusercontent.com",');
    console.log('              "client_secret": "GOCSPX-..." }');
    process.exit(2);
  }
  return c;
}

async function saveToken(t) {
  fs.mkdirSync(TMP, { recursive: true });
  const merged = Object.assign(readJson(TOKEN) || {}, t);
  merged.obtained_at = new Date().toISOString();
  fs.writeFileSync(TOKEN, JSON.stringify(merged, null, 1), 'utf8');
}

async function cmdAuth() {
  const c = await loadCreds();
  console.log('client_id     ' + fingerprint(c.client_id));
  console.log('client_secret ' + fingerprint(c.client_secret));

  const params = new URLSearchParams({
    client_id: c.client_id,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent'
  });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();

  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.searchParams.get('code')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8"><p style="font:16px sans-serif">Authorised. You can close this tab.</p>');
        const value = u.searchParams.get('code');
        setTimeout(() => { srv.close(); resolve(value); }, 50);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8"><p>' + (u.searchParams.get('error') || 'no code in callback') + '</p>');
      }
    });
    srv.on('error', (e) => reject(new Error('cannot listen on ' + REDIRECT_PORT + ': ' + e.code)));
    srv.listen(REDIRECT_PORT, '127.0.0.1', () => {
      console.log('\nOpen this in your browser (the one that can reach Google):\n');
      console.log('  ' + url + '\n');
      console.log('Waiting for the callback on ' + REDIRECT_URI + ' …');
      console.log('Think "Google has not verified this app" → Advanced → Continue. That is normal for your own client.');
    });
    setTimeout(() => { try { srv.close(); } catch (e) {} reject(new Error('timed out waiting 10 min for consent')); }, 600000);
  });

  console.log('\ngot the code, exchanging it for tokens…');
  const body = new URLSearchParams({
    code: code,
    client_id: c.client_id,
    client_secret: c.client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  });
  const r = await fetchRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }, 4);
  const j = await r.json();
  if (!j.access_token) {
    console.log('FAIL HTTP ' + r.status + '  ' + JSON.stringify(j).slice(0, 400));
    process.exit(1);
  }
  await saveToken({ access_token: j.access_token, refresh_token: j.refresh_token, scope: j.scope });
  console.log('OK  access token saved; refresh token ' +
    (j.refresh_token ? 'present, later runs need no browser' : 'ABSENT — authorization will not survive the hour'));
}

async function refreshAccessToken(creds) {
  const c = await loadCreds();
  if (!creds.refresh_token) throw new Error('no refresh token — run: node _dev/gsc-api.cjs auth');
  const body = new URLSearchParams({
    client_id: c.client_id,
    client_secret: c.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token'
  });
  const r = await fetchRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }, 4);
  const j = await r.json();
  if (!j.access_token) throw new Error('refresh failed: ' + JSON.stringify(j).slice(0, 300));
  saveToken({ access_token: j.access_token, refresh_token: creds.refresh_token });
  return j.access_token;
}

async function authorised() {
  const t = readJson(TOKEN);
  if (!t || !t.access_token) {
    console.log('not authorised yet — run: node _dev/gsc-api.cjs auth');
    process.exit(2);
  }
  return t;
}

/* A property is either https://example.com/ or sc-domain:example.com, and every
   endpoint takes that exact string. Guessing it wrong returns empty data rather
   than an error, so it is always read from sites.list instead. */
async function pickSite(creds) {
  const r = await call('webmasters/v3/sites', creds);
  if (r.status !== 200) {
    console.log('sites.list failed HTTP ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 300));
    process.exit(1);
  }
  const entries = (r.data.siteEntry || []).filter((s) => s.siteUrl.indexOf(HOST) !== -1);
  if (!entries.length) {
    console.log('no property matching ' + HOST + ' under this account. Visible properties:');
    (r.data.siteEntry || []).forEach((s) => console.log('  ' + s.siteUrl + '  ' + s.permissionLevel));
    process.exit(1);
  }
  return entries[0].siteUrl;
}

/* -------------------------------------------------------------- commands */

async function cmdSites() {
  const creds = await authorised();
  const r = await call('webmasters/v3/sites', creds);
  console.log('HTTP ' + r.status);
  (r.data.siteEntry || []).forEach((s) => {
    console.log('  ' + s.siteUrl.padEnd(44) + s.permissionLevel);
  });
}

async function cmdQueries(days, rows) {
  const creds = await authorised();
  const site = await pickSite(creds);
  const end = new Date(Date.now() - 3 * 86400000);   // GSC data lags ~2-3 days
  const start = new Date(end.getTime() - days * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  console.log('property  ' + site);
  console.log('window    ' + iso(start) + ' → ' + iso(end) + '  (' + days + 'd, ending 3 days back for latency)');

  const body = {
    startDate: iso(start),
    endDate: iso(end),
    dimensions: ['query'],
    rowLimit: rows,
    type: 'web'
  };
  const r = await call('webmasters/v3/sites/' + encodeURIComponent(site) + '/searchAnalytics/query',
    creds, body);
  if (r.status !== 200) {
    console.log('FAIL HTTP ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 500));
    process.exit(1);
  }
  const rowList = r.data.rows || [];
  if (!rowList.length) {
    console.log('\nno rows — normal for a property this young. Nothing here is a bug.');
    return;
  }
  console.log('\n' + rowList.length + ' queries\n');
  console.log('  clicks  impress    ctr   pos   query');
  rowList.forEach((q) => {
    console.log('  ' + String(q.clicks).padStart(6) + String(q.impressions).padStart(9) +
      (100 * q.ctr).toFixed(2).padStart(7) + '%' + q.position.toFixed(1).padStart(6) + '   ' + q.keys[0]);
  });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'gsc-queries-' + iso(new Date()) + '.json');
  fs.writeFileSync(file, JSON.stringify({ siteUrl: site, window: [iso(start), iso(end)], rows: rowList }, null, 1), 'utf8');
  console.log('\nwrote ' + file);
}

async function cmdInspect() {
  const creds = await authorised();
  const site = await pickSite(creds);
  const sm = fs.readFileSync(path.join(ROOT, 'localphototool', 'sitemap.xml'), 'utf8');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log('property ' + site + ' — ' + urls.length + ' URLs from the local sitemap\n');

  let pass = 0, partial = 0, fail = 0;
  const rows = [];
  for (const u of urls) {
    const r = await call('v1/urlInspection/index:inspect', creds,
      { inspectionUrl: u, siteUrl: site });
    if (r.status !== 200) {
      console.log('  ERR  ' + u + '  HTTP ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 200));
      fail++;
      continue;
    }
    const idx = (r.data.inspectionResult || {}).indexStatusResult || {};
    const v = idx.verdict || 'VERDICT_UNSPECIFIED';
    if (v === 'PASS') pass++;
    else if (v === 'PARTIAL') partial++;
    else fail++;
    rows.push({
      url: u,
      verdict: v,
      coverageState: idx.coverageState,
      robotsTxt: idx.robotsTxtState,
      indexingState: idx.indexingState,
      lastCrawlTime: idx.lastCrawlTime,
      googleCanonical: idx.googleCanonical
    });
    console.log('  ' + v.padEnd(9) + (idx.coverageState || '').padEnd(34) + u.replace('https://' + HOST, ''));
    await sleep(150);   // 600/min per property; be polite rather than sorry
  }
  console.log('\nPASS ' + pass + '  PARTIAL ' + partial + '  other ' + fail + '  (of ' + urls.length + ')');
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'gsc-index-status-' + new Date().toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(file, JSON.stringify({ siteUrl: site, rows: rows }, null, 1), 'utf8');
  console.log('wrote ' + file);
}

async function cmdSubmitSitemap() {
  const creds = await authorised();
  const site = await pickSite(creds);
  const feed = 'https://' + HOST + '/sitemap.xml';
  const r = await call('webmasters/v3/sites/' + encodeURIComponent(site) +
    '/sitemaps/' + encodeURIComponent(feed), creds, null, 'PUT');
  console.log('HTTP ' + r.status + '  ' + JSON.stringify(r.data).slice(0, 300));
  console.log(r.status === 204 || r.status === 200
    ? 'sitemap re-submitted (idempotent — safe to repeat after every deploy)'
    : 'unexpected status');
}

/* ------------------------------------------------------------------ main */

(async () => {
  const cmd = process.argv[2] || 'sites';
  const days = Number((process.argv.find((a) => a.startsWith('--days=')) || '--days=28').split('=')[1]);
  const rows = Number((process.argv.find((a) => a.startsWith('--rows=')) || '--rows=250').split('=')[1]);
  try {
    if (cmd === 'auth') return await cmdAuth();
    if (cmd === 'sites') return await cmdSites();
    if (cmd === 'queries') return await cmdQueries(days, rows);
    if (cmd === 'inspect') return await cmdInspect();
    if (cmd === 'submit-sitemap') return await cmdSubmitSitemap();
    console.log('unknown command: ' + cmd);
    console.log('usage: node _dev/gsc-api.cjs auth | sites | queries | inspect | submit-sitemap');
  } catch (e) {
    console.log('\nERROR ' + e.message);
    if (/network gave up/.test(e.message)) {
      console.log('Try again later: Google reachability from this machine comes and goes in windows.');
    }
    process.exit(1);
  }
})();
