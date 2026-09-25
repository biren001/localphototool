/* Cross-page consistency tests.

   /compress/ and /heic-to-jpg/ are the same page with a different tool in the
   middle: same header, same footer, same modals, same script list. Those blocks
   were copied once (see _dev/.tmp/build-heic-page.py) and will drift the moment
   someone edits one page and forgets the other — a nav entry that only exists
   on one side, a modal that only one page can open, an analytics script that
   quietly stops loading.

   Two kinds of check live here, and they catch different bugs:

   · Region comparison — the shared blocks are compared after normalising the
     one attribute that is *supposed* to differ (aria-current). This catches
     drift.

   · Link resolution — every relative href in every page is resolved against
     that page's own directory and must point at a file that exists. This
     catches the copy-paste trap that region comparison cannot: `href="./"` is
     byte-identical on both pages yet means a different page on each, so the
     shared regions are additionally required to spell their targets out.

   Run: node _dev/test-pages.cjs
*/
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'localphototool');
/* Every page in the deploy. Kept in step with the sitemap on purpose: the three
   pages added on 2026-09-20 (compress-to-50kb, compress-to-200kb,
   compress-photos-for-email) spent two days live and linked from every nav
   while sitting outside this list, the shell cache and the live checker — which
   is exactly the state in which a broken heading, a stale FAQ or a bad canonical
   ships unnoticed. If a page is public, it belongs here. */
const PAGES = [
  'index.html',
  'compress/index.html',
  'heic-to-jpg/index.html',
  'compress-to-100kb/index.html',
  'compress-to-50kb/index.html',
  'compress-to-200kb/index.html',
  'compress-to-500kb/index.html',
  'remove-gps-from-photo/index.html',
  'transfer/index.html',
  'compress-photos-for-email/index.html',
  'compress-without-uploading/index.html',
  'image-compressor-upload-test/index.html',
  'png-to-jpg/index.html',
  'jpg-to-webp/index.html',
  'about/index.html',
  'privacy/index.html',
  'terms/index.html',
  'share/index.html',
  'stats/index.html'
];
/* Pages that are meant to be found by a human or a crawler. /stats/ is
   deliberately absent from both the sitemap and the shell cache. */
const PUBLIC = ['', 'compress/', 'heic-to-jpg/', 'compress-to-100kb/', 'compress-to-50kb/',
  'compress-to-200kb/', 'compress-to-500kb/', 'remove-gps-from-photo/', 'transfer/',
  'compress-photos-for-email/', 'compress-without-uploading/', 'image-compressor-upload-test/',
  'png-to-jpg/', 'jpg-to-webp/', 'about/', 'privacy/', 'terms/', 'share/'];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

function read(rel) {
  return fs.readFileSync(path.join(SITE, ...rel.split('/')), 'utf8');
}

/* Pull a region out of the markup: everything from `start` up to and including
   the first `endMarker` after it. Both sides are cut the same way, so the
   comparison stays symmetric even if a stray blank line moves. */
function region(html, start, endMarker) {
  const from = html.indexOf(start);
  if (from === -1) return null;
  const to = html.indexOf(endMarker, from);
  if (to === -1) return null;
  return html.slice(from, to + endMarker.length);
}

/* aria-current is the only attribute the two copies are allowed to disagree
   on: it marks "you are here" and by definition differs per page. */
function normalize(block) {
  return (block || '').replace(/\s*aria-current="page"/g, '').trim();
}

function scripts(html) {
  const out = [];
  const re = /<script src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join('\n');
}

/* The tool block holds nested <section> elements, so it cannot be delimited by
   the first </section>: it runs up to the SEO comment that follows it. */
function toolRegion(html) {
  const from = (html || '').indexOf('<section class="tool" id="tool">');
  if (from === -1) return null;
  const seo = html.indexOf('<!-- SEO content -->', from);
  if (seo === -1) return null;
  const end = html.lastIndexOf('</section>', seo);
  if (end === -1) return null;
  return html.slice(from, end + '</section>'.length);
}

/* Resolve a relative href the way a browser would, then ask the filesystem
   whether the target exists. Returns {ok, target} — never throws. */
function resolve(pageRel, href) {
  const raw = href.split('#')[0].split('?')[0];
  if (raw === '') return { ok: true, target: '(anchor)' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf('//') === 0) return { ok: true, target: '(absolute)' };
  const baseDir = path.posix.dirname(pageRel);
  const isDir = raw === '.' || raw === '..' || raw.slice(-1) === '/';
  let joined = path.posix.normalize(path.posix.join(baseDir, raw));
  if (isDir) joined = path.posix.join(joined, 'index.html');
  return { ok: fs.existsSync(path.join(SITE, ...joined.split('/'))), target: joined };
}

