#!/usr/bin/env node
/* deploy-cf.js — localphototool.com 的 Cloudflare Pages Direct Upload 自动发布
 *
 * 用法：
 *   node _dev/deploy-cf.js                 # 正式部署（读 _dev/.env.local）
 *   node _dev/deploy-cf.js --precheck      # 真凭据预检：项目名大小写精确匹配 + 归属闸门
 *   node _dev/deploy-cf.js --hostcheck     # 纯离线归属自检（不需要 token）
 *   node _dev/deploy-cf.js --dry-run       # 假凭据：验证连通 + 认证错误解析（应得到 [9106]）
 *   node _dev/deploy-cf.js --selftest      # multipart 构造离线回环自检
 *   node _dev/deploy-cf.js --deps          # 列最近部署（排查第一步）
 *   node _dev/deploy-cf.js --rollback=<id前8位|latest-good>
 *   --force                                # 部署冲突时加 ?force=true 重试
 *
 * 协议（四步，见 skill：cloudflare-pages-deploy-verify）：
 *   1) GET  upload-token → JWT
 *   2) POST /pages/assets/upload   (JWT)  [{key,value(base64),metadata,base64}]
 *   3) POST /pages/assets/upsert-hashes (JWT)
 *   4) POST deployments (API Token, multipart, 只含 manifest；value=md5 hex；key 带前导 /)
 * 判定以「上传后 GET deployments 列表里出现的新 id」为准（坑 L），探针不过自动回滚。
 */

'use strict';
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'localphototool');
const ENV_FILE = path.join(__dirname, '.env.local');
const RESULT_FILE = path.join(__dirname, '.tmp', 'deploy-cf-result.json');
const API_HOST = 'api.cloudflare.com';
const EXPECT_HOST_DEFAULT = 'localphototool.com';

/* ------------------------------------------------------------------ utils */
const mask = t => (t ? t.slice(0, 4) + '…(len ' + t.length + ')' : '(missing)');
const CONN_ERR = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|socket hang up|timeout|truncat|CONN|aborted/i;

function httpReq({ method, path: reqPath, headers = {}, body = null, host = API_HOST, timeoutMs = 300000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, method, path: reqPath, headers, timeout: timeoutMs }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout after ' + timeoutMs + 'ms')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function rawWithRetry(opts, tries = 4) {
  let cap = tries, lastErr = null;
  for (let i = 1; i <= cap; i++) {
    try { return await httpReq(opts); }
    catch (e) {
      lastErr = e;
      const msg = (e && e.message) || String(e);
      if (!CONN_ERR.test(msg)) throw e;
      cap = tries + 6;                       // 连接级错误：续命重试（坑 F）
      await new Promise(r => setTimeout(r, Math.min(4000, 800 * i)));
    }
  }
  throw lastErr;
}

/* API 调用：解析失败必须带状态码抛错（坑：静默吃成 null 会把 401 报成 TypeError） */
async function apiJson(opts, tries = 4) {
  const r = await rawWithRetry(opts, tries);
  let json;
  try { json = JSON.parse(r.buf.toString('utf8')); }
  catch (e) {
    throw new Error('响应不是 JSON（HTTP ' + r.status + '）：' + r.buf.toString('utf8').slice(0, 200));
  }
  if (json.errors && json.errors.length) {
    const msg = json.errors.map(e => '[' + e.code + '] ' + e.message).join('; ');
    if (r.status >= 400) {
      const err = new Error(msg + ' (status: ' + r.status + ')');
      err.parsedCf = true;
      throw err;
    }
    console.log('  ⚠ CF errors: ' + msg);
  }
  if (r.status >= 500) throw new Error('HTTP ' + r.status + '（服务端错误，可重试）');
  return json;
}

