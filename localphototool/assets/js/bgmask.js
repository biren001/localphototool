/* bgmask.js — a model-free background mask.
 *
 * What this is: a connected-region flood fill seeded from the frame border.
 * The border of a photo is almost always the background (product shots on
 * white, green-screen takes, black studio cards), so the pixels that look
 * like the border colour and touch the border are the background; whatever
 * the flood cannot reach is the subject. A neural network gets a better
 * hairline than this does — the point is that it needs no download, no
 * network call and no server, and the whole file is ~9 KB.
 *
 * Rules kept while writing it
 * - No dependency. No WebGL, no WASM, no fetch. Pure typed arrays.
 * - Bounded memory: the mask is computed on a downscaled copy for anything
 *   above 9 megapixels, then upscaled back, because iOS Safari refuses to
 *   allocate a canvas above roughly 16.7 megapixels.
 * - Every heuristic that could surprise a user (tolerance, despill) reports
 *   itself back, so the page can print what it did instead of pretending.
 *
 * LPTBg.compute(imageData, opts) -> { alpha, w, h, info }
 * LPTBg.compose(imageData, alpha) -> mutates the data's alpha channel
 */
(function () {
  'use strict';

  /* The mask is computed on a downscaled copy for anything above this. Four
     megapixels keeps the flood fill's stack (4 bytes per pixel) plus the
     mask and the pixel data inside the budget a mid-range phone can spare. */
  var MAX_WORK_PIXELS = 4000000;
  var TOLERANCES = [16, 24, 34, 48, 66, 90, 120];

  var LPTBg = {};

  /* The most common colour on the border, not the average: a subject that
     touches the edge must not drag the estimate towards itself. */
  function borderColour(data, w, h) {
    var step = Math.max(1, Math.round(Math.min(w, h) / 160));
    var samples = [];
    var x, y, o;

    for (x = 0; x < w; x += step) { o = x * 4; samples.push([data[o], data[o + 1], data[o + 2]]); }
    for (x = 0; x < w; x += step) { o = ((h - 1) * w + x) * 4; samples.push([data[o], data[o + 1], data[o + 2]]); }
    for (y = 0; y < h; y += step) { o = y * w * 4; samples.push([data[o], data[o + 1], data[o + 2]]); }
    for (y = 0; y < h; y += step) { o = (y * w + (w - 1)) * 4; samples.push([data[o], data[o + 1], data[o + 2]]); }

    /* bucket at 8 levels per channel, then keep the largest bucket */
    var counts = {}, best = null, bestKey = '';
    samples.forEach(function (s) {
      var key = ((s[0] >> 5) << 6) | ((s[1] >> 5) << 3) | (s[2] >> 5);
      counts[key] = (counts[key] || 0) + 1;
      if (!best || counts[key] > best) { best = counts[key]; bestKey = key; }
    });
    var sr = 0, sg = 0, sb = 0, n = 0;
    samples.forEach(function (s) {
      if ((((s[0] >> 5) << 6) | ((s[1] >> 5) << 3) | (s[2] >> 5)) === bestKey) {
        sr += s[0]; sg += s[1]; sb += s[2]; n++;
      }
    });
    if (!n) { sr = samples[0][0]; sg = samples[0][1]; sb = samples[0][2]; n = 1; }
    return { r: sr / n, g: sg / n, b: sb / n, samples: samples.length };
  }

  function isWithin(data, i, br, bg, bb, tol) {
    var dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb;
    return (dr * dr + dg * dg + db * db) <= tol * tol;
  }

  /* Flood fill from the four borders through pixels that already match the
     background colour. Anything unreached stays opaque, so a hole inside the
     subject — a hole in a guitar string, a gap between arms — survives. */
  function floodFromBorder(data, w, h, br, bg, bb, tol, reach) {
    /* Each pixel is pushed at most once (reach guards duplicates), so the
       stack is exactly as large as the image. */
    var stack = new Int32Array(w * h);
    var sp = 0;
    var x, y, o, i;

    function push(px, py) {
      if (px < 0 || py < 0 || px >= w || py >= h) return;
      i = py * w + px;
      if (reach[i] || !isWithin(data, i * 4, br, bg, bb, tol)) return;
      reach[i] = 1;
      stack[sp++] = i;
    }

    /* Seed: every border pixel that already matches counts as background. */
    for (x = 0; x < w; x++) {
      push(x, 0); push(x, h - 1);
    }
    for (y = 0; y < h; y++) {
      push(0, y); push(w - 1, y);
    }

    while (sp > 0) {
      i = stack[--sp];
      x = i % w; y = (i - x) / w;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    return reach;
  }

  /* Two 3x3 box passes over the mask: the hard cut leaves a stair-step edge,
     and one feathered pass is enough to soften it without smearing the
     subject's own outline. */
  function feather(src, w, h) {
    var pass = new Uint8ClampedArray(src.length);
    var out = new Uint8ClampedArray(src.length);
    var x, y, k, j, sum, n, i;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        sum = 0; n = 0;
        for (k = -1; k <= 1; k++) {
          var yy = y + k; if (yy < 0 || yy >= h) continue;
          for (j = -1; j <= 1; j++) {
            var xx = x + j; if (xx < 0 || xx >= w) continue;
            sum += src[yy * w + xx]; n++;
          }
        }
        pass[y * w + x] = sum / n;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        sum = 0; n = 0;
        for (k = -1; k <= 1; k++) {
          var y2 = y + k; if (y2 < 0 || y2 >= h) continue;
          for (j = -1; j <= 1; j++) {
            var x2 = x + j; if (x2 < 0 || x2 >= w) continue;
            sum += pass[y2 * w + x2]; n++;
          }
        }
        out[y * w + x] = sum / n;
      }
    }
    src.set(out);
    return src;
  }

  /* Green/cyan spill on the subject's edge: the same colour the background
     had, still sitting in the pixel. Removed in proportion to how much of
     the pixel survived the cut. */
  function despill(data, alpha, w, h, br, bg, bb) {
    var mx = Math.max(br, bg, bb), mn = Math.min(br, bg, bb);
    if (mx - mn < 40) return 0;                /* a grey background has no spill to speak of */
    var key = br === mx ? 0 : (bg === mx ? 1 : 2);
    var touched = 0;
    for (var i = 0, n = w * h; i < n; i++) {
      var a = alpha[i] / 255;
      if (a <= 0.02 || a >= 0.98) continue;
      var o = i * 4;
      var excess = data[o + key] - (data[o] + data[o + 1] + data[o + 2] - data[o + key]) / 2;
      if (excess > 5) {
        data[o + key] -= excess * 0.45 * a;
        touched++;
      }
    }
    return touched;
  }

  /**
   * opts: { mode: 'auto'|'white'|'black'|'green', tolerance: number }
   * mode 'auto' picks the first tolerance that clears a plausible share of
   * the frame; a fixed mode locks the estimate and the tolerance.
   */
  LPTBg.compute = function (data, w, h, opts) {
    opts = opts || {};
    var forced = opts.mode || 'auto';
    var border = borderColour(data, w, h);
    var br = border.r, bg = border.g, bb = border.b;

    if (forced === 'white') { br = 255; bg = 255; bb = 255; }
    else if (forced === 'black') { br = 0; bg = 0; bb = 0; }
    else if (forced === 'green') { /* the border already tells us; keep it */ }

    var list = TOLERANCES;
    var chosen = list[0], reach = null, i, n = w * h, cleared = 0;

    for (var t = 0; t < list.length; t++) {
      var tol = typeof opts.tolerance === 'number' ? opts.tolerance : list[t];
      var reach2 = floodFromBorder(data, w, h, br, bg, bb, tol, new Uint8Array(n));
      var touched = 0;
      for (i = 0; i < n; i++) if (reach2[i]) touched++;
      cleared = touched / n;
      chosen = tol;
      reach = reach2;
      if (forced !== 'auto') break;
      if (cleared >= 0.10) break;               /* the smallest cut that is clearly a cut */
    }

    var alpha = new Uint8ClampedArray(n);
    for (i = 0; i < n; i++) alpha[i] = reach[i] ? 0 : 255;
    feather(alpha, w, h);
    var despilled = despill(data, alpha, w, h, br, bg, bb);

    return {
      alpha: alpha,
      w: w,
      h: h,
      info: {
        mode: forced,
        tolerance: chosen,
        background: [Math.round(br), Math.round(bg), Math.round(bb)],
        cleared: cleared,
        despilled: despilled
      }
    };
  };

  /* Upscale a mask computed on a downscaled copy back to full size. */
  LPTBg.upscale = function (alpha, w, h, sw, sh) {
    var out = new Uint8ClampedArray(w * h);
    for (var y = 0; y < h; y++) {
      var sy = Math.min(sh - 1, (y * sh / h) | 0);
      for (var x = 0; x < w; x++) {
        var sx = Math.min(sw - 1, (x * sw / w) | 0);
        out[y * w + x] = alpha[sy * sw + sx];
      }
    }
    return out;
  };

  /* Write the mask into the pixel data's alpha channel. */
  LPTBg.compose = function (data, alpha) {
    for (var i = 0, n = alpha.length; i < n; i++) data[i * 4 + 3] = alpha[i];
    return data;
  };

  window.LPTBg = LPTBg;
})();