const pageHtml = {};
PAGES.forEach(function (rel) {
  try { pageHtml[rel] = read(rel); }
  catch (e) { ok(rel + ' exists', false, e.message); }
});

console.log('\nshared regions — /compress/ vs /heic-to-jpg/\n');

const A = pageHtml['compress/index.html'];
const B = pageHtml['heic-to-jpg/index.html'];

if (!A || !B) {
  ok('both tool pages are readable', false);
} else {
  const regions = [
    ['header', region(A, '<header class="site-header">', '</header>'),
               region(B, '<header class="site-header">', '</header>')],
    ['footer', region(A, '<footer class="site-footer">', '</footer>'),
               region(B, '<footer class="site-footer">', '</footer>')],
    ['tool block', toolRegion(A), toolRegion(B)],
    ['modals', region(A, '<div class="modal" id="compareModal"', '<script src="'),
               region(B, '<div class="modal" id="compareModal"', '<script src="')],
    ['script list', scripts(A), scripts(B)]
  ];

  regions.forEach(function (r) {
    const name = r[0], a = normalize(r[1]), b = normalize(r[2]);
    if (a === null || b === null) { ok(name + ' block is present on both pages', false); return; }
    /* Two empty strings are equal, which would make the next check a lie. */
    if (a.length < 80 || b.length < 80) {
      ok(name + ' block was located on both pages', false, a.length + ' / ' + b.length + ' chars');
      return;
    }
    if (a === b) { ok('shared ' + name + ' is identical on both pages', true); return; }

    /* Report the first differing line instead of a wall of markup. */
    const la = a.split('\n'), lb = b.split('\n');
    let detail = 'length ' + la.length + ' vs ' + lb.length;
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) {
        detail = 'line ' + (i + 1) + ': ' + String(la[i]).trim().slice(0, 70) +
                 '  ≠  ' + String(lb[i]).trim().slice(0, 70);
        break;
      }
    }
    ok('shared ' + name + ' is identical on both pages', false, detail);
  });

  /* The trap region comparison cannot see: "./" is identical on both pages and
     means the compressor on one and the converter on the other. */
  const bothShared = ['compress/index.html', 'heic-to-jpg/index.html'].map(function (rel) {
    const h = pageHtml[rel] || '';
    return region(h, '<header class="site-header">', '</header>') + region(h, '<footer class="site-footer">', '</footer>');
  }).join('\n');
  ok('the shared blocks spell out their targets instead of using "./"',
    bothShared.indexOf('href="./"') === -1,
    bothShared.indexOf('href="./"') === -1 ? '' : 'a shared link uses "./" — it will point at the wrong page when copied');

  /* Each page must be reachable from the other, in both nav and footer. */
  ['compress/index.html', 'heic-to-jpg/index.html'].forEach(function (rel) {
    const h = pageHtml[rel] || '';
    const header = region(h, '<header class="site-header">', '</header>') || '';
    const footer = region(h, '<footer class="site-footer">', '</footer>') || '';
    ok(rel + ' links to the other tool from its nav',
      header.indexOf('compress/') !== -1 && header.indexOf('heic-to-jpg/') !== -1);
    ok(rel + ' links to the other tool from its footer',
      footer.indexOf('compress/') !== -1 && footer.indexOf('heic-to-jpg/') !== -1);
  });

  /* Exactly one nav item claims "you are here", and it is the right one. */
  [['compress/index.html', 'compress/'], ['heic-to-jpg/index.html', 'heic-to-jpg/']].forEach(function (pair) {
    const header = region(pageHtml[pair[0]], '<header class="site-header">', '</header>') || '';
    const current = header.match(/<a class="nav__link" href="([^"]+)" aria-current="page">/);
    ok(pair[0] + ' marks exactly one current nav item',
      (header.match(/aria-current="page"/g) || []).length === 1,
      ((header.match(/aria-current="page"/g) || []).length) + ' marked');
    ok(pair[0] + ' marks the right nav item as current',
      !!current && current[1].indexOf(pair[1]) !== -1,
      current ? current[1] : 'none');
  });
}

console.log('\nevery page — links, nav entry, shell\n');

/* Every relative href on every page must resolve. This is the check that makes
   the rest of the site trustworthy: a page is one typo away from a 404. */