/* ------------------------------------------------------------- env / creds */
function loadEnv() {
  const env = Object.assign({}, process.env);
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

function readCreds(env, { allowFake = false } = {}) {
  const c = {
    accountId: env.CF_ACCOUNT_ID,
    token: env.CF_API_TOKEN,
    project: env.CF_PAGES_PROJECT,
    expectHost: env.CF_EXPECT_HOST || EXPECT_HOST_DEFAULT,
  };
  if (allowFake) return c;
  const missing = [];
  if (!c.accountId) missing.push('CF_ACCOUNT_ID');
  if (!c.token) missing.push('CF_API_TOKEN');
  if (!c.project) missing.push('CF_PAGES_PROJECT');
  if (missing.length) {
    console.error('缺少凭据（写 ' + ENV_FILE + '，格式 KEY=VALUE 每行一条）：');
    missing.forEach(k => console.error('  ' + k));
    process.exit(2);
  }
  console.log('凭据：account=' + c.accountId + ' token=' + mask(c.token) + ' project=' + c.project);
  return c;
}

/* -------------------------------------------------------- ownership gates */
function sitemapHostMode() {
  const s = fs.readFileSync(path.join(SITE_DIR, 'sitemap.xml'), 'utf8');
  const hosts = {};
  for (const m of s.matchAll(/<loc>(.*?)<\/loc>/g)) {
    const h = new URL(m[1]).hostname;
    hosts[h] = (hosts[h] || 0) + 1;
  }
  const sorted = Object.entries(hosts).sort((a, b) => b[1] - a[1]);
  return { mode: sorted[0][0], counts: sorted };
}

function hostcheck(project) {
  const { mode, counts } = sitemapHostMode();
  console.log('sitemap 域名众数：' + mode + '（' + counts.map(c => c[0] + '=' + c[1]).join(', ') + '）');
  let ok = true;
  if (mode !== EXPECT_HOST_DEFAULT) { console.error('FAIL: 产物域名众数 ≠ ' + EXPECT_HOST_DEFAULT); ok = false; }
  if (mode.toLowerCase().indexOf(String(project).toLowerCase()) === -1) {
    console.error('FAIL: 项目名「' + project + '」不出现在产物域名里。若确认无误，请在 .env.local 显式写 CF_EXPECT_HOST=' + mode);
    ok = false;
  }
  console.log(ok ? 'hostcheck PASS' : 'hostcheck FAIL');
  return ok;
}

async function listProjects(c) {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const j = await apiJson({
      method: 'GET',
      path: '/client/v4/accounts/' + c.accountId + '/pages/projects?page=' + page + '&per_page=10',
      headers: { Authorization: 'Bearer ' + c.token },
    });
    const r = j.result || [];
    out.push(...r);
    if (r.length < 10) break;
  }
  return out;
}

/* --------------------------------------------------------------- packaging */
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json', '.txt': 'text/plain',
  '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '': 'application/octet-stream',
};

function collectFiles() {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.DS_Store' || e.name === 'Thumbs.db') continue;
      const r = rel ? rel + '/' + e.name : e.name;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, r);
      else out.push({ rel: r, abs: p, size: fs.statSync(p).size });
    }
  })(SITE_DIR, '');
  return out.map(f => {
    const buf = fs.readFileSync(f.abs);
    return {
      key: '/' + f.rel.replace(/\\/g, '/'),     // 🔴 key 必须带前导斜杠（坑 K）
      hash: crypto.createHash('md5').update(buf).digest('hex'),  // 🔴 md5，不是 sha256
      type: MIME[path.extname(f.rel).toLowerCase()] || MIME[''],
      buf,
    };
  });
}

function splitBuckets(files) {
  const buckets = []; let cur = [], curBytes = 0;
  for (const f of files) {
    const wire = Math.ceil(f.size * 4 / 3) + 256;
    if (cur.length && (curBytes + wire > 40 * 1024 * 1024 || cur.length >= 1000)) {
      buckets.push(cur); cur = []; curBytes = 0;
    }
    cur.push(f); curBytes += wire;
  }
  if (cur.length) buckets.push(cur);
  return buckets;
}

