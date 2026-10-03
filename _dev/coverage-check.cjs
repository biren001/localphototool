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
    'smaller image', 'how do i resize', 'too large to upload', 'too large to attach'
  ],
  'heic-to-jpg': [
    'heic', 'iphone', 'apple', "won't open", 'cannot open',
    'won\'t it open', 'open in', 'jpeg', 'convert heic', 'screenshot iphone'
  ],
  'remove-background': [
    'remove background', 'cut out', 'cut out the', 'delete the background',
    'transparent background', 'transparent png',
    'background from a', 'product photo'
  ],
  'compress-photos-for-email': [
    'attach', 'attachment', 'email', 'e-mail', 'mail server', 'bounce', 'smtp',
    'too large to send', 'size limit', 'mb limit', 'inbox', 'gmail', 'outlook'
  ],
  'images-to-pdf': [
    'pdf', 'document', 'print', 'a4', 'letter size', 'page size', 'merge',
    'combine', 'photos into', 'screenshot to pdf', 'jpg to pdf', 'scan'
  ],
  'watermark': [
    'watermark', 'logo', 'stamp', 'copyright', 'brand', 'transparent watermark',
    'text on a photo', 'overlay', 'do not let anyone use', 'proof', 'draft'
  ],
  'metadata-editor': [
    'metadata', 'exif', 'copyright', 'author', 'title', 'alt text', 'description',
    'gps', 'date taken', 'camera', 'lens', 'aperture', 'edit the'
  ],
  'transfer': [
    'send', 'another device', 'another phone', 'without a cable', 'qr code',
    'airdrop', 'share link', 'wi-fi', 'between computers', 'move photos',
    'offline transfer', 'no account'
  ],
  /* —— 下面这组是 v76 之后补的，之前从没单独体检过 —— */
  'batch-rename': [
    'rename', 'file name', 'filename', 'file names', 'batch', 'bulk',
    'all at once', 'many photos', 'sort', 'number the', 'IMG_', 'name them',
    'organize', 'tidy up'
  ],
  'image-to-base64': [
    'base64', 'data url', 'data uri', 'embed', 'paste into', 'paste it into',
    'encode the image', 'copy the code', 'inline', 'text box'
  ],
  'exif-viewer': [
    'exif', 'metadata', 'focal length', 'iso', 'shutter',
    'exposure', 'camera', 'lens', 'aperture', 'date taken', 'gps', 'read'
  ],
  'remove-gps-from-photo': [
    'gps', 'location', 'privacy', 'latitude', 'longitude', 'coordinates',
    'track me', 'metadata', 'sharing a photo', 'remove location'
  ],
  'share': [
    'share', 'share a link', 'copy link', 'qr code', 'airdrop', 'send',
    'without an account', 'no sign-up', 'another device', 'download'
  ],
  /* 合成组：本身不对应目录，展开成下面 ALIAS 里的一批页逐个查 */
  'convert-formats': [
    'convert', 'convert to', 'format', 'png', 'jpg', 'jpeg', 'webp', 'gif',
    'transparent', 'lossless', 'browser', 'without uploading', 'image format'
  ],
  'reduce-image-size': [
    'smaller file', 'file size', 'image file size', 'reduce the size',
    'reduce image size', 'bytes', 'kb', 'mb', 'shrink'
  ],
  'compress': [
    'compress', 'compressor', 'file size', 'smaller', 'kb', 'mb',
    'without losing quality', 'lossy', 'quality', 'upload', 'shrink'
  ]
};

const brief = process.argv.includes('--brief');

/* 合成组 → 真实目录名。没有这一层，convert-formats 会一路报 MISSING PAGE。 */
const ALIAS = {
  'convert-formats': ['jpg-to-png', 'jpg-to-webp', 'png-to-jpg', 'webp-to-jpg', 'webp-to-png']
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

for (const [group, phrases] of Object.entries(GROUPS)) {
  const slugs = ALIAS[group] || [group];
  for (const slug of slugs) {
    const html = readPage(slug);
    if (!html) { console.log(slug + '  -> MISSING PAGE'); continue; }
    const vis = visibleText(html);
    const label = slugs.length > 1 ? group + ' [' + slug + ']' : slug;
    console.log('=== ' + label + '  (visible ' + vis.length + ' chars) ===');
    let zero = 0;
    for (const ph of phrases) {
      const n = count(vis, ph);
      if (n === 0) zero++;
      if (brief) { if (n === 0) console.log('  MISS  "' + ph + '"'); continue; }
      console.log('  ' + (n > 0 ? 'OK  ' : 'MISS') + ' n=' + String(n).padEnd(3) + '  "' + ph + '"');
    }
    console.log('  --> 可见文本里 0 命中的词: ' + zero + ' / ' + phrases.length);
    console.log('');
  }
}