PAGES.forEach(function (rel) {
  const html = pageHtml[rel];
  if (!html) return;
  const bad = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const r = resolve(rel, m[1]);
    if (!r.ok) bad.push(m[1] + ' → ' + r.target);
  }
  ok(rel + ' has no broken links', bad.length === 0, bad.slice(0, 4).join(' | '));
});

/* Nav and footer entries for the converter, with the prefix that suits depth.
   /stats/ is left out on purpose: it is the owner's private read-out, has no
   site chrome, and is never linked from anywhere. */
PAGES.filter(function (rel) { return rel !== 'stats/index.html'; }).forEach(function (rel) {
  const html = pageHtml[rel];
  if (!html) return;
  const depth = rel.indexOf('/') === -1 ? '' : '../';
  const want = 'href="' + depth + 'heic-to-jpg/"';
  const header = region(html, '<header class="site-header">', '</header>') || '';
  const footer = region(html, '<footer class="site-footer">', '</footer>') || '';
  ok(rel + ' links to the converter from its nav', header.indexOf(want) !== -1, want);
  ok(rel + ' links to the converter from its footer', footer.indexOf(want) !== -1, want);
});

/* The pages a crawler is allowed to see must be listed in the sitemap, and the
   offline shell must carry them so the tool keeps working with no network. */
const sitemap = read('sitemap.xml');
const sw = read('sw.js');
PUBLIC.forEach(function (p) {
  ok('sitemap.xml lists /' + p, sitemap.indexOf('localphototool.com/' + p + '<') !== -1);
});
/* Tool pages have to survive with no network — that is the point of the PWA —
   so every page that carries the compressor belongs in the shell. The legal
   pages (privacy, terms) are reachable from the footer but deliberately left
   out to keep the install download down. */
['', 'compress/', 'heic-to-jpg/', 'share/', 'about/',
  'compress-to-100kb/', 'compress-to-50kb/', 'compress-to-200kb/',
  'compress-to-500kb/', 'remove-gps-from-photo/', 'transfer/',
  'compress-photos-for-email/', 'compress-without-uploading/',
  'image-compressor-upload-test/',
  'png-to-jpg/', 'jpg-to-webp/'].forEach(function (p) {
  ok('the offline shell precaches /' + p, new RegExp("'" + (p || '') + "',").test(sw));
});
/* Read the SHELL array itself, not the whole file: the comment above it names
   the decoder precisely to explain why it is absent. Anchor the capture on the
   .map() that closes the array — a plain /\[([\s\S]*?)\];/ runs past the end of
   SHELL and swallows the next statement (VENDOR_HOSTS), which makes the list
   look like it contains esm.sh and cdn.jsdelivr.net as if they were pages. */
const shellBlock = (sw.match(/var SHELL = \[([\s\S]*?)\]\s*\.map\(/) || ['', ''])[1];
ok('/stats/ stays out of the sitemap', sitemap.indexOf('/stats/') === -1);
/* Guard the guard: an empty capture would make the next check pass by accident. */
ok('the shell list was actually read', shellBlock.indexOf('compress/') !== -1);
ok('the shell capture stopped at the end of the array',
  shellBlock.indexOf('esm.sh') === -1 && shellBlock.indexOf('VENDOR_HOSTS') === -1,
  'a shell entry is a path, never a hostname');
ok('the HEIC decoder is not force-downloaded by the shell',
  shellBlock.indexOf('libheif-bundle') === -1,
  'runtime-cached only — preloading 1.4 MB on every visitor is not acceptable');

/* The converter must pin its output format, or a smooth test image gets
   "auto"-detected as PNG and the page stops being a JPEG converter. */
const defaults = (B || '').match(/data-compressor-defaults='([^']+)'/);
let pinned = null;
try { pinned = defaults ? JSON.parse(defaults[1]) : null; } catch (e) { pinned = null; }
ok('the converter pins its output format to JPEG',
  !!pinned && pinned.format === 'jpeg',
  pinned ? JSON.stringify(pinned) : 'no data-compressor-defaults on <html>');
ok('the compressor does not pin a format',
  (A || '').indexOf('data-compressor-defaults') === -1);

/* ---------------------------------------------------------------------------
   Every shipped script has to parse.

   Not hypothetical: sw.js's v7 note ended with a comment-terminator in the
   middle of the paragraph, which closed the block early and left the rest of it
   as executable text. The file was served as written, a browser will not
   register a service worker that fails to parse, and every browser suite that
   does not involve the service worker still passed. Only the two that do (PWA,
   update path) noticed, and only as "the SW is not active" — three layers away
   from the actual mistake. A parse costs a second per file and names the file.
   (Writing that terminator inside this comment would do the same thing here.)
   --------------------------------------------------------------------------- */