/* -------------------------------------------------------------- multipart */
function buildForm(manifest) {
  const boundary = '----lptform' + crypto.randomBytes(12).toString('hex');
  const parts = [];
  parts.push(Buffer.from('--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="manifest"\r\n\r\n' +
    JSON.stringify(manifest) + '\r\n'));
  const tail = Buffer.from('--' + boundary + '--\r\n');
  return { body: Buffer.concat([...parts, tail]), contentType: 'multipart/form-data; boundary=' + boundary };
}

/* ------------------------------------------------------------ deploy steps */
async function getUploadToken(c) {
  const j = await apiJson({
    method: 'GET',
    path: '/client/v4/accounts/' + c.accountId + '/pages/projects/' + c.project + '/upload-token',
    headers: { Authorization: 'Bearer ' + c.token },
  });
  if (!j.result || !j.result.jwt) throw new Error('拿不到 upload-token：' + JSON.stringify(j).slice(0, 200));
  return j.result.jwt;
}

async function uploadBucket(jwt, bucket) {
  const payload = bucket.map(f => ({
    key: f.key, value: f.buf.toString('base64'),
    metadata: { contentType: f.type }, base64: true,
  }));
  const body = Buffer.from(JSON.stringify(payload));
  return apiJson({
    method: 'POST', path: '/client/v4/pages/assets/upload',
    headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json', 'Content-Length': body.length },
    body,
  }, 5);
}

async function upsertHashes(jwt, hashes) {
  const body = Buffer.from(JSON.stringify({ hashes }));
  return apiJson({
    method: 'POST', path: '/client/v4/pages/assets/upsert-hashes',
    headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json', 'Content-Length': body.length },
    body,
  });
}

async function createDeployment(c, manifest, force) {
  const { body, contentType } = buildForm(manifest);
  const q = force ? '?force=true' : '';
  const r = await rawWithRetry({
    method: 'POST',
    path: '/client/v4/accounts/' + c.accountId + '/pages/projects/' + c.project + '/deployments' + q,
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': contentType, 'Content-Length': body.length },
    body,
  }, 3);
  // 坑 L：响应可能丢了，但部署已经建好 → 这里只报原文，不据此下结论
  let j = null;
  try { j = JSON.parse(r.buf.toString('utf8')); } catch (e) { /* fallthrough */ }
  if (!j) return { ok: false, note: 'POST 响应不可解析（HTTP ' + r.status + '）——不代表没建成，交给 settle 判定' };
  if (j.errors && j.errors.length) {
    const msg = j.errors.map(e => '[' + e.code + '] ' + e.message).join('; ');
    return { ok: false, note: msg + ' (HTTP ' + r.status + ')', retryableForce: /deployment.*(progress|conflict)|8000006/i.test(msg) };
  }
  return { ok: true, id: j.result && j.result.id };
}

async function getDeploymentDetail(c, depId) {
  return apiJson({
    method: 'GET',
    path: '/client/v4/accounts/' + c.accountId + '/pages/projects/' + c.project + '/deployments/' + depId,
    headers: { Authorization: 'Bearer ' + c.token },
  });
}

async function listDeployments(c, perPage = 10) {
  const j = await apiJson({
    method: 'GET',
    path: '/client/v4/accounts/' + c.accountId + '/pages/projects/' + c.project + '/deployments?per_page=' + perPage,
    headers: { Authorization: 'Bearer ' + c.token },
  });
  return j.result || [];
}

async function rollback(c, depId) {
  const r = await rawWithRetry({
    method: 'POST',
    path: '/client/v4/accounts/' + c.accountId + '/pages/projects/' + c.project + '/deployments/' + depId + '/rollback',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Length': 0 },
  }, 3);
  console.log('rollback HTTP ' + r.status + ': ' + r.buf.toString('utf8').slice(0, 160));
  return r.status >= 200 && r.status < 300;
}

/* ------------------------------------------------------------------ probe */
async function probeUrl(url, tries = 4) {
  try {
    const u = new URL(url);
    const r = await rawWithRetry({ method: 'GET', path: u.pathname + u.search, host: u.hostname }, tries);
    return { status: r.status, len: r.buf.length };
  } catch (e) { return { status: 0, err: (e && e.message) || String(e) }; }
}

