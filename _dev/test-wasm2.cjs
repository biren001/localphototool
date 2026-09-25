const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
  const p = await b.newPage();
  await p.goto('about:blank');
  const urls = [
    'https://esm.sh/@jsquash/avif@1.4.0?target=es2022',
    'https://cdn.jsdelivr.net/npm/@jsquash/avif@1.4.0/+esm',
    'https://esm.sh/@jsquash/avif@1.3.0',
    'https://esm.sh/@jsquash/avif@1.4.0/encode'
  ];
  for (const url of urls) {
    const r = await p.evaluate(async (u) => {
      try {
        const m = await import(u);
        const enc = m.encode || (m.default && m.default.encode) || (m.default && typeof m.default === 'function' ? m.default : null);
        if (!enc) return { ok: false, err: 'no encode export: ' + Object.keys(m).join(',') };
        const img = { data: new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]), width: 2, height: 2 };
        const t = Date.now();
        const out = await enc(img, { quality: 50 });
        return { ok: true, ms: Date.now() - t, bytes: out.byteLength || out.length };
      } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 140) }; }
    }, url).catch(e => ({ ok: false, err: 'EVAL ' + e.message.slice(0, 100) }));
    console.log(url.padEnd(52), JSON.stringify(r));
  }
  await b.close();
})();
