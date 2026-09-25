/* Generate promo/directory-submission-pack.html from the distribution kit.

   Every directory worth submitting to puts an account in front of the form, so
   this cannot be automated end to end and is not meant to be. What it is meant
   to do is remove the two things that actually stop a submission: hunting for
   the entry point, and writing the same five fields over and over by hand. So
   each site gets its measured entry URL and every field gets a copy button.

   The wording comes from the kit's copy blocks and nowhere else. If this file
   held strings of its own there would again be two places to edit, and the
   length checks in check-listing-copy.cjs would not cover what gets pasted.

   Usage:  node _dev/gen-directory-pack.cjs
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KIT = path.join(ROOT, 'promo', 'distribution-kit.md');
const OUT = path.join(ROOT, 'promo', 'directory-submission-pack.html');

function blocks(src) {
  const out = new Map();
  const re = /```copy name=([\w-]+)(?: limit=(\d+))?( refutes)?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(src))) out.set(m[1], m[4].replace(/\n$/, ''));
  return out;
}

const kit = fs.readFileSync(KIT, 'utf8');
const b = blocks(kit);

const WANTED = ['tagline', 'short', 'medium', 'long', 'pr-body'];
for (const name of WANTED) {
  if (!b.has(name)) {
    console.error(`gen-directory-pack: block "${name}" is missing from the kit`);
    process.exit(1);
  }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const date = new Date().toISOString().slice(0, 10);

/* One row of the universal field table. These are the values that go into the
   same handful of inputs on every directory form. */
const FIELDS = [
  ['Product / startup name', 'LocalPhotoTool', 'name'],
  ['Website', 'https://localphototool.com', 'short'],
  ['Tagline (60 char limit)', b.get('tagline'), 'tagline'],
  ['Short description (160)', b.get('short'), 'short'],
  ['Medium description (300)', b.get('medium'), 'medium'],
  ['Long description (700)', b.get('long'), 'long'],
  ['GitHub repo', 'https://github.com/biren001/localphototool', 'short'],
  ['Pricing', 'Free — no account, no watermark, no file limit', 'short'],
  ['Categories', 'Image compression, Image converter, HEIC, Privacy, WebAssembly', 'short'],
];

/* Measured, not assumed. `rel` is what the directory puts on an outbound link
   from a real listing page, sampled with a browser. That is the difference
   between a listing that moves rankings and one that only gets us discovered. */
const SITES = [
  {
    name: 'Tiny Startups',
    url: 'https://www.tinystartups.com/submit',
    account: 'Log in / Sign up (Google or GitHub)',
    rel: 'dofollow on the listing\'s domain links; the "Visit Website" button is nofollow',
    note: 'Their own pitch is a "DR 71 do-follow backlink". Measured: the domain-name links on a listing carry rel="noopener" only, so they do pass. The big Visit Website button does not. Either way it is one of the few listings here that passes anything at all, which is why it is first.',
    steps: [
      'Open the URL, click <b>Launch now</b>.',
      'Sign up — Google or GitHub, both one click.',
      'Domain: <code>localphototool.com</code>, then fill name and description from the table above.',
    ],
  },
  {
    name: 'SaaSHub',
    url: 'https://www.saashub.com/submit',
    account: 'Register (free) or Login',
    rel: 'mixed — 11 of 26 outbound links on a sampled category page were dofollow, but product placements there were rel="nofollow sponsored"',
    note: 'The public /submit page is a pitch page, not a form. Register first, then use the <b>Submit Product</b> item in the top nav. Worth doing because it is free and syndicates to other directories, but treat the link quality as unknown rather than as a win.',
    steps: [
      'Click <b>Register</b> in the top nav and create the account.',
      'Then <b>Submit Product</b> in the top nav — that is the real form.',
      'Fill name, website and description from the table above.',
    ],
  },
  {
    name: 'DevHunt',
    url: 'https://devhunt.org/login',
    account: 'Sign in (GitHub)',
    rel: 'not measured — no listing page reachable without an account',
    note: 'Correcting an earlier note: <code>devhunt.org/submit</code> answers HTTP 200 but renders a 404 page, so it is not a working entry. The nav item <b>Submit your Dev Tool</b> points at <code>/login</code>, which means the account comes first and the form is behind it.',
    steps: [
      'Open the URL, sign in with GitHub.',
      'After login, use <b>Submit your Dev Tool</b> in the nav.',
      'Fill name, tagline, website and repo from the table above.',
    ],
  },
  {
    name: 'OpenAlternative',
    url: 'https://openalternative.co/submit',
    account: 'Sign in required — /submit redirects there',
    rel: 'not measured',
    note: 'The submit URL answers 200 but bounces to sign-in, so log in first and come back. Same category as AlternativeTo: listing as an open alternative to TinyPNG and Squoosh fits the site\'s whole premise.',
    steps: [
      'Sign in first, then revisit <code>/submit</code>.',
      'Fill name, website, and the medium description.',
    ],
  },
  {
    name: 'Uneed',
    url: 'https://uneed.best',
    account: 'Sign up, then the submit button on the home page',
    rel: 'not measured',
    note: '<code>/submit</code> is a 404 here too — the entry point is a button on the home page, not a URL you can bookmark.',
    steps: [
      'Open the home page and find the submit button.',
      'Fill the fields from the table above.',
    ],
  },
];

const fieldRows = FIELDS.map(
  ([label, value]) => `      <tr>
        <th>${esc(label)}</th>
        <td><code>${esc(value)}</code></td>
        <td><button data-copy="${esc(value)}">copy</button></td>
      </tr>`
).join('\n');

