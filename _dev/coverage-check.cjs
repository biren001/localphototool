/* coverage-check: 诊断三步的第三步。
   对指定页查「用户说这件事的语言」在「可见正文」里出现了几次 ——
   0 命中 = 这一页的查询形状没有语言承接，改文案比改标题改链接都划算。
   用法: node _dev/coverage-check.cjs [--dir=localphototool] */
// 用法: node _dev/coverage-check.cjs [--dir=localphototool]
const fs = require('fs');
const path = require('path');

/* __dirname 是 _dev/ （不是 _dev/.tmp/），所以往上只有一层才是工作副本根。
   写死 '../..' 会落到 <workdir>/localphototool 之外，页面全部报 MISSING。 */
const ROOT = path.resolve(__dirname, '..', 'localphototool');

// 每个候选页一组「真实检索词」（大小写不敏感）
const GROUPS = {
  'resize-image': [
    'resize an image', 'resize image', 'resize photo', 'resize the image',
    'image too big', 'photo too big', 'image too large', 'photo too large',
    'make it smaller', 'make an image smaller', 'make photo smaller',
    'change image size', 'change the size of', 'image dimensions', 'pixel dimensions',
    'smaller image', 'how do i resize'
  ],
  'heic-to-jpg': [
    'heic', 'iphone', 'apple', 'photo won', "won't open", 'cannot open', 'can not open',
    'open in', 'jpeg instead', 'convert heic', 'apple photo', 'screenshot iphone'
  ],
  'remove-background': [
    'remove background', 'cut out', 'cut the background', 'delete the background',
    'transparent background', 'transparent png', 'without background',
    'background from a', 'product photo', 'logo background'
  ]
};

function count(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  const low = hay.toLowerCase(), nl = needle.toLowerCase();
  while ((i = low.indexOf(nl, i)) >= 0) { n++; i += Math.max(nl.length, 1); }
  return n;
}

// 实体解码 + 标签剥离：' 会写成 &#39;，正文里 apostrophe 必须能匹配上
function unescapeHtml(s) {
  return s
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&copy;/g, '©');
}

function visibleText(html) {
  // 只看 main，剥掉 script/style/comment，再剥标签
  let s = html.replace(/<main[\s\S]*?<\/main>/i, (m) => m);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  return unescapeHtml(s);
}

function readPage(slug) {
  const p = path.join(ROOT, slug, 'index.html');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

// 只统计 <main> 里的（title/meta 不算「正文语言」）
function mainOf(html) {
  const m = html.match(/<main[\s\S]*?<\/main>/i);
  return m ? m[0] : html;
}

for (const [slug, phrases] of Object.entries(GROUPS)) {
  const html = readPage(slug);
  if (!html) { console.log(slug + '  -> MISSING PAGE'); continue; }
  const vis = visibleText(html);
  console.log('=== ' + slug + '  (visible ' + vis.length + ' chars) ===');
  let zero = 0;
  for (const ph of phrases) {
    const n = count(vis, ph);
    if (n === 0) zero++;
    console.log('  ' + (n > 0 ? 'OK  ' : 'MISS') + ' n=' + String(n).padEnd(3) + '  "' + ph + '"');
  }
  console.log('  --> 可见文本里 0 命中的词: ' + zero + ' / ' + phrases.length);
  console.log('');
}
