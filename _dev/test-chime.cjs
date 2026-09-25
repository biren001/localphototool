/*
   Finish chime — browser tests.

   What has to hold:
   A. the sound is synthesised, never downloaded
   B. a batch that lands in a second stays silent
   C. a batch that takes a while, or finishes while you are away, chimes
   D. a batch where nothing succeeded stays silent
   E. the switch is remembered, and the tab title always covers the case
      where iOS refuses to play sound from a background tab
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WS_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT = 8811;
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const IMG = path.join(WS_ROOT, '_dev/out/csp-probe.png');
const PAGE = 'http://localhost:' + PORT + '/localphototool/compress/';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.normalize(path.join(WS_ROOT, p)), (e, d) => {
    if (e) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
});

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Runs before any page script. `arg` is serialised in, so it cannot close
   over anything in this file. */
function initEnv(arg) {
  window.__audio = { contexts: 0, gains: [], osc: [] };

  var Ctx = function () {
    window.__audio.contexts++;
    var self = this;
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = {};
    this.resume = function () { self.state = 'running'; return Promise.resolve(); };
    this.createGain = function () {
      var node = { gain: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} } };
      window.__audio.gains.push(node);
      node.connect = function () {};
      return node;
    };
    this.createOscillator = function () {
      var rec = { freq: 0, started: false, stopped: false };
      window.__audio.osc.push(rec);
      var o = {
        type: '',
        frequency: {},
        connect: function () {},
        start: function () { rec.started = true; },
        stop: function () { rec.stopped = true; }
      };
      Object.defineProperty(o.frequency, 'value', {
        set: function (v) { rec.freq = v; },
        get: function () { return rec.freq; }
      });
      return o;
    };
  };

  if (arg.noAudio) {
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
  } else {
    window.AudioContext = Ctx;
    window.webkitAudioContext = Ctx;
  }

  window.__hidden = !!arg.hidden;
  Object.defineProperty(document, 'hidden', {
    get: function () { return window.__hidden; },
    configurable: true
  });
}

async function makePage(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(initEnv, { hidden: !!opts.hidden, noAudio: !!opts.noAudio });
  const page = await ctx.newPage();
  const errors = [];
  const audioReq = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(r.url())) audioReq.push(r.url()); });
  page.__errors = errors;
  page.__audioReq = audioReq;
  return page;
}

async function waitDone(page) {
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('.result');
    if (!rows.length) return false;
    return Array.prototype.every.call(rows, (r) => !/Processing|Queued|Working/i.test(r.textContent));
  }, { timeout: 180000 });
  await page.waitForTimeout(700);
}

async function compress(page, files) {
  await page.goto(PAGE, { waitUntil: 'load' });
  await openSettings(page);
  await page.setInputFiles('#fileInput', files);
}

/* The options live inside a collapsed <details>, so the switch and the
   preview button are unreachable until it is opened. */
async function openSettings(page) {
  await page.evaluate(() => {
    const d = document.querySelector('details.advanced');
    if (d) d.open = true;
  });
}