async function probeDeployment(depUrl, files, manifestKeys) {
  const probes = ['/', '/sw.js', '/favicon.ico']
    .filter(k => manifestKeys.has(k) || k === '/')
    .map(k => depUrl.replace(/\/$/, '') + k);
  if (probes.length < 3) {
    const extra = manifestKeys.size ? [...manifestKeys].slice(0, 3 - probes.length) : [];
    probes.push(...extra.map(k => depUrl.replace(/\/$/, '') + k));
  }
  const results = [];
  for (const u of probes) {
    const r = await probeUrl(u);
    results.push({ url: u, ...r });
    console.log('  探针 ' + u + ' → ' + (r.status === 200 ? '200 (' + r.len + 'B)' : (r.status || 'ERR') + (r.err ? ' ' + r.err : '')));
  }
  return { ok: results.every(x => x.status === 200 && x.len > 0), results };
}

/* ----------------------------------------------------------------- settle */
async function settle(c, ctx) {
  // 坑 L：判定以列表里的「新部署 id」为准，不管 POST 响应说什么
  const deps = await listDeployments(c, 5);
  const newDep = deps.find(d => !ctx.knownIds.has(d.id));
  if (!newDep) {
    return { deployed: false, note: 'POST 未送达（线上未变动），重跑即可' };
  }
  console.log('发现新部署：' + newDep.id + '（' + (newDep.environment || '?') + '）');
  // 轮询到部署完成（最多 ~100s）
  let det = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 5000));
    det = await getDeploymentDetail(c, newDep.id);
    const st = det.result.latest_stage || {};
    if (st.status === 'success' || st.status === 'failure') break;
    console.log('  部署中… ' + (st.name || '?') + ':' + (st.status || '?'));
  }
  const latest = det.result.latest_stage || {};
  if (latest.status !== 'success') {
    console.error('部署未成功（' + latest.name + ':' + latest.status + '）');
    if (ctx.prevCanonical) {
      console.log('自动回滚到 ' + ctx.prevCanonical);
      await rollback(c, ctx.prevCanonical);
    }
    return { deployed: true, depId: newDep.id, ok: false, note: '部署阶段失败，已回滚' };
  }
  const detFull = det.result;
  const depUrl = detFull.url || (detFull.short_id ? 'https://' + detFull.short_id + '.' + c.project + '.pages.dev' : null);
  const manifestKeys = new Set(Object.keys(ctx.manifest));
  const probe = await probeDeployment(depUrl, detFull.files || {}, manifestKeys);
  if (!probe.ok) {
    console.error('探针不过（整站可能不可服务）→ 自动回滚到 ' + ctx.prevCanonical);
    if (ctx.prevCanonical) await rollback(c, ctx.prevCanonical);
    return { deployed: true, depId: newDep.id, ok: false, depUrl, probe: probe.results, note: '探针失败，已回滚' };
  }
  return { deployed: true, depId: newDep.id, ok: true, depUrl, probe: probe.results };
}

