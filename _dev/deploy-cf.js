#!/usr/bin/env node
/* deploy-cf.js — localphototool.com 的 Cloudflare Pages 自动发布
 *
 * 架构：归属闸门（本脚本）→ 传输层（wrangler pages deploy，官方协议的标准实现，
 * 正确处理 _headers/_redirects 独立 part 与 _worker.bundle 编译——这些文件绝不能进
 * manifest，否则整站 500，2026-09-30 实测踩坑）→ 上线判定（探针 + 自动回滚，本脚本）。
 *
 * 用法：
 *   node _dev/deploy-cf.js                 # 正式部署（读 _dev/.env.local）
 *   node _dev/deploy-cf.js --branch=xxx    # 发到预览分支（测试用，不碰生产）
 *   node _dev/deploy-cf.js --precheck      # 真凭据预检：项目名精确匹配 + 归属闸门
 *   node _dev/deploy-cf.js --hostcheck     # 纯离线归属自检（不需要 token）
 *   node _dev/deploy-cf.js --dry-run       # 假凭据：验证连通 + 认证错误解析（应得到 [9106]）
 *   node _dev/deploy-cf.js --deps          # 列最近部署（排查第一步）
 *   node _dev/deploy-cf.js --rollback=<id前8位|latest-good>
 *
 * 凭据（_dev/.env.local，已被 .gitignore 排除）：
 *   CF_ACCOUNT_ID / CF_API_TOKEN / CF_PAGES_PROJECT / CF_EXPECT_HOST
 * 判定纪律：
 *   - 部署后资产传播要 1~2 分钟（实测），探针必须带 4 分钟重试窗口，全窗口不过才回滚
 *   - 判「哪个是新部署」必须用上传前的 id 集合，不看 wrangler 的回显
 */

'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'localphototool');
const ENV_FILE = path.join(__dirname, '.env.local');
const RESULT_FILE = path.join(__dirname, '.tmp', 'deploy-cf-result.json');
const WRANGLER = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js';
const NODE_EXE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
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
      cap = tries + 8;
      await new Promise(r => setTimeout(r, Math.min(5000, 1000 * i)));
    }
  }
  throw lastErr;
}

