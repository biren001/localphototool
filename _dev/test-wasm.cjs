const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const p = await b.newPage();
  await p.goto('about:blank');
  for (const url of [
    'https://esm.sh/@jsquash/jpeg@1.4.0',
    'https://esm.sh/@jsquash/webp@1.4.0',
    'https://esm.sh/@jsquash/avif@1.4.0'
  ]) {
    const r = await p.evaluate(async (u) => {
      try {
        const m = await import(u);
        const enc = m.encode || (m.default && m.default.encode);
        // actually run a tiny encode to prove the wasm initialises
        const img = { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), width: 2, height: 2 };
        const out = await enc(img, { quality: 75 });
        return { ok: true, bytes: out.byteLength || out.length, keys: Object.keys(m).slice(0, 6).join(',') };
      } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 160) }; }
    }, url).catch(e => ({ ok: false, err: 'EVAL ' + e.message.slice(0, 120) }));
    console.log(url.padEnd(40), JSON.stringify(r));
  }
  await b.close();
})();