const { execFileSync } = require('child_process');
function shippedScripts(dir, acc) {
  acc = acc || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'vendor') return;    // third-party bundle, not ours to police
      shippedScripts(p, acc);
    } else if (/\.m?js$/.test(e.name)) {
      acc.push(p);
    }
  });
  return acc;
}
const shipped = shippedScripts(SITE);
ok('the site has scripts to check', shipped.length >= 10, shipped.length + ' found');
const unparseable = [];
shipped.forEach((f) => {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'ignore' }); }
  catch (e) { unparseable.push(path.relative(SITE, f)); }
});
ok('every shipped script parses', unparseable.length === 0, unparseable.join(', ') || '');
ok('sw.js is among them', shipped.some((f) => path.relative(SITE, f) === 'sw.js'));

/* The registration has to opt out of the HTTP cache, or the CDN's Browser
   Cache TTL decides when a deploy is seen. The header is out of our hands
   (see the note in pwa.js); this option is not, and it is the only thing
   standing between a visitor and a worker script four hours out of date. */
const pwaGlue = fs.readFileSync(path.join(SITE, 'assets/js/pwa.js'), 'utf8');
ok('the SW registration opts out of the HTTP cache',
  /updateViaCache:\s*['"]none['"]/.test(pwaGlue),
  /updateViaCache/.test(pwaGlue) ? 'present but not set to none' : 'no updateViaCache option');

/* ---------------------------------------------------------------------------
   Heading structure. This is how a screen-reader user navigates a page, and a
   skipped level is invisible in a screenshot: every page used to end its last
   <h2> section and then open the footer with <h4>Tools</h4>, so the heading
   list ran "…questions people ask" → "Tools" with nothing in between.
   --------------------------------------------------------------------------- */
const headingProblems = [];
PAGES.forEach((rel) => {
  const html = fs.readFileSync(path.join(SITE, rel), 'utf8');
  const levels = [];
  const re = /<h([1-4])[\s>]/g;
  let m;
  while ((m = re.exec(html))) levels.push(+m[1]);
  const jumps = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) jumps.push('h' + levels[i - 1] + '→h' + levels[i]);
  }
  if (levels[0] !== 1) headingProblems.push(rel + ': starts at h' + levels[0]);
  if (levels.filter((l) => l === 1).length !== 1) {
    headingProblems.push(rel + ': ' + levels.filter((l) => l === 1).length + ' h1');
  }
  if (jumps.length) headingProblems.push(rel + ': ' + jumps.join(', '));
});
ok('no page skips a heading level', headingProblems.length === 0, headingProblems.join(' | '));

/* ---------------------------------------------------------------------------
   Structured data. AI assistants and search engines read the JSON-LD, not the
   rendering, so a block that silently fails to parse (or that drifts away from
   the visible text) costs citations without ever looking broken on screen.
   --------------------------------------------------------------------------- */
