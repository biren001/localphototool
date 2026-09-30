/* ==========================================================================
   LocalPhotoTool — compression worker
   Classic worker: importScripts keeps this loadable from file:// as well,
   and dynamic import() inside gives us optional WASM codecs.
   ========================================================================== */
'use strict';

/* location.search carries the ?v= the page gave worker.js; forwarding it to
   engine.js keeps the worker's copy of the engine on the same version as the
   page's copy (caches key on the full URL, query included). */
importScripts('engine.js' + (location.search || ''));

var engine = self.LPT.engine;
var caps = null;

function ensureCaps(refresh) {
  if (caps && !refresh) return Promise.resolve(caps);
  return engine.capabilities().then(function (c) {
    caps = { formats: c.formats, wasm: c.wasm, reasons: c.reasons };
    return caps;
  });
}

self.onmessage = function (event) {
  var msg = event.data || {};

  /* Reporting readiness is cheap and safe to do for everybody: capabilities()
     probes the browser's own encoders and downloads nothing. */
  if (msg.type === 'warmup') {
    ensureCaps().then(function (c) {
      self.postMessage({ type: 'caps', payload: c });
    }).catch(function (err) {
      self.postMessage({ type: 'caps', payload: { formats: { webp: true, avif: false, png: true, jpeg: true }, wasm: {}, error: String(err && err.message) } });
    });
    return;
  }

  /* Codec downloads are opt-in and named, so one worker never pulls a codec the
     visitor cannot reach from their current settings. Reported per codec rather
     than once at the end: AOM alone can take ten seconds, and the status panel
     should not sit on "Browser codec" until then. */
  if (msg.type === 'prewarm') {
    (msg.formats || []).forEach(function (format) {
      engine.loadWasm(format).then(function () {
        return ensureCaps(true);
      }).then(function (c) {
        self.postMessage({ type: 'caps', payload: c });
      }).catch(function () {});
    });
    return;
  }

  if (msg.type !== 'compress') return;
  var id = msg.id;

  ensureCaps().then(function () {
    return engine.compress(msg.file, msg.options, {
      caps: caps.formats,
      report: function (frac, label) {
        self.postMessage({ type: 'progress', id: id, payload: { frac: frac, label: label } });
      }
    });
  }).then(function (result) {
    self.postMessage({ type: 'done', id: id, payload: result });
  }).catch(function (err) {
    self.postMessage({
      type: 'error', id: id,
      payload: { message: (err && err.message) || 'compression-failed' }
    });
  });
};