/* ------------------------------------------------------------- full deploy */
async function deploy(c, force) {
  const t0 = Date.now();
  // 归属闸门（离线部分先跑）
  if (!hostcheck(c.project)) process.exit(1);

  // gate 1：项目名大小写精确匹配（上传前拦住打错字母）
  const projects = await listProjects(c);
  const names = projects.map(p => p.name);
  if (!names.includes(c.project)) {
    console.error('FAIL: 项目「' + c.project + '」不在账户里。实际项目：\n  ' + names.join('\n  '));
    process.exit(1);
  }
  console.log('项目名精确匹配 PASS（共 ' + names.length + ' 个项目）');

  const files = collectFiles();
  const manifest = {};
  files.forEach(f => { manifest[f.key] = f.hash; });
  const over = files.filter(f => f.size > 25 * 1024 * 1024);
  if (over.length) { console.error('FAIL: 单文件超 25MiB：' + over.map(f => f.key).join(', ')); process.exit(1); }
  console.log('待传：' + files.length + ' 个文件，' + (files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(2) + ' MB，分 ' + splitBuckets(files).length + ' 桶');

  // 上传前的 canonical = 回滚目标
  const depsBefore = await listDeployments(c, 5);
  const knownIds = new Set(depsBefore.map(d => d.id));
  const prevCanonical = (projects.find(p => p.name === c.project).canonical_deployment || {}).id || null;
  console.log('回滚目标（上传前 canonical）：' + prevCanonical);

  const jwt = await getUploadToken(c);
  console.log('upload-token OK ' + mask(jwt));

  const buckets = splitBuckets(files);
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    console.log('上传桶 ' + (i + 1) + '/' + buckets.length + '（' + b.length + ' 文件）…');
    const r = await uploadBucket(jwt, b);
    if (!r.success) throw new Error('assets/upload 失败：' + JSON.stringify(r).slice(0, 200));
  }
  for (let i = 0; i < buckets.length; i++) {
    const r = await upsertHashes(jwt, buckets[i].map(f => f.hash));
    if (!r.success) throw new Error('upsert-hashes 失败：' + JSON.stringify(r).slice(0, 200));
  }
  console.log('资产已入库（' + buckets.reduce((s, b) => s + b.length, 0) + ' 文件）');

  let dep = await createDeployment(c, manifest, force);
  if (!dep.ok && dep.retryableForce && !force) {
    console.log('部署冲突，用 --force 语义重试一次…');
    dep = await createDeployment(c, manifest, true);
  }
  if (dep.note) console.log('create-deployment: ' + dep.note);

  const res = await settle(c, { knownIds, prevCanonical, manifest });
  res.project = c.project;
  res.files = files.length;
  res.durationSec = Math.round((Date.now() - t0) / 1000);
  res.time = new Date().toISOString();
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(res, null, 2));
  console.log('结果文件：' + RESULT_FILE);
  if (res.ok) {
    console.log('\n✅ 上线成功：' + res.depUrl + '（' + res.durationSec + 's，' + res.files + ' 文件）');
    console.log('   建议：跑 node _dev/check-live.cjs 做全站 75 项复核 + IndexNow 推改动页');
  } else if (res.deployed) {
    console.error('\n❌ 新部署有问题：' + (res.note || '') + '（已回滚则线上未受影响）');
    process.exit(1);
  } else {
    console.error('\n⚠ ' + res.note + ' —— 重跑本脚本即可');
    process.exit(1);
  }
}

/* --------------------------------------------------------------- selftest */
function selftest() {
  const fake = [
    { key: '/index.html', buf: Buffer.from('<html>hi</html>'), type: 'text/html' },
    { key: '/assets/js/a.js', buf: Buffer.from('console.log(1)'), type: 'application/javascript' },
    { key: '/深/路径 x.png', buf: crypto.randomBytes(2048), type: 'image/png' },
  ];
  const manifest = {};
  fake.forEach(f => { manifest[f.key] = crypto.createHash('md5').update(f.buf).digest('hex'); });
  const { body, contentType } = buildForm(manifest);
  const boundary = /boundary=(.+)$/.exec(contentType)[1];

  const server = require('http').createServer((req, res) => { res.setHeader('content-type', contentType); res.end(body); });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    http.get({ host: '127.0.0.1', port, path: '/' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        server.close();
        const raw = Buffer.concat(chunks);
        const text = raw.toString('utf8');   // manifest 是 UTF-8 JSON，整段按 utf8 解（boundary 为 ASCII 不受影响）
        const segs = text.split('--' + boundary).filter(s => s && s !== '--\r\n');
        let fail = 0;
        const nameMatch = /name="manifest"\r\n\r\n([\s\S]*?)\r\n$/.exec(segs[0]);
        if (!nameMatch) { console.error('FAIL: manifest part 解析不出'); fail++; }
        else {
          const parsed = JSON.parse(nameMatch[1]);
          const keys = Object.keys(parsed);
          // 🔴 断言方向：每个 key 都必须带前导斜杠（坑 K 的正向断言）
          if (!keys.every(k => k.startsWith('/'))) { console.error('FAIL: manifest key 缺前导斜杠'); fail++; }
          if (keys.length !== fake.length) { console.error('FAIL: manifest 条数 ' + keys.length + ' ≠ ' + fake.length); fail++; }
          fake.forEach(f => {
            if (parsed[f.key] !== crypto.createHash('md5').update(f.buf).digest('hex')) { console.error('FAIL: hash 不匹配 ' + f.key); fail++; }
          });
        }
        // part 与源文件逐字节比对
        const part0 = segs[0];
        const start = text.indexOf('\r\n\r\n', text.indexOf('name="manifest"')) + 4;
        const manifestBytes = raw.slice(start, raw.length - ('\r\n--' + boundary + '--\r\n').length - (raw.length - start) + (raw.length - ('\r\n--' + boundary + '--\r\n').length));
        // 简化：直接比对 body 里 manifest 文本
        const m2 = /\{"\/index\.html".*\}/.exec(text);
        if (!m2) { console.error('FAIL: 找不到 manifest JSON'); fail++; }
        console.log(fail ? 'selftest FAIL (' + fail + ')' : 'selftest PASS（multipart 回环 + 前导斜杠断言 + md5 一致）');
        process.exit(fail ? 1 : 0);
      });
    });
  });
}