async function apiJson(opts, tries = 4) {
  const r = await rawWithRetry(opts, tries);
  let json;
  try { json = JSON.parse(r.buf.toString('utf8')); }
  catch (e) { throw new Error('响应不是 JSON（HTTP ' + r.status + '）：' + r.buf.toString('utf8').slice(0, 200)); }
  if (json.errors && json.errors.length) {
    const msg = json.errors.map(e => '[' + e.code + '] ' + e.message).join('; ');
    if (r.status >= 400) {
      const err = new Error(msg + ' (status: ' + r.status + ')');
      err.parsedCf = true;
      throw err;
    }
    console.log('  ⚠ CF errors: ' + msg);
  }
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

function hostcheck(project, expectHost) {
  const { mode, counts } = sitemapHostMode();
  console.log('sitemap 域名众数：' + mode + '（' + counts.map(c => c[0] + '=' + c[1]).join(', ') + '）');
  let ok = true;
  if (mode !== EXPECT_HOST_DEFAULT) { console.error('FAIL: 产物域名众数 ≠ ' + EXPECT_HOST_DEFAULT); ok = false; }
  if (mode.toLowerCase().indexOf(String(project).toLowerCase()) === -1) {
    if (expectHost && expectHost === mode) {
      console.log('确认：CF_EXPECT_HOST 已显式声明 ' + mode + '，接受项目名「' + project + '」与域名不对应（人工确认项）');
    } else {
      console.error('FAIL: 项目名「' + project + '」不出现在产物域名里。若确认无误，请在 .env.local 显式写 CF_EXPECT_HOST=' + mode);
      ok = false;
    }
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
function collectManifestKeys() {
  // 仅用于探针选 key；传输由 wrangler 负责（特殊文件它自己走独立通道）
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (/^\.DS_Store$|^Thumbs\.db$/.test(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, r);
      else out.push('/' + r.replace(/\\/g, '/'));
    }
  })(SITE_DIR, '');
  return out;
}

/* -------------------------------------------------------- deploy via wrangler */
function runWrangler(c, branch) {
  if (!fs.existsSync(WRANGLER)) {
    console.error('FAIL: 找不到 wrangler：' + WRANGLER);
    process.exit(2);
  }
  const args = [
    WRANGLER, 'pages', 'deploy', SITE_DIR,
    '--project-name=' + c.project,
    '--branch=' + branch,
    '--commit-dirty=true',
  ];
  console.log('传输层：wrangler pages deploy（' + branch + ' 分支）…');
  const r = spawnSync(NODE_EXE, args, {
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    env: Object.assign({}, process.env, {
      CLOUDFLARE_API_TOKEN: c.token,
      CLOUDFLARE_ACCOUNT_ID: c.accountId,
      WRANGLER_SEND_METRICS: 'false',
      CI: 'true',
    }),
  });
  const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  console.log(out.split('\n').slice(-12).join('\n'));
  if (r.status !== 0) throw new Error('wrangler 退出码 ' + r.status + '（见上方输出）');
  return out;
}

/* ------------------------------------------------------------------ probe */
async function probeUrl(url, tries = 3) {
  try {
    const u = new URL(url);
    const r = await rawWithRetry({ method: 'GET', path: u.pathname + u.search, host: u.hostname }, tries);
    return { status: r.status, len: r.buf.length, head: r.buf.slice(0, 24).toString('utf8') };
  } catch (e) { return { status: 0, len: 0, err: (e && e.message) || String(e) }; }
}

async function probeDeployment(depUrl, manifestKeys) {
  const probes = ['/', '/sw.js', '/favicon.ico']
    .filter(k => manifestKeys.has(k) || k === '/')
    .map(k => depUrl.replace(/\/$/, '') + k);
  // worker 存活断言：/_worker.js 在站内时，/api/count 必须回 JSON（否则 worker 没执行，
  // 计数器静默死亡——zip 上传与 API 上传行为不同，必须钉死）
  if (manifestKeys.has('/_worker.js')) probes.push(depUrl.replace(/\/$/, '') + '/api/count');
  if (probes.length < 3) {
    const extra = [...manifestKeys].slice(0, 3 - probes.length);
    probes.push(...extra.map(k => depUrl.replace(/\/$/, '') + k));
  }
  // 🔴 资产传播实测要 1~2 分钟，全量站更久：给 4 分钟重试窗口
  const deadline = Date.now() + 240000;
  let attempt = 0, last = [];
  while (Date.now() < deadline) {
    attempt++;
    last = [];
    for (const u of probes) last.push({ url: u, ...(await probeUrl(u)) });
    if (last.every(x => x.status === 200 && x.len > 0 && (!/\/api\/count/.test(x.url) || x.head.startsWith('{')))) {
      console.log('  探针全绿（第 ' + attempt + ' 轮，含 worker 存活断言）');
      return { ok: true, results: last };
    }
    console.log('  探针第 ' + attempt + ' 轮未全绿（' + last.map(x => x.status || 'ERR').join('/') + '），等 15s 重试…');
    await new Promise(r => setTimeout(r, 15000));
  }
  return { ok: false, results: last };
}

/* ----------------------------------------------------------------- settle */
async function settle(c, ctx) {
  const deps = await listDeployments(c, 5);
  const newDep = deps.find(d => !ctx.knownIds.has(d.id));
  if (!newDep) return { deployed: false, note: 'wrangler 已跑完但列表里没有新部署（罕见），人工核查 --deps' };
  console.log('发现新部署：' + newDep.id + '（' + (newDep.environment || '?') + '）');
  let det = null;
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    det = await getDeploymentDetail(c, newDep.id);
    const st = det.result.latest_stage || {};
    if (st.status === 'success' || st.status === 'failure') break;
  }
  const latest = det.result.latest_stage || {};
  if (latest.status !== 'success') {
    console.error('部署未成功（' + latest.name + ':' + latest.status + '）');
    if (ctx.prevCanonical) { console.log('自动回滚到 ' + ctx.prevCanonical); await rollback(c, ctx.prevCanonical); }
    return { deployed: true, depId: newDep.id, ok: false, note: '部署阶段失败，已回滚' };
  }
  const detFull = det.result;
  const depUrl = detFull.url || (detFull.short_id ? 'https://' + detFull.short_id + '.' + c.project + '.pages.dev' : null);
  const probe = await probeDeployment(depUrl, ctx.manifestKeys);
  if (!probe.ok) {
    console.error('探针不过（整站可能不可服务）→ 自动回滚到 ' + ctx.prevCanonical);
    if (ctx.prevCanonical) await rollback(c, ctx.prevCanonical);
    return { deployed: true, depId: newDep.id, ok: false, depUrl, probe: probe.results, note: '探针失败，已回滚' };
  }
  return { deployed: true, depId: newDep.id, ok: true, depUrl, probe: probe.results };
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
  }, 4);
  console.log('rollback HTTP ' + r.status);
  return r.status >= 200 && r.status < 300;
}

