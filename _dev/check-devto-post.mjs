/* Verify a published dev.to post still carries what we put on it.

   The reason this exists: the whole point of posting on dev.to is a page that
   gets indexed and links back to the site, and dev.to can silently take that
   away. It withholds `noindex, nofollow` from any post that has not gained
   traction yet (measured 2026-09-23: 6/6 of the latest feed had it, 0/8 of the
   top-of-week did), and an empty tag list means the post never reaches the tag
   feeds, so it can never gain the traction that lifts the gate. Both are
   invisible in the editor and easy to miss.

   Usage:  node _dev/check-devto-post.mjs <post-url>

   Exits 1 if anything that decides whether the post is worth anything fails.
*/

const POST = process.argv[2];
if (!POST) {
  console.error('usage: node _dev/check-devto-post.mjs <dev.to post url>');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SITE = 'localphototool.com';

const text = async (u) => {
  const r = await fetch(u, { headers: { 'user-agent': UA, accept: '*/*' } });
  return { status: r.status, body: await r.text() };
};

const m = POST.match(/dev\.to\/([^/]+)\/([^/?#]+)/);
if (!m) {
  console.error(`cannot read a username and slug out of ${POST}`);
  process.exit(2);
}
const [, user, slug] = m;

let fails = 0;
const check = (ok, label, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// --- what Forem itself stored -------------------------------------------
const api = await text(`https://dev.to/api/articles/${user}/${slug}`);
console.log(`API /api/articles/${user}/${slug} -> HTTP ${api.status}`);
if (api.status !== 200) {
  console.error('  the API cannot see this article, so nothing below can be trusted');
  process.exit(1);
}
const a = JSON.parse(api.body);
console.log(`  published_at ${a.published_at}   reactions ${a.public_reactions_count}   comments ${a.comments_count}`);
console.log(`  tag_list     ${JSON.stringify(a.tag_list)}`);
console.log();

console.log('stored state');
check((a.tag_list || []).length >= 3, 'at least 3 tags stored', `got ${(a.tag_list || []).length}`);
check(!!a.cover_image, 'cover image stored', a.cover_image ? 'yes' : 'none');
check(a.url === POST || POST.startsWith(a.url), 'API url matches the one we asked about', a.url);
console.log();

// --- what the rendered page says ----------------------------------------
const page = await text(POST);
const h = page.body;
console.log(`page -> HTTP ${page.status}, ${h.length} bytes`);

const allRobots = [...h.matchAll(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/gi)].map((x) => x[1]);
const noindex = allRobots.some((x) => /noindex/i.test(x));
const nofollow = allRobots.some((x) => /nofollow/i.test(x));
const canonical = (h.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [, null])[1];
const ogImage = (h.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [, null])[1];
const backlinks = [...h.matchAll(/<a\b[^>]*href=["']([^"']*localphototool\.com[^"']*)["'][^>]*>/gi)];

console.log();
console.log('rendered page');
console.log(`  robots meta tags: ${JSON.stringify(allRobots)}`);
check(!noindex, 'not marked noindex', noindex ? 'dev.to is still gating it — no search value yet' : 'indexable');
check(!nofollow, 'not marked nofollow', nofollow ? 'its links pass nothing yet' : 'links are followed');
check(!!canonical && canonical.includes('dev.to/'), 'canonical is the post itself', canonical || 'none');
check(!/localphototool\.com/.test(canonical || ''), 'canonical does NOT point at our own site', 'would deindex the post');
check(!!ogImage, 'og:image present', ogImage ? 'yes' : 'none');
check(backlinks.length > 0, `links back to ${SITE}`, `${backlinks.length} found`);
for (const b of backlinks.slice(0, 5)) {
  const rel = (b[0].match(/rel=["']([^"']*)["']/) || [, '(none)'])[1];
  console.log(`        ${b[1]}  rel="${rel}"`);
  check(!/nofollow/i.test(rel), '  that link is not rel=nofollow', rel);
}
console.log();

// --- the body survived ---------------------------------------------------
const wanted = [
  'Every image compressor I tried',
  'Two bugs I shipped before I measured anything',
  '24-54%',
  '41-68%',
  'The honest limits',
];
console.log('body phrases');
for (const p of wanted) check(h.includes(p), `"${p}"`);

console.log();
console.log(fails === 0 ? 'all checks passed' : `${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
