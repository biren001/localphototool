/* Does the header still fit?

   The nav is a single non-wrapping flex row and the page clips horizontal
   overflow, so a nav that grows too wide does not produce a scrollbar — the
   last entries are simply cut off and become unreachable. Nothing else in the
   suite would notice: the phone tests see the hamburger menu, and the desktop
   screenshots are wide enough. So this walks the widths either side of the
   inline/hamburger boundary, plus a few roomy ones, and both states of the
   menu.

   The numbers are load-bearing — see the measurement note in style.css. When
   this fails, the fix is to raise that breakpoint (or trim the nav), not to
   widen the viewport list.

   Run: node _dev/audit-nav.cjs
*/
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'));

const PORT = 8898;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = ['/', '/compress/', '/heic-to-jpg/'];
/* Above 1080 the nav is inline; below it the links live in the dropdown. Both
   sides of that line are sampled, plus a comfortable desktop width. */
const WIDTHS = [861, 1000, 1079, 1081, 1100, 1280, 1440];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-site.cjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
  });
  /* A fixed sleep races with start-up under load; poll for the port instead. */
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { await fetch(BASE + '/'); up = true; } catch (e) { await sleep(250); }
  }
  if (!up) { console.log('  FAIL  the preview server never came up'); process.exit(1); }

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  for (const p of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForSelector('.site-header', { timeout: 8000 });

    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 800 });
      await sleep(140);

      const state = await page.evaluate(() => {
        const doc = document.documentElement;
        const header = document.querySelector('.site-header');
        const inner = header.firstElementChild;
        const links = header.querySelector('.nav__links');
        const box = inner.getBoundingClientRect();
        const inline = getComputedStyle(links).position !== 'fixed';
        const clipped = [];
        /* Only meaningful while the links are laid out in the row: in the
           dropdown they are position:fixed across the full viewport on purpose. */
        if (inline) {
          inner.querySelectorAll('a, button').forEach(function (el) {
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            if (r.right > box.right + 1 || r.left < box.left - 1) {
              clipped.push(el.textContent.trim().replace(/\s+/g, ' ').slice(0, 18) + '@' + Math.round(r.right));
            }
          });
        }
        return {
          inline: inline,
          pageOverflow: doc.scrollWidth - doc.clientWidth,
          clipped: clipped
        };
      });

      const label = p.padEnd(15) + ' @' + w + 'px (' + (state.inline ? 'inline nav  ' : 'hamburger   ') + ')';
      ok(label + ' nothing is cut off',
        state.pageOverflow <= 1 && state.clipped.length === 0,
        'page overflows by ' + state.pageOverflow + 'px' +
          (state.clipped.length ? ', clipped: ' + state.clipped.join(', ') : ''));

      /* The dropdown is its own layout and only exists once it is opened. */
      if (!state.inline) {
        await page.click('#navToggle');
        await sleep(220);
        const open = await page.evaluate(() => {
          const doc = document.documentElement;
          const links = document.querySelector('.nav__links');
          const out = [];
          links.querySelectorAll('a').forEach(function (el) {
            const r = el.getBoundingClientRect();
            if (r.width && (r.right > doc.clientWidth + 1 || r.left < -1)) {
              out.push(el.textContent.trim() + '@' + Math.round(r.right));
            }
          });
          return { open: links.classList.contains('is-open'), bad: out, overflow: doc.scrollWidth - doc.clientWidth };
        });
        ok(label + ' the opened menu fits',
          open.open && open.bad.length === 0 && open.overflow <= 1,
          (open.open ? '' : 'menu did not open; ') + open.bad.join(', '));
        await page.keyboard.press('Escape').catch(function () {});
        await page.click('#navToggle').catch(function () {});
        await sleep(150);
      }
    }
    await ctx.close();
  }

  await browser.close();
  server.kill();
  console.log('\n' + pass + ' / ' + (pass + fail) + ' header-layout checks passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('  FAIL  the audit crashed: ' + ((e && e.message) || e));
  process.exit(1);
});
