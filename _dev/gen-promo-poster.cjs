/* Renders the WeChat Moments promo posters (CN + EN) from an HTML template.
   The QR image is inlined as base64 so the render is fully offline. */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PROMO = path.join(ROOT, 'promo');
const QR = path.join(PROMO, 'qr-code-1024.png');
const CHROME =
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const W = 1080;
const H = 1350;

const ICON = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4f46e5"/><stop offset="0.55" stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <g fill="none" stroke="#ffffff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 22v-4a2 2 0 0 1 2-2h12"/><path d="M46 30v14a2 2 0 0 1-2 2H26"/>
    <path d="m24 33 5-6 5 5"/><path d="M34 27v14"/>
  </g>
</svg>`;

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const CONTENT = {
  en: {
    font: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
    brand: 'LocalPhotoTool',
    title: 'Shrink your photos.<br>Nothing leaves your phone.',
    sub: 'A free image compressor that runs entirely in your browser.',
    points: [
      'Batch-compress hundreds of photos at once',
      'Up to 90% smaller — you pick the quality',
      'No upload, no sign-up, no watermark'
    ],
    scan: 'Scan to open',
    domain: 'localphototool.com',
    foot: ['Works on iPhone, Android and desktop', 'Free · Nothing to install · Nothing uploaded']
  },
  cn: {
    font: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif',
    brand: 'LocalPhotoTool',
    title: '压缩图片<br>不用上传到任何服务器',
    sub: '一个完全在你浏览器里运行的免费图片压缩工具',
    points: [
      '一次批量压缩上百张照片',
      '体积最多可减 90%，清晰度自己定',
      '不上传 · 不注册 · 无水印'
    ],
    scan: '长按识别二维码 · 或微信扫一扫',
    domain: 'localphototool.com',
    foot: ['iPhone / 安卓 / 电脑 都能用', '免费 · 无需安装 App · 图片不上传任何服务器']
  }
};

function page(lang, qrB64) {
  const c = CONTENT[lang];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { width:${W}px; height:${H}px; }
    body {
      font-family:${c.font};
      background:
        radial-gradient(900px 620px at 12% 8%, rgba(124,58,237,.42), transparent 62%),
        radial-gradient(760px 560px at 88% 34%, rgba(6,182,212,.24), transparent 60%),
        linear-gradient(168deg, #0a0f22 0%, #101433 48%, #0a1026 100%);
      color:#fff; -webkit-font-smoothing:antialiased;
      display:flex; flex-direction:column; padding:62px 72px 56px;
    }
    .brand { display:flex; align-items:center; gap:16px; }
    .brand svg { width:56px; height:56px; border-radius:15px; box-shadow:0 10px 26px rgba(79,70,229,.45); }
    .brand span { font-size:29px; font-weight:700; letter-spacing:.2px; }
    .kicker {
      margin-top:16px; font-size:19px; font-weight:600; letter-spacing:2.6px;
      text-transform:uppercase; color:#7dd3fc;
    }
    .title {
      margin-top:18px; font-size:${lang === 'cn' ? 72 : 66}px; line-height:1.14;
      font-weight:800; letter-spacing:-1px;
    }
    .sub { margin-top:18px; font-size:26px; line-height:1.5; color:#c3cae4; max-width:840px; }
    ul { margin-top:30px; list-style:none; display:flex; flex-direction:column; gap:16px; }
    li { display:flex; align-items:center; gap:15px; font-size:28px; color:#e6e9f5; font-weight:500; }
    li svg { width:29px; height:29px; flex:0 0 29px; color:#22d3ee; }
    .card {
      margin-top:auto; background:#fff; border-radius:30px; padding:22px 28px 18px;
      display:flex; flex-direction:column; align-items:center; gap:10px;
      box-shadow:0 26px 60px rgba(6,10,30,.55);
    }
    .card img { width:404px; height:404px; display:block; }
    .scan { font-size:22px; font-weight:700; color:#4f46e5; letter-spacing:.3px; }
    .domain { font-size:37px; font-weight:800; color:#0f172a; letter-spacing:-.5px; }
    .foot {
      margin-top:22px; text-align:center; font-size:20px; color:#93a0c0; line-height:1.6;
    }
    .foot b { color:#c3cae4; font-weight:600; }
  </style></head><body>
    <div class="brand">${ICON}<span>${c.brand}</span></div>
    <div class="kicker">Free · Private · In your browser</div>
    <h1 class="title">${c.title}</h1>
    <p class="sub">${c.sub}</p>
    <ul>${c.points.map((p) => `<li>${CHECK}<span>${p}</span></li>`).join('')}</ul>
    <div class="card">
      <img src="data:image/png;base64,${qrB64}" alt="QR code for localphototool.com">
      <div class="scan">${c.scan}</div>
      <div class="domain">${c.domain}</div>
    </div>
    <p class="foot">${c.foot.join('<br>')}</p>
  </body></html>`;
}

(async () => {
  fs.mkdirSync(PROMO, { recursive: true });
  const qrB64 = fs.readFileSync(QR).toString('base64');

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    for (const lang of ['en', 'cn']) {
      const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await p.setContent(page(lang, qrB64), { waitUntil: 'load' });
      await p.waitForTimeout(400);

      /* The Moments thumbnail is a centre-cropped square, so everything that
         has to stay readable must sit inside y = (H-W)/2 .. (H+W)/2. */
      const box = await p.evaluate(() => {
        const r = (s) => {
          const el = document.querySelector(s);
          const b = el.getBoundingClientRect();
          return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
        };
        return { title: r('.title'), card: r('.card'), foot: r('.foot') };
      });
      const safeTop = (H - W) / 2;
      const safeBottom = (H + W) / 2;
      const inside = box.title.top >= safeTop && box.card.bottom <= safeBottom;
      console.log(
        `  ${lang}: title.top=${box.title.top} card.bottom=${box.card.bottom} ` +
          `safe=${safeTop}..${safeBottom} → ${inside ? 'INSIDE square crop' : 'CLIPPED'}`
      );

      const out = path.join(PROMO, `poster-${lang}.png`);
      await p.screenshot({ path: out });
      await p.close();
      console.log('wrote', path.basename(out), Math.round(fs.statSync(out).size / 1024) + 'KB');
    }
  } finally {
    await browser.close();
  }
})();