function jsonLdBlocks(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
function entityTypes(block) {
  const types = [];
  const re = /"@type"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(block))) types.push(m[1]);
  return types;
}
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
function norm(s) {
  return decode(String(s)).replace(/<[^>]+>/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

const ldProblems = [];
const ldCounts = {};
PAGES.forEach((rel) => {
  const blocks = jsonLdBlocks(fs.readFileSync(path.join(SITE, rel), 'utf8'));
  ldCounts[rel] = blocks.length;
  blocks.forEach((raw, i) => {
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { ldProblems.push(rel + ' block ' + i + ': ' + e.message); return; }
    const flat = JSON.stringify(data);
    if (flat.indexOf('schema.org') === -1) ldProblems.push(rel + ' block ' + i + ': no @context');
  });
});
ok('every JSON-LD block parses', ldProblems.length === 0, ldProblems.join(' | '));
ok('every public page carries structured data',
  PUBLIC.every((p) => ldCounts[(p || '') + 'index.html'] > 0),
  PUBLIC.filter((p) => !ldCounts[(p || '') + 'index.html']).join(', ') || '');

/* The FAQ is the part an assistant is most likely to quote verbatim, and it is
   also the easiest thing to let drift: somebody edits the visible answer and
   the schema keeps the old wording. Every visible question must exist in the
   FAQPage entity with the same wording. */
const faqProblems = [];
PAGES.filter((rel) => rel !== 'stats/index.html').forEach((rel) => {
  const html = fs.readFileSync(path.join(SITE, rel), 'utf8');
  /* Scoped to the FAQ list on purpose: the tool panels carry their own
     <details> ("Advanced options") that is a control, not a question, and
     folding it in would demand a Question entity for a settings drawer. */
  const summaries = [];
  const visibleAnswers = [];
  const re = /<details class="faq__item"[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq__body">([\s\S]*?)<\/div>\s*<\/details>/g;
  let m;
  while ((m = re.exec(html))) { summaries.push(norm(m[1])); visibleAnswers.push(norm(m[2])); }
  /* Guard the guard. The line below returns early when no visible FAQ was
     found, which means a page that ships a FAQPage entity but marks its
     questions up with a different class would skip every check in this block
     and still report green. about / privacy / terms / share / stats genuinely
     carry no FAQ, so they are unaffected. */
  if (summaries.length === 0 && html.indexOf('"FAQPage"') !== -1) {
    faqProblems.push(rel + ': declares a FAQPage entity but no faq__item markup was '
      + 'found — the question and answer checks are silently skipping this page');
  }
  if (!summaries.length) return;
  const blocks = jsonLdBlocks(html);
  const asked = [];
  const schemaAnswers = [];
  blocks.forEach((raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node['@type'] === 'Question' && node.name) {
        asked.push(norm(node.name));
        const ans = node.acceptedAnswer;
        schemaAnswers.push(norm(ans && ans.text));
      }
      Object.keys(node).forEach((k) => walk(node[k]));
    };
    walk(data);
  });
  if (!asked.length) { faqProblems.push(rel + ': visible FAQ has no FAQPage entity'); return; }
  summaries.forEach((s, i) => {
    if (asked.indexOf(s) === -1) faqProblems.push(rel + ': "' + decode(s) + '" missing from schema');
  });
  /* Matching questions is not enough. The answer is the part an assistant
     actually quotes, and several of these answers carry numbers — a measured
     savings range, a fidelity floor, a byte count. An answer edited in the HTML
     while the schema keeps the old figure has the schema asserting something
     the page no longer claims, which is the failure this whole block exists to
     prevent. */
  summaries.forEach((s, i) => {
    const j = asked.indexOf(s);
    if (j === -1) return;
    const visible = visibleAnswers[i];
    const schema = schemaAnswers[j];
    if (visible && schema && visible !== schema) {
      faqProblems.push(rel + ': answer text differs from schema for "'
        + decode(s).slice(0, 48) + '" — run python _dev/sync-faq-schema.py');
    }
  });
  /* The drift runs both ways: a question deleted from the page but left in the
     schema is still a promise the page does not keep. */
  asked.forEach((q) => {
    if (summaries.indexOf(q) === -1) faqProblems.push(rel + ': stale schema question "' + q + '"');
  });
});
ok('every visible FAQ question and answer matches the schema',
  faqProblems.length === 0, faqProblems.join(' | '));

/* ---------------------------------------------------------------------------
   GEO entry points. llms.txt is the file AI crawlers look for first; robots.txt
   is where most sites accidentally block them. Both are invisible at runtime,
   so nothing else in the suite would notice if they went missing.
   --------------------------------------------------------------------------- */
const llms = fs.existsSync(path.join(SITE, 'llms.txt'))
  ? fs.readFileSync(path.join(SITE, 'llms.txt'), 'utf8') : '';
ok('llms.txt exists and is substantial', llms.length > 800, llms.length + ' chars');
ok('llms.txt states the no-upload guarantee',
  /no upload endpoint/i.test(llms), llms.slice(0, 80));
const sitemapUrls = (read('sitemap.xml').match(/<loc>([^<]+)<\/loc>/g) || [])
  .map((s) => s.replace(/<\/?loc>/g, ''));
const llmsMissing = sitemapUrls.filter((u) => llms.indexOf(u) === -1);
ok('llms.txt links every page in the sitemap',
  llmsMissing.length === 0, llmsMissing.join(', '));

const robotsTxt = fs.existsSync(path.join(SITE, 'robots.txt'))
  ? fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8') : '';
const wantedBots = ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended'];
const absentBots = wantedBots.filter((b) => {
  const block = robotsTxt.split('User-agent:').find((s) => s.trim().indexOf(b) === 0);
  return !block || !/Allow:\s*\//.test(block);
});
ok('robots.txt explicitly allows AI crawlers', absentBots.length === 0, absentBots.join(', '));

console.log('\n' + pass + ' / ' + (pass + fail) + ' page checks passed');
process.exit(fail ? 1 : 0);
