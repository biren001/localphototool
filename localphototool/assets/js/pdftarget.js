/* pdftarget.js — hit an exact upload limit, and lose the words if you must.
                  Not if you don't.

   Why this module exists (measured 2026-10-04; see _dev/measure-pdf-target.cjs
   and _dev/verify-pdf-target.py):

   "compress PDF to 100 KB" is a real search, and the tools that rank for it
   (compresspdfto100kb.com, textify.tools, resizepdf.in, kisspdf.net,
   scanpilot.ai) all do the same thing: they render each page to a canvas,
   re-encode the page as one JPEG and rebuild the PDF out of pictures. It gets
   under the limit, and it throws the words away — textify's own page says so.

   This site already had the answer next door: pdfcompress.re-encode() only the
   pictures *inside* the PDF and copies the fonts, the content streams and the
   page tree through untouched, so a two page document with body text came back
   at 74,894 bytes under a 100 KB limit with all 3,001 characters of text still
   there and still selectable. What it did not do was look for a target; it
   stopped at the quality you picked.

   So shrinkToFit() searches for the largest quality that still fits the limit,
   and only if quality alone cannot get there walks down a ladder of maximum
   edge widths. When nothing fits it reports the floor instead of handing back
   an unreadable file.

   Two shapes kept the search fast enough to run in a page. A clean binary
   search over quality costs a dozen encodes, and doing that for every rung of
   the edge ladder is thirty or forty encodes — minutes, not seconds. And the
   first version of this module counted any result it had measured as "the
   answer", so a 100 KB request on the photo fixture came back at 196 KB and
   reported success. So: find the widest edge that can reach the limit at all,
   then search quality on that one edge, and treat "found" as "fits" and
   nothing else. */
(function (global) {
  'use strict';

  var C = global.LPT && global.LPT.pdfcompress;
  if (!C) throw new Error('pdftarget needs the compressor to be loaded first');

  /* Widest first: the answer is more often "the pictures are too big" than
     "the quality was too high", and the first rung that reaches the limit wins. */
  var EDGES = [0, 1600, 1200, 1000, 800, 640, 480];

  /* The probe quality used to decide whether an edge can reach the limit at
     all. Low enough to be small, high enough that the test is meaningful. */
  var PROBE_Q = 0.2;

  /* Quality ladder, high to low. Sizes fall as quality falls, so the first rung
     that fits is the largest quality that fits and needs no refinement. */
  var SWEEP = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15, 0.08];
  var FLOOR_Q = 0.06;

  function run(u8, quality, maxDim, dropMetadata, allowWasm) {
    return C.compress(u8, {
      quality: quality,
      maxDim: maxDim || 0,
      dropMetadata: dropMetadata !== false,
      /* Carried by the caller so a measurement can pin one codec. See the note
         in pdfcompress.compress: sizes compared across two encoders would not
         be comparable, and whether the WASM module is loaded is not something
         the page can promise. */
      allowWasm: allowWasm !== false
    }).then(function (rep) {
      return { bytes: rep.blob ? rep.blob.size : u8.length, report: rep };
    });
  }

  function shrinkToFit(u8, opts) {
    opts = opts || {};
    var limit = (opts.targetKB || 100) * 1024;
    var edges = opts.edges && opts.edges.length ? opts.edges : EDGES;
    var dropMetadata = opts.dropMetadata !== false;
    /* Undefined means "whatever the engine prefers", which is what a visitor
       gets. A measurement passes it explicitly so the same number comes back
       whether or not the WASM module happened to load. */
    var allowWasm = opts.allowWasm;
    var steps = 0;
    var onStep = opts.onStep || null;

    function step(q, edge, bytes) {
      steps++;
      if (onStep) onStep({ quality: q, maxDim: edge, bytes: bytes, count: steps });
    }

    /* Pass 1 — the widest edge that can reach the limit at all. */
    return edges.reduce(function (chain, edge) {
      return chain.then(function (edge0) {
        if (edge0 !== undefined) return edge0;          /* already found one */
        return run(u8, PROBE_Q, edge, dropMetadata, allowWasm).then(function (out) {
          step(PROBE_Q, edge, out.bytes);
          if (out.bytes <= limit) return edge;
          return undefined;
        });
      });
    }, Promise.resolve()).then(function (edge0) {
      var chosenEdge = edge0 !== undefined ? edge0 : EDGES[EDGES.length - 1];

      /* Pass 2 — the largest quality on that edge that still fits. */
      var sweep = edge0 !== undefined
        ? SWEEP
        : SWEEP.concat([FLOOR_Q]);
      var fitting = null;

      /* SWEEP is already high to low, and it is walked as it stands: the first
         rung that fits is the largest quality that fits, and the moment it is
         found the search stops. An earlier version reversed this array, which
         made the search return the *smallest* quality it could get away with —
         the photo fixture came back at q=0.08 even at a 200 KB limit where
         q=0.45 was both reachable and twice as sharp. */
      return sweep.reduce(function (chain, q) {
        return chain.then(function () {
          if (fitting) return;
          return run(u8, q, chosenEdge, dropMetadata, allowWasm).then(function (out) {
            step(q, chosenEdge, out.bytes);
            if (out.bytes <= limit) fitting = { quality: q, bytes: out.bytes, report: out.report };
          });
        });
      }, Promise.resolve()).then(function () {
        return { edge: chosenEdge, fitting: fitting };
      });
    }).then(function (r) {
      var finalQ = r.fitting ? r.fitting.quality : FLOOR_Q;
      var finalEdge = r.edge;

      /* One last encode at exactly the settings being reported, so the file
         handed back is the file that was measured rather than a probe the
         search happened to end on. */
      return run(u8, finalQ, finalEdge, dropMetadata, allowWasm).then(function (out) {
        var rep = out.report;
        var passed = !!r.fitting && out.bytes <= limit;
        /* Which encoder answered the last call, reported rather than assumed:
           two files at the same quality can differ by about a tenth, and the
           page has to be able to say which one it produced. */
        var firstImage = rep.images && rep.images.length ? rep.images[0] : null;
        return {
          bytes: out.bytes,
          encoder: rep.encoder || (firstImage && firstImage.encoder) || 'native',
          /* A refused document never reaches the part of the compressor that
             builds a blob, so this is null rather than undefined-by-accident:
             the call site has to be able to fall back to the original bytes. */
          blob: rep.blob || null,
          sizeIn: u8.length,
          sizeOut: out.bytes,
          quality: finalQ,
          maxDim: finalEdge,
          replaced: rep.imagesReplaced,
          skipped: rep.imagesSkipped,
          kept: !!rep.kept,
          /* A refused document has to be recognisable at the call site, or the
             page would report "inside the target" about a file it did not
             touch and could not have read. */
          encrypted: !!rep.encrypted,
          passed: passed,
          /* When the limit is genuinely unreachable this is the smallest file
             the tool could produce, so the page can say so instead of lying. */
          floorBytes: passed ? null : out.bytes,
          steps: steps
        };
      });
    });
  }

  global.LPT = global.LPT || {};
  global.LPT.pdftarget = {
    shrinkToFit: shrinkToFit,
    EDGES: EDGES.slice(),
    SWEEP: SWEEP.slice()
  };
})(typeof self !== 'undefined' ? self : this);
