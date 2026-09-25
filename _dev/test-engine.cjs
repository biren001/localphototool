/* Dev-only harness: exercises the pure-JS parts of the engine under Node. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'localphototool');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function load(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sandbox = {
    console, performance, Promise, Math, JSON, Date, Array, Object, Number, String,
    Uint8Array, Uint8ClampedArray, Int16Array, Uint32Array, Float32Array, Float64Array,
    ArrayBuffer, DataView, TextEncoder, Blob, Response, CompressionStream, URL, setTimeout,
    isNaN, Infinity, NaN, Error, TypeError, RangeError,
  };
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const script = new vm.Script(src, { filename: file });
  script.runInContext(sandbox, {
    // The engine lazily dynamic-imports optional WASM codecs; under Node we
    // simply resolve them to "unavailable" instead of hitting the network.
    importModuleDynamically: () => Promise.reject(new Error('no-cdn-in-node')),
  });
  return sandbox.LPT;
}

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  — ' + extra : ''));
}

(async function main() {
  console.log('\n=== Loading modules ===');
  const zip = load('assets/js/zip.js').zip;
  const engine = load('assets/js/compressor/engine.js').engine;
  check('zip.js loads', !!zip && typeof zip.create === 'function');
  check('engine.js loads', !!engine && typeof engine._internal === 'function' || !!engine._internal);
  const I = engine._internal;

  /* ---------------- CRC32 ---------------- */
  console.log('\n=== CRC32 ===');
  const crc = I.crc32(new TextEncoder().encode('123456789'));
  check('CRC32 matches the standard check value 0xCBF43926', crc === 0xcbf43926, '0x' + crc.toString(16));

  /* ---------------- Median cut ---------------- */
  console.log('\n=== Median-cut quantizer ===');
  // 64x64 with 4 distinct colours -> palette should be near-exact.
  const W = 64, H = 64;
  const flat = new Uint8ClampedArray(W * H * 4);
  const cols = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  for (let i = 0; i < W * H; i++) {
    const c = cols[Math.floor(i / 1024) % 4];
    flat[i * 4] = c[0]; flat[i * 4 + 1] = c[1]; flat[i * 4 + 2] = c[2]; flat[i * 4 + 3] = 255;
  }
  const q = I.medianCut(flat, 256);
  check('medianCut returns a palette', !!q && q.palette.length >= 3);
  check('medianCut marked the flat image as exact', q.exact === true, 'count=' + q.count);
  const mapped = I.mapToPalette(flat, W, H, q.palette, q.count, false);
  let maxErr = 0;
  for (let i = 0; i < W * H; i++) {
    const p = mapped[i];
    maxErr = Math.max(maxErr,
      Math.abs(q.palette[p * 3] - flat[i * 4]),
      Math.abs(q.palette[p * 3 + 1] - flat[i * 4 + 1]),
      Math.abs(q.palette[p * 3 + 2] - flat[i * 4 + 2]));
  }
  check('4-colour image round-trips losslessly', maxErr === 0, 'max channel error = ' + maxErr);

  // Gradient -> heavy quantization; check the dither path runs and error is bounded.
  const grad = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      grad[i] = Math.round((x / (W - 1)) * 255);
      grad[i + 1] = Math.round((y / (H - 1)) * 255);
      grad[i + 2] = 128;
      grad[i + 3] = 255;
    }
  }
  const gq = I.medianCut(grad, 64);
  check('medianCut caps the palette at the requested size', gq.count <= 64, 'count=' + gq.count);
  const gMapPlain = I.mapToPalette(grad, W, H, gq.palette, gq.count, false);
  const gMapDith = I.mapToPalette(grad, W, H, gq.palette, gq.count, true);
  check('plain mapping produces one index per pixel', gMapPlain.length === W * H);
  check('dithered mapping produces one index per pixel', gMapDith.length === W * H);
  check('dithering changes the output (it is actually applied)',
    gMapDith.some((v, i) => v !== gMapPlain[i]));
  check('all indices are inside the palette', (() => {
    for (let i = 0; i < gMapDith.length; i++) if (gMapDith[i] >= gq.count) return false;
    return true;
  })());

  /* ---------------- Indexed PNG writer ---------------- */
  console.log('\n=== Indexed PNG writer ===');
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W + 1)] = 0;
    Buffer.from(gMapDith.buffer, y * W, W).copy(raw, y * (W + 1) + 1);
  }
  const compressed = await I.deflateZlib(new Uint8Array(raw));
  check('CompressionStream("deflate") produced zlib bytes', compressed.length > 8);
  check('zlib header is valid (0x78)', compressed[0] === 0x78, '0x' + compressed[0].toString(16));

  const pngBlob = I.buildIndexedPng(gMapDith, W, H, gq.palette, gq.count, compressed);
  const pngBytes = Buffer.from(await pngBlob.arrayBuffer());
  fs.writeFileSync(path.join(OUT, 'indexed.png'), pngBytes);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  check('PNG signature is correct', sig.every((b, i) => pngBytes[i] === b));
  check('PNG carries the image/png MIME type', pngBlob.type === 'image/png');

  // Walk the chunk list and verify every CRC.
  let off = 8;
  const chunkTypes = [];
  let crcOk = true;
  while (off < pngBytes.length) {
    const len = pngBytes.readUInt32BE(off);
    const type = pngBytes.toString('ascii', off + 4, off + 8);
    chunkTypes.push(type);
    const body = pngBytes.subarray(off + 4, off + 8 + len);
    const stored = pngBytes.readUInt32BE(off + 8 + len);
    if (I.crc32(body) !== stored) crcOk = false;
    off += 12 + len;
  }
  check('every PNG chunk CRC verifies', crcOk);
  check('chunk order is IHDR, PLTE, IDAT…, IEND',
    chunkTypes[0] === 'IHDR' && chunkTypes[1] === 'PLTE' && chunkTypes[chunkTypes.length - 1] === 'IEND',
    chunkTypes.join(','));
  check('IEND terminates exactly at the end of the file', off === pngBytes.length);

  // Round-trip the IDAT payload.
  const idatParts = [];
  off = 8;
  while (off < pngBytes.length) {
    const len = pngBytes.readUInt32BE(off);
    const type = pngBytes.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idatParts.push(pngBytes.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const zlibStream = Buffer.concat(idatParts);
  const inflated = await new Response(
    new Blob([zlibStream]).stream().pipeThrough(new DecompressionStream('deflate'))
  ).arrayBuffer();
  const back = Buffer.from(inflated);
  check('IDAT inflates to the expected scanline count', back.length === (W + 1) * H,
    back.length + ' vs ' + ((W + 1) * H));
  let scanOk = true;
  for (let y = 0; y < H; y++) {
    if (back[y * (W + 1)] !== 0) scanOk = false;                    // filter byte
    for (let x = 0; x < W; x++) {
      if (back[y * (W + 1) + 1 + x] !== gMapDith[y * W + x]) scanOk = false;
    }
  }
  check('pixel indices survive the PNG round-trip intact', scanOk);

  /* ---------------- PSNR metric ---------------- */
  console.log('\n=== PSNR metric ===');
  const a = new Uint8ClampedArray(64 * 64 * 4).fill(120);
  const b = new Uint8ClampedArray(a);
  check('identical images score 99 dB (capped)', engine.psnr(a, b, 64, 64) === 99);
  const c2 = new Uint8ClampedArray(a);
  for (let i = 0; i < c2.length; i += 4) c2[i] = 130; // +10 on red
  const v = engine.psnr(a, c2, 64, 64);
  check('a +10 channel shift yields a finite, sane PSNR', v > 20 && v < 45, v.toFixed(2) + ' dB');

  /* ---------------- ZIP ---------------- */
  console.log('\n=== ZIP writer ===');
  const enc = new TextEncoder();
  const zipBlob = zip.create([
    { name: 'alpha.webp', data: enc.encode('hello localphototool') },
    { name: '../evil/name.png', data: enc.encode('path traversal attempt') },
    { name: 'unicode-日本語-é.jpg', data: enc.encode('utf8 filename') },
    { name: 'alpha.webp', data: enc.encode('duplicate name') },
  ]);
  const zipBytes = Buffer.from(await zipBlob.arrayBuffer());
  fs.writeFileSync(path.join(OUT, 'archive.zip'), zipBytes);
  check('ZIP starts with the local file header signature', zipBytes.readUInt32LE(0) === 0x04034b50);
  check('ZIP ends with the EOCD signature',
    zipBytes.readUInt32LE(zipBytes.length - 22) === 0x06054b50);
  check('ZIP declares 4 entries', zipBytes.readUInt16LE(zipBytes.length - 22 + 10) === 4);
  check('path traversal characters are neutralised', zip.sanitizeName('../../etc/passwd') === '.._.._etc_passwd'
    || zip.sanitizeName('../../etc/passwd').indexOf('/') === -1,
    zip.sanitizeName('../../etc/passwd'));

  // Verify each local entry's CRC against its payload.
  let zoff = 0, entryCrcOk = true, entries = 0;
  while (zoff < zipBytes.length && zipBytes.readUInt32LE(zoff) === 0x04034b50) {
    const crc = zipBytes.readUInt32LE(zoff + 14);
    const size = zipBytes.readUInt32LE(zoff + 18);
    const nameLen = zipBytes.readUInt16LE(zoff + 26);
    const extraLen = zipBytes.readUInt16LE(zoff + 28);
    const start = zoff + 30 + nameLen + extraLen;
    const payload = zipBytes.subarray(start, start + size);
    if (I.crc32(payload) !== crc) entryCrcOk = false;
    zoff = start + size;
    entries++;
  }
  check('all 4 local entries have valid CRC32 checksums', entryCrcOk && entries === 4);

  /* ---------------- Worker source sanity ---------------- */
  console.log('\n=== Worker source ===');
  const workerSrc = fs.readFileSync(path.join(ROOT, 'assets/js/compressor/worker.js'), 'utf8');
  check('worker imports the shared engine', /importScripts\('engine\.js'\)/.test(workerSrc));
  check('worker exposes a compress message handler', /msg\.type !== 'compress'/.test(workerSrc));

  console.log('\n=== HTML / asset wiring ===');
  const toolHtml = fs.readFileSync(path.join(ROOT, 'compress/index.html'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT, 'assets/js/compressor/app.js'), 'utf8');
  const idsInApp = [...appSrc.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  // Ids the app creates at runtime via el({id}) are legitimate absentees.
  const builtAtRuntime = new Set(
    [...appSrc.matchAll(/id:\s*'([A-Za-z0-9_-]+)'/g)].map(m => m[1])
  );
  const missing = [...new Set(idsInApp)]
    .filter(id => !builtAtRuntime.has(id))
    .filter(id => !new RegExp('id="' + id + '"').test(toolHtml));
  check('every element id referenced by app.js exists in the page', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : 'checked ' + new Set(idsInApp).size + ' ids');
  check('engine.js is loaded before app.js',
    toolHtml.indexOf('compressor/engine.js') < toolHtml.indexOf('compressor/app.js'));
  check('zip.js is loaded before app.js',
    toolHtml.indexOf('zip.js') < toolHtml.indexOf('compressor/app.js'));

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================');
  console.log(results.length - failed.length + ' / ' + results.length + ' checks passed');
  if (failed.length) {
    console.log('FAILED: ' + failed.map(f => f.name).join(' | '));
    process.exitCode = 1;
  }
  console.log('Artifacts written to ' + OUT);
})();
