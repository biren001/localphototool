/* A finish chime, synthesised on the spot.

   No audio file is shipped or fetched. Two reasons that matters here: the CSP
   stays free of a `media-src` entry, and the site keeps its promise that
   nothing is requested beyond the codecs the compressor itself needs. An
   oscillator costs nothing and can never 404.

   The tone is deliberately soft — a fifth apart, ~0.4s, low gain — because a
   batch can finish while someone is wearing headphones in a quiet room. */
(function () {
  'use strict';

  var STORE_KEY = 'lpt:chime';
  var ctx = null;

  function enabled() {
    try { return localStorage.getItem(STORE_KEY) !== 'off'; }
    catch (e) { return true; }   /* private mode: chime, but never persist */
  }

  function setEnabled(on) {
    try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch (e) {}
  }

  function context() {
    if (ctx) return ctx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch (e) { ctx = null; }
    return ctx;
  }

  function play(volume) {
    var ac = context();
    if (!ac) return false;

    /* Autoplay policy: the context starts suspended until a gesture happens.
       Resuming is best-effort — if it fails, the batch simply stays silent. */
    if (ac.state === 'suspended' && typeof ac.resume === 'function') {
      try { ac.resume(); } catch (e) { /* ignore */ }
    }

    var peak = typeof volume === 'number' ? volume : 0.12;
    var t0 = ac.currentTime + 0.02;

    var master = ac.createGain();
    master.gain.value = peak;
    master.connect(ac.destination);

    /* A5 → E6: a rising fifth reads as "finished" without sounding urgent. */
    [[880.0, 0], [1318.5, 0.11]].forEach(function (note) {
      var osc = ac.createOscillator();
      var env = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = note[0];
      var t = t0 + note[1];

      /* Exponential ramps cannot touch zero, hence the 0.0001 floor. */
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);

      osc.connect(env);
      env.connect(master);
      osc.start(t);
      osc.stop(t + 0.34);
    });

    return true;
  }

  window.LPTChime = {
    play: play,
    enabled: enabled,
    setEnabled: setEnabled
  };
})();