const siteCards = SITES.map(
  (s) => `    <section class="card">
      <h2>${esc(s.name)}</h2>
      <p class="entry"><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.url)}</a>
        <button data-copy="${esc(s.url)}" class="ghost">copy</button></p>
      <dl>
        <dt>Account</dt><dd>${s.account}</dd>
        <dt>Link passes</dt><dd>${esc(s.rel)}</dd>
      </dl>
      <p class="note">${s.note}</p>
      <ol>${s.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
      <label class="done"><input type="checkbox" data-track="${esc(s.name)}"> submitted</label>
    </section>`
).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Directory submission pack — LocalPhotoTool</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 32px 20px 80px; max-width: 860px;
    font: 16px/1.6 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #17202a; background: #fff;
  }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 19px; margin: 0 0 10px; }
  p.sub { margin: 0 0 24px; color: #5b6b7b; font-size: 14px; }
  .warn {
    border-left: 4px solid #c2410c; background: #fff7ed;
    padding: 12px 16px; margin: 0 0 28px; border-radius: 0 6px 6px 0; font-size: 15px;
  }
  .warn b { color: #9a3412; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 32px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 8px; border-bottom: 1px solid #e5e8ec; }
  thead th { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #5b6b7b; }
  tbody th { font-weight: 600; width: 190px; }
  code {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    background: #f4f6f8; padding: 2px 5px; border-radius: 4px; display: inline-block;
    word-break: break-word;
  }
  td code { max-width: 480px; }
  button {
    font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 5px;
    border: 1px solid #c9d2db; background: #fff; color: #17202a; cursor: pointer;
    white-space: nowrap;
  }
  button:hover { background: #f0f4f8; }
  button.ghost { border-color: transparent; background: transparent; color: #2563eb; padding: 2px 6px; }
  button.done { background: #16a34a; border-color: #16a34a; color: #fff; }
  .card {
    border: 1px solid #e5e8ec; border-radius: 10px; padding: 18px 20px; margin: 0 0 18px;
  }
  .entry { margin: 0 0 12px; font-size: 14px; }
  dl { margin: 0 0 12px; font-size: 14px; }
  dt { font-weight: 600; color: #5b6b7b; display: inline; }
  dt::after { content: ": "; }
  dd { display: inline; margin: 0 0 0 0; }
  dd::after { content: ""; display: block; height: 2px; }
  .note { font-size: 14px; color: #40525f; margin: 0 0 12px; }
  ol { margin: 0 0 14px; padding-left: 20px; font-size: 15px; }
  .done { font-size: 14px; color: #5b6b7b; cursor: pointer; }
  footer { margin-top: 40px; font-size: 13px; color: #7b8a99; }
</style>
</head>
<body>

<h1>Directory submission pack</h1>
<p class="sub">Generated ${date} by <code>node _dev/gen-directory-pack.cjs</code> from
<code>promo/distribution-kit.md</code>. Do not edit this file — change the copy in the kit and re-run.</p>

<div class="warn">
  <b>Why this is not automated.</b> Every directory here puts an account in front of
  the form, and account creation means email or OAuth confirmation plus a CAPTCHA.
  That wall is the point — it is what keeps these directories out of the spam
  business, and it is why a listing on one of them is worth anything. So the part
  that needs a human is the login; everything around it is prepared below.
</div>

<h2 style="margin-bottom:12px">Fields — same values on every form</h2>
<table>
  <tbody>
${fieldRows}
  </tbody>
</table>

<h2 style="margin-bottom:12px">Sites, in the order worth doing</h2>
${siteCards}

<h2 style="margin-bottom:12px">Also waiting on an account</h2>
<div class="card">
  <p class="note" style="margin-bottom:8px">Not measured, so no promises about link quality — listed because each is a
  real site with a free tier and a form.</p>
  <ul>
    <li><b>AlternativeTo</b> — list against TinyPNG, iLoveIMG, Squoosh, Compressor.io</li>
    <li><b>Product Hunt</b> — a listing alone still earns a lasting link; a full launch is a bigger project</li>
    <li><b>Indie Hackers</b> — the copy is in <code>promo/ready-to-post.md</code></li>
    <li><b>Slant</b>, <b>LibHunt</b> — add to the relevant "best image compressor" question</li>
    <li><b>MicroLaunch</b> — <code>/submit</code> now redirects to <code>/premium</code>, so check the free tier still exists before spending time</li>
  </ul>
  <p class="note" style="margin-top:12px"><b>GitHub PRs are a different currency.</b> GitHub puts
  <code>rel="nofollow"</code> on outbound links, so free-for.dev and the awesome-list PRs buy
  discovery and traffic, not ranking. Do them, but do not count them as backlinks.</p>
</div>

<footer>
  Check the copy is still honest before pasting any of it:
  <code>node _dev/check-listing-copy.cjs</code>
</footer>

<script>
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-copy]');
    if (!btn) return;
    const text = btn.dataset.copy;
    const done = () => {
      const old = btn.textContent;
      btn.textContent = 'copied';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    }
  });

  const KEY = 'lpt-directory-pack';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }
  for (const box of document.querySelectorAll('input[data-track]')) {
    box.checked = !!state[box.dataset.track];
    box.addEventListener('change', () => {
      state[box.dataset.track] = box.checked;
      localStorage.setItem(KEY, JSON.stringify(state));
    });
  }
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, { encoding: 'utf8' });
console.log(`gen-directory-pack: wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${SITES.length} sites, ${FIELDS.length} fields`);
for (const k of WANTED) console.log(`  block ${k.padEnd(10)} ${b.get(k).length} chars`);
