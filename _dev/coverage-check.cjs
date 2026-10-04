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
    'won\'t it open', 'open in', 'jpeg', 'convert heic', 'iphone screenshot'
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
  ],
  /* v80 新页的体检组：检索形状来自「想让 PDF 变小」这件事的说法 —— 有人搜动词
     （shrink / compress / reduce / optimize），有人只说结果（too large / too big），
     还有一批说的是顾虑（会不会上传、文字还在不在）。「PDF 压缩」这个词本身不列，
     因为它是品类名而不是人会说出口的话。 */
  'compress-pdf': [
    'shrink a pdf', 'shrink the pdf', 'shrink pdf',
    'compress a pdf', 'compressing a pdf',
    'reduce the size of a pdf', 'reduce the pdf size',
    'make a pdf smaller',
    'smaller pdf', 'smaller file',
    'pdf too large', 'too large to email',
    'optimize a pdf', 'optimize the pdf',
    'without uploading', 'no upload',
    'in your browser', 'on your device', 'locally',
    'keep the text', 'text still', 'still selectable', 'selectable',
    'how do i make a pdf smaller',
    'password protected', 'encrypted', 'scanned',
    'file size limit', 'attachment'
  ],
  /* v83 新页的体检组。检索形状分三拨：① 动词怎么换（merge / combine / join，
     还常带数量 two / multiple），② 结果怎么说（into one pdf、single pdf、
     merged file），③ 顾虑（要不要上传、有没有附件大小限制、扫的件带密码怎么办）。
     「PDF 合并」「merge pdf online free」这类品类名 / 广告词不列——它不是人会打出来的话。 */
  'merge-pdf': [
    'merge pdf', 'merge pdf files', 'merge two pdf', 'multiple pdf files',
    'combine pdf', 'combine pdf files', 'join pdf',
    'into one pdf', 'single pdf', 'merged file',
    'page order', 'without uploading', 'no upload',
    'in your browser', 'on your device', 'locally',
    'file size limit', 'attachment',
    'password protected', 'encrypted', 'scanned', 'how do i merge'
  ],
  /* v84 新页的体检组。这一拨的检索形状是「一个具体的数字」，不是动词：
     ① 数字本身（100 kb / 200 kb / 100kb，大小写和空格两种写法都列，因为人会
     照着表单上的写法打），② 「压到某个尺寸」的说法（under 100 kb、target
     size、limit），③ 还是那三个老顾虑——上传、可选文字、加密件。
     「best pdf compressor」这类品类名同样不列。 */
  'compress-pdf-to-100kb': [
    'compress a pdf to 100 kb', 'compress pdf to 100 kb', 'compress pdf to 100kb',
    '100 kb', '100kb', 'under 100 kb', '100 kb limit', '100 kb budget',
    'compress a pdf to 200 kb', 'compress a pdf to 500 kb', '200 kb', '500 kb',
    'target size', 'land under', 'upload limit', 'file size limit',
    'without uploading', 'no upload', 'in your browser', 'on your device', 'locally',
    'text still', 'still selectable', 'selectable', 'keep the text',
    'password protected', 'encrypted'
  ],
  /* v85 新页的体检组。这一拨的检索形状是「一个失败的动作 + 一句自问」，
     和前面几组的动词 / 数字都不一样：① 想拿字的人怎么打（pdf to text、
     extract text from a pdf、copy text from a pdf —— 三个动词几乎换着用），
     ② 失败现场的自述（can't select the text、selectable text、highlight、
     paste 出来的框是空的），③ 疑难名词（no text layer、subset font、
     character map、encrypted、password protected、scanned pdf、ocr）。
     「pdf to text online free」这类广告词不列。 */
  'why-cant-i-select-the-text-in-this-pdf': [
    'pdf to text', 'extract text from a pdf', 'copy text from a pdf',
    "why can't i select the text", 'select the text', 'selectable text',
    'text layer', 'no text layer',
    'scanned pdf', 'highlight', 'paste', 'nothing to copy', 'image only',
    'subset font', 'character map',
    'password protected', 'encrypted', 'ocr'
  ],
  /* 竞品评论区里真实出现过的抱怨措辞（v79 挖的）。这批词不在上面任何组里，
     因为它们说的是「用户为什么走掉」而不是「用户怎么搜」。 */
  'compress-pain-points': [
    "won't get smaller", 'not getting smaller', 'doesn\'t get smaller',
    'came back bigger', 'bigger than the original', 'bigger than before',
    'keep the original', 'original bytes', 'already optimal',
    'one at a time', 'to a server', 'random server',
    'barely got smaller', 'barely smaller',
    'second pass', 'run it again', 'compress it again',
    'media library', 'by hand', 'daily limit'
  ]
};

const brief = process.argv.includes('--brief');

/* 合成组 → 真实目录名。没有这一层，convert-formats 会一路报 MISSING PAGE。 */
const ALIAS = {
  'convert-formats': ['jpg-to-png', 'jpg-to-webp', 'png-to-jpg', 'webp-to-jpg', 'webp-to-png'],
  /* 痛点措辞要落在「主压缩器」和「讲这件事的信息页」两处，缺一不可：
     前者承接搜索词，后者承接"我就是想知道为什么"。 */
  'compress-pain-points': ['compress', 'why-my-image-wont-get-smaller']
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