/* ------------------------------------------------------------------- main */
const args = process.argv.slice(2);
const env = loadEnv();

(async () => {
  if (args.includes('--selftest')) return selftest();
  if (args.includes('--hostcheck')) {
    const proj = (args.find(a => a.startsWith('--project=')) || '=').split('=')[1] || env.CF_PAGES_PROJECT || 'localphototool';
    return process.exit(hostcheck(proj) ? 0 : 1);
  }
  if (args.includes('--dry-run')) {
    const fake = { accountId: '0'.repeat(32), token: 'fake-token-dry-run', project: env.CF_PAGES_PROJECT || 'localphototool' };
    try {
      await listProjects(fake);
      console.error('意外：假凭据竟然通过了？退出 1');
      process.exit(1);
    } catch (e) {
      if (e.parsedCf || /\[\d+\]/.test(e.message)) {
        console.log('dry-run PASS：拿到被解析的 CF 报错 → ' + e.message);
        process.exit(0);
      }
      console.error('dry-run FAIL（报错不是解析出的 CF 认证错误）：' + e.message);
      process.exit(1);
    }
  }
  const c = readCreds(env);
  if (args.includes('--precheck')) {
    if (!hostcheck(c.project)) process.exit(1);
    const projects = await listProjects(c);
    const names = projects.map(p => p.name);
    if (names.includes(c.project)) {
      const p = projects.find(x => x.name === c.project);
      console.log('precheck PASS：项目「' + c.project + '」存在，production_branch=' + p.production_branch +
        '，自定义域=' + (p.domains || []).join(', '));
      process.exit(0);
    }
    console.error('precheck FAIL：没有「' + c.project + '」。实际项目：\n  ' + names.join('\n  '));
    process.exit(1);
  }
  if (args.includes('--deps')) {
    const deps = await listDeployments(c, 10);
    deps.forEach(d => {
      const stage = (d.latest_stage || {}).name + ':' + (d.latest_stage || {}).status;
      console.log((d.id || '').slice(0, 8) + '  ' + d.created_on + '  ' + (d.environment || '?') + '  ' + stage + '  ' + (d.url || ''));
    });
    return;
  }
  const rb = args.find(a => a.startsWith('--rollback='));
  if (rb) {
    const target = rb.split('=')[1];
    const deps = await listDeployments(c, 10);
    let dep;
    if (target === 'latest-good') dep = deps[1];
    else dep = deps.find(d => d.id.startsWith(target));
    if (!dep) { console.error('找不到目标部署（列表前 10 条见 --deps）'); process.exit(1); }
    console.log('回滚到 ' + dep.id + '（' + dep.created_on + '）…');
    const ok = await rollback(c, dep.id);
    process.exit(ok ? 0 : 1);
  }
  return deploy(c, args.includes('--force'));
})().catch(e => {
  console.error('FATAL: ' + e.message);
  process.exit(1);
});