/* ------------------------------------------------------------- full deploy */
async function deploy(c, branch) {
  const t0 = Date.now();
  const isPreview = branch && branch !== 'main';
  if (!hostcheck(c.project, c.expectHost)) process.exit(1);

  const projects = await listProjects(c);
  const names = projects.map(p => p.name);
  if (!names.includes(c.project)) {
    console.error('FAIL: 项目「' + c.project + '」不在账户里。实际项目：\n  ' + names.join('\n  '));
    process.exit(1);
  }
  console.log('项目名精确匹配 PASS（共 ' + names.length + ' 个项目）');

  const manifestKeys = new Set(collectManifestKeys());
  const files = manifestKeys.size;
  console.log('待传：' + files + ' 个文件（特殊文件由 wrangler 走独立通道）');

  const prevCanonical = (projects.find(p => p.name === c.project).canonical_deployment || {}).id || null;
  const depsBefore = await listDeployments(c, 5);
  const knownIds = new Set(depsBefore.map(d => d.id));
  console.log('回滚目标（上传前 canonical）：' + prevCanonical + (isPreview ? '（预览分支，不影响生产）' : ''));

  runWrangler(c, branch || 'main');

  const res = await settle(c, { knownIds, prevCanonical, manifestKeys });
  res.project = c.project;
  res.branch = branch || 'main';
  res.files = files;
  res.durationSec = Math.round((Date.now() - t0) / 1000);
  res.time = new Date().toISOString();
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(res, null, 2));
  console.log('结果文件：' + RESULT_FILE);
  if (res.ok) {
    console.log('\n✅ 上线成功：' + res.depUrl + '（' + res.durationSec + 's，' + res.files + ' 文件）');
    console.log('   建议：node _dev/check-live.cjs 全站复核 + IndexNow 推改动页');
  } else if (res.deployed) {
    console.error('\n❌ 新部署有问题：' + (res.note || '') + (isPreview ? '（预览分支，生产未受影响）' : '（已自动回滚，线上未受影响）'));
    process.exit(1);
  } else {
    console.error('\n⚠ ' + res.note);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------- main */
const args = process.argv.slice(2);
const env = loadEnv();

(async () => {
  if (args.includes('--hostcheck')) {
    const proj = (args.find(a => a.startsWith('--project=')) || '=').split('=')[1] || env.CF_PAGES_PROJECT || 'localphototool';
    return process.exit(hostcheck(proj, env.CF_EXPECT_HOST) ? 0 : 1);
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
      console.error('dry-run FAIL：' + e.message);
      process.exit(1);
    }
  }
  const c = readCreds(env);
  if (args.includes('--precheck')) {
    if (!hostcheck(c.project, c.expectHost)) process.exit(1);
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
    const dep = target === 'latest-good' ? deps[1] : deps.find(d => d.id.startsWith(target));
    if (!dep) { console.error('找不到目标部署（--deps 查看列表）'); process.exit(1); }
    console.log('回滚到 ' + dep.id + '（' + dep.created_on + '）…');
    process.exit((await rollback(c, dep.id)) ? 0 : 1);
  }
  const br = args.find(a => a.startsWith('--branch='));
  return deploy(c, br ? br.split('=')[1] : undefined);
})().catch(e => {
  console.error('FATAL: ' + e.message);
  process.exit(1);
});
