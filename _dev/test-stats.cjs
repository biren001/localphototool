/* Browser tests for the visitor counter.
   Public pages must NOT show a small, unimpressive number;
   /stats/ (the owner's private dashboard) must show exact numbers.
   Run: node _dev/test-stats.cjs                                            */
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8891;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  await sleep(700);

  await fetch(BASE + '/api/count?reset=1'); // start from zero

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  async function newVisitor(opts) {
    opts = opts || {};
    const ctx = await browser.newContext({
      viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      userAgent: opts.ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      deviceScaleFactor: opts.mobile ? 2 : 1,
      isMobile: !!opts.mobile,
      hasTouch: !!opts.mobile
    });
    await ctx.addInitScript(() => { window.LPT_STATS_FORCE = true; });
    return ctx;
  }

  const peek = async () => (await fetch(BASE + '/api/count')).json();

  async function waitForCount(n, ms) {
    const deadline = Date.now() + (ms || 8000);
    while (Date.now() < deadline) {
      if ((await peek()).visitors === n) return true;
      await sleep(250);
    }
    return false;
  }

  // Same as waitForCount but also reports how long it actually took, so the
  // cold-start budget can be argued from a number instead of a guess.
  async function timeCount(n, ms) {
    const t0 = Date.now();
    const got = await waitForCount(n, ms);
    return { got, ms: Date.now() - t0 };
  }

  try {
    console.log('\nVisitor counter — browser tests\n');

    /* ---- 1. counting still works with nothing on screen ------------------ */
    let ctx = await newVisitor();
    let page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    // The cold path gets its own, longer deadline. This is the first request
    // that makes serve-site.cjs load and compile _worker.js, on top of a cold
    // browser start, and the default 8s window lost that race often enough to
    // fail roughly one full run in two — while every assertion after it passed,
    // which is what identified it as a window that was too short rather than a
    // broken counter. Do not shrink this back to the default.
    const cold = await timeCount(1, 30000);
    console.log('  note  cold first count took ' + cold.ms + ' ms (window: 30000 ms)');
    ok('first visitor is counted', cold.got, JSON.stringify(await peek()));

    await page.reload({ waitUntil: 'networkidle' });
    await sleep(900);
    ok('reload does not add a visitor', (await peek()).visitors === 1, JSON.stringify(await peek()));

    /* ---- 2. nothing small is shown to the public ------------------------- */
    ok('no hero pill on the homepage', (await page.$$('.hero__live')).length === 0);
    ok('no “Live usage” card on the homepage', (await page.$$('.live-stats')).length === 0);
    const proofHidden = await page.$eval('.footer__stats', (el) => el.hidden);
    ok('footer proof stays hidden at 1 visitor', proofHidden === true);
    const anyCounter = await page.evaluate(() => Array.prototype.some.call(
      document.querySelectorAll('[data-stats]'),
      (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0
    ));
    ok('no counter is visible to a real user', anyCounter === false);

    /* ---- 3. de-duplication across pages ---------------------------------- */
    await page.goto(BASE + '/about/', { waitUntil: 'networkidle' });
    await sleep(700);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await sleep(900);
    ok('coming back does not add a visitor', (await peek()).visitors === 1, JSON.stringify(await peek()));

    /* ---- 4. a second, independent visitor -------------------------------- */
    const ctx2 = await newVisitor();
    const page2 = await ctx2.newPage();
    await page2.goto(BASE + '/', { waitUntil: 'networkidle' });
    await sleep(1000);
    ok('a second person increments the tally', (await peek()).visitors === 2, JSON.stringify(await peek()));

    /* ---- 5. bots are not people ------------------------------------------ */
    const botCtx = await newVisitor({ ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
    const botPage = await botCtx.newPage();
    await botPage.goto(BASE + '/', { waitUntil: 'networkidle' });
    await sleep(900);
    ok('crawler visit is not counted', (await peek()).visitors === 2, JSON.stringify(await peek()));
    await botCtx.close();

    /* ---- 6. private dashboard shows the exact truth ---------------------- */
    await page2.goto(BASE + '/stats/', { waitUntil: 'networkidle' });
    await page2.waitForFunction(() => {
      const el = document.querySelector('[data-stats="visitors"]');
      return el && el.textContent.trim() === '2';
    }, { timeout: 8000 });
    ok('/stats/ shows the real visitor count', (await page2.$eval('[data-stats="visitors"]', (e) => e.textContent.trim())) === '2');
    ok('/stats/ shows today = 2', (await page2.$eval('[data-stats="today"]', (e) => e.textContent.trim())) === '2');
    ok('/stats/ renders 14 chart columns', (await page2.$$eval('.spark__col', (e) => e.length)) === 14);
    ok('/stats/ is marked noindex', (await page2.$eval('meta[name="robots"]', (e) => e.content)).indexOf('noindex') === 0);
    ok('/stats/ is not in the sitemap', (await (await fetch(BASE + '/sitemap.xml')).text()).indexOf('/stats/') === -1);
    await page2.screenshot({ path: path.join(__dirname, 'out', 'stats-private-dashboard.png'), fullPage: true });

    /* ---- 6b. reading the numbers must not change the numbers ------------- */
    const ownerCtx = await newVisitor();            // a brand-new browser profile
    const ownerPage = await ownerCtx.newPage();
    const beforeOpen = await peek();
    await ownerPage.goto(BASE + '/stats/', { waitUntil: 'networkidle' });
    await sleep(1200);
    const afterOpen = await peek();
    ok('opening the dashboard does not count as a visitor',
      afterOpen.visitors === beforeOpen.visitors, beforeOpen.visitors + ' → ' + afterOpen.visitors);
    ok('opening the dashboard does not bump “today”',
      afterOpen.today === beforeOpen.today, beforeOpen.today + ' → ' + afterOpen.today);

    /* ---- 6c. the owner opt-out stops counting this browser -------------- */
    const ticked = await ownerPage.evaluate(() => {
      const box = document.getElementById('muteMine');
      if (!box) return false;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      return window.LPTStats.muted();
    });
    ok('ticking “don’t count me” is persisted', ticked === true);
    await ownerPage.goto(BASE + '/', { waitUntil: 'networkidle' });
    await sleep(1300);
    ok('a muted browser browsing the site is not counted',
      (await peek()).visitors === beforeOpen.visitors, JSON.stringify(await peek()));

    await ownerPage.evaluate(() => window.LPTStats.setMuted(false));
    await ownerPage.goto(BASE + '/about/', { waitUntil: 'networkidle' });
    await sleep(1400);
    ok('un-ticking brings that browser back into the tally',
      (await peek()).visitors === beforeOpen.visitors + 1, JSON.stringify(await peek()));
    await ownerCtx.close();

    /* ---- 7. the threshold really opens the door -------------------------- */
    await fetch(BASE + '/api/count?demo=1');   // seeds 1,284 visitors
    await page2.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page2.evaluate(() => window.LPTStats.refresh(true));
    await page2.waitForFunction(() => {
      const el = document.querySelector('.footer__stats');
      return el && !el.hidden && el.textContent.indexOf('1,200') !== -1;
    }, { timeout: 8000 }).catch(() => {});
    const proof = await page2.$eval('.footer__stats', (el) => ({
      hidden: el.hidden,
      text: el.textContent.replace(/\s+/g, ' ').trim()
    }));
    ok('footer proof appears above the threshold', proof.hidden === false, JSON.stringify(proof));
    ok('the public number is rounded to “1,200+”', proof.text.indexOf('1,200+') !== -1, proof.text);

    /* ---- 8. mobile -------------------------------------------------------- */
    const mCtx = await newVisitor({ mobile: true });
    const mPage = await mCtx.newPage();
    const mErrors = [];
    mPage.on('pageerror', (e) => mErrors.push(String(e)));
    await mPage.goto(BASE + '/', { waitUntil: 'networkidle' });
    await sleep(900);
    const fits = await mPage.evaluate(() => {
      const el = document.querySelector('.footer__stats');
      const r = el.getBoundingClientRect();
      return r.width <= window.innerWidth + 1;
    });
    ok('footer proof fits the phone screen', fits);
    await mPage.evaluate(() => document.querySelector('.footer__stats').scrollIntoView({ block: 'center' }));
    await sleep(300);
    await mPage.screenshot({ path: path.join(__dirname, 'out', 'stats-footer-mobile.png') });
    await mPage.goto(BASE + '/stats/', { waitUntil: 'networkidle' });
    await sleep(900);
    ok('no JS errors on mobile', mErrors.length === 0, mErrors.join(' | '));
    await mCtx.close();

    /* ---- 9. graceful failure --------------------------------------------- */
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx3.addInitScript(() => { window.LPT_STATS_FORCE = true; });
    await ctx3.route('**/api/count', (route) => route.abort());
    const page3 = await ctx3.newPage();
    const err3 = [];
    page3.on('pageerror', (e) => err3.push(String(e)));
    await page3.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    ok('proof stays hidden when the API fails', (await page3.$eval('.footer__stats', (el) => el.hidden)) === true);
    ok('failed fetch throws no page error', err3.length === 0, err3.join(' | '));
    await ctx3.close();

    ok('no JS errors on desktop', errors.length === 0, errors.join(' | '));

    await ctx.close();
    await ctx2.close();
  } catch (e) {
    fail++;
    console.log('  FAIL  unexpected error → ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