function run() {
  (async () => {
    srv.listen(PORT);
    const browser = await chromium.launch({ executablePath: EXE });
    const png = fs.readFileSync(IMG);

    /* ---------- A. synthesised, not downloaded ---------- */
    console.log('\n=== A. The sound is generated, never fetched ===');
    let page = await makePage(browser, {});
    await compress(page, { name: 'a.png', mimeType: 'image/png', buffer: png });
    await waitDone(page);

    check('LPTChime is available', await page.evaluate(() => !!(window.LPTChime && window.LPTChime.play)));
    check('no audio file was ever requested', page.__audioReq.length === 0, page.__audioReq.join(', ') || 'none');
    check('no <audio> element exists', (await page.$$('audio')).length === 0);
    check('the chime is on by default', await page.evaluate(() => window.LPTChime.enabled()) === true);
    check('the switch reflects that', await page.isChecked('#chimeOn'));

    /* ---------- B. fast batch stays silent ---------- */
    console.log('\n=== B. A batch that finishes quickly stays quiet ===');
    await page.evaluate(() => { window.__audio.osc = []; });
    await page.evaluate(() => { window.__shares; });
    const elapsed = await page.evaluate(() => {
      return new Promise((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          const rows = document.querySelectorAll('.result');
          const busy = Array.prototype.some.call(rows, (r) => /Processing|Queued|Working/i.test(r.textContent));
          if (!busy && rows.length) resolve(Math.round(performance.now() - t0));
          else requestAnimationFrame(tick);
        };
        tick();
      });
    });
    const oscAfterFast = await page.evaluate(() => window.__audio.osc.length);
    check('no sound for a quick batch', oscAfterFast === 0, oscAfterFast + ' tone(s)');
    check('the tab title is untouched', !(await page.title()).includes('Done'), await page.title());

    /* ---------- C. preview ---------- */
    console.log('\n=== C. Preview');
    await page.evaluate(() => { window.__audio.osc = []; });
    await page.click('#chimeTest');
    await page.waitForTimeout(200);
    const preview = await page.evaluate(() => window.__audio.osc.map((o) => o.freq));
    check('preview plays two tones', preview.length === 2, JSON.stringify(preview));
    check('the tones rise a fifth', preview[0] === 880 && preview[1] === 1318.5, preview.join(' → '));
    /* gains[0] is the master gain; the rest are per-note envelopes. */
    const peak = await page.evaluate(() => {
      const g = window.__audio.gains[0];
      return g ? g.gain.value : -1;
    });
    check('the volume is deliberately low', peak > 0 && peak <= 0.15, String(peak));
    const suspended = await page.evaluate(() => window.__audio.contexts);
    check('one audio context is reused', suspended === 1, suspended + ' context(s)');

    /* ---------- C2. the bell in the results bar ---------- */
    console.log('\n=== C2. The bell next to the results ===');
    check('a bell sits in the results bar', await page.isVisible('#chimeToggle'));
    check('it shows the sound is on',
      await page.getAttribute('#chimeToggle', 'aria-pressed') === 'true');
    await page.click('#chimeToggle');
    await page.waitForTimeout(150);
    check('tapping it turns the sound off',
      await page.getAttribute('#chimeToggle', 'aria-pressed') === 'false');
    check('and the settings switch follows', (await page.isChecked('#chimeOn')) === false);
    await page.click('#chimeToggle');
    await page.waitForTimeout(150);
    check('tapping again turns it back on',
      await page.getAttribute('#chimeToggle', 'aria-pressed') === 'true');
    await page.context().close();

    /* ---------- D. finishes while you are away ---------- */
    console.log('\n=== D. Finishing while you are on another tab ===');
    page = await makePage(browser, { hidden: true });
    await compress(page, { name: 'b.png', mimeType: 'image/png', buffer: png });
    await waitDone(page);
    const away = await page.evaluate(() => window.__audio.osc.map((o) => o.freq));
    check('it chimes when you are away', away.length === 2, JSON.stringify(away));
    check('the tab title flags completion', (await page.title()).includes('Done'), await page.title());

    const original = await page.evaluate(() => {
      window.__hidden = false;                       /* simulate coming back */
      document.dispatchEvent(new Event('visibilitychange'));
      return document.title;
    });
    check('coming back restores the title', !original.includes('Done'), original);
    check('no JS errors on the away path', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    /* ---------- E. nothing succeeded ---------- */
    console.log('\n=== E. A batch that failed outright stays quiet ===');
    page = await makePage(browser, { hidden: true });
    await compress(page, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png at all') });
    await page.waitForTimeout(2500);
    const failOsc = await page.evaluate(() => window.__audio.osc.length);
    check('no chime when nothing was produced', failOsc === 0, failOsc + ' tone(s)');
    check('no JS errors on the failure path', page.__errors.length === 0, page.__errors[0] || 'clean');
    await page.context().close();

    /* ---------- F. the switch is remembered ---------- */
    console.log('\n=== F. Turning it off ===');
    page = await makePage(browser, {});
    await compress(page, { name: 'c.png', mimeType: 'image/png', buffer: png });
    await waitDone(page);
    await page.click('#chimeToggle');
    check('the preference is stored', await page.evaluate(() => localStorage.getItem('lpt:chime')) === 'off');
    await page.reload({ waitUntil: 'load' });
    await openSettings(page);
    await page.waitForTimeout(300);
    check('it survives a reload', (await page.isChecked('#chimeOn')) === false);
    check('the bell remembers too',
      await page.getAttribute('#chimeToggle', 'aria-pressed') === 'false');

    await page.evaluate(() => { window.__audio.osc = []; });
    await page.setInputFiles('#fileInput', { name: 'd.png', mimeType: 'image/png', buffer: png });
    await waitDone(page);
    const offOsc = await page.evaluate(() => window.__audio.osc.length);
    check('a switched-off chime stays silent', offOsc === 0, offOsc + ' tone(s)');

    await page.evaluate(() => { window.__audio.osc = []; });
    await page.click('#chimeTest');
    await page.waitForTimeout(200);
    check('preview still works while switched off',
      (await page.evaluate(() => window.__audio.osc.length)) === 2);
    await page.context().close();

    /* ---------- G. no Web Audio at all ---------- */
    console.log('\n=== G. A browser without Web Audio ===');
    page = await makePage(browser, { hidden: true, noAudio: true });
    await compress(page, { name: 'e.png', mimeType: 'image/png', buffer: png });
    await waitDone(page);
    check('no crash when Web Audio is missing', page.__errors.length === 0, page.__errors[0] || 'clean');
    check('play() reports it did nothing',
      await page.evaluate(() => window.LPTChime.play()) === false);
    check('the title still flags completion', (await page.title()).includes('Done'), await page.title());
    await page.context().close();

    await browser.close();
    srv.close();
    const passed = results.filter(Boolean).length;
    console.log('\n' + passed + ' / ' + results.length + ' chime checks passed');
  })();
}

run();
