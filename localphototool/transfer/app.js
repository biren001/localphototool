/* LocalPhotoTool /transfer/ — private device-to-device transfer
 *
 * Signaling has two backends behind one interface:
 *   A) same-origin built-in signaling (/api/*)  <- probed first
 *   B) PeerJS public cloud (active on this static hosting)
 * On Cloudflare Pages there is no same-origin backend, so /api/create comes
 * back as a non-JSON 404 and the code falls back to the public signaling
 * service automatically. Signaling only relays SDP/ICE — file bytes never
 * touch it.
 */
'use strict';

/* Asset version — the HTML's version guard checks this. When changing this
   file, bump ALL of: __BEAM_VER__ here, the "?v=" in index.html, the guard's
   expected number in index.html, and VERSION in ../sw.js. */
window.__BEAM_VER__ = 33;

(function () {
  // ---------- helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  var CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  // 15KB: just under PeerJS's internal chunking threshold (~16300 B). At 16KB
  // every chunk got silently re-fragmented by PeerJS on top of our own
  // slicing — pure overhead and one more layer to lose packets in.
  var CHUNK = 15 * 1024;

  function randCode(n) {
    var s = '', bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    for (var i = 0; i < n; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return s;
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function now() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  // Diagnostics line (see #beamDiag in the HTML): renders before anything can
  // fail, so even a broken-pairing screenshot carries the three facts that
  // decide whether pairing can work at all.
  try {
    $('beamDiag').textContent = 'beam v' + window.__BEAM_VER__ +
      ' · WebRTC ' + (typeof RTCPeerConnection !== 'undefined' ? 'ok' : 'MISSING') +
      (navigator.serviceWorker && navigator.serviceWorker.controller ? ' · SW-managed' : ' · SW bypassed');
  } catch (e) {}

  // ICE servers: Google STUN first (most of this site's audience is outside
  // CN); the CN-reachable ones stay as fallbacks for visitors behind the GFW.
  // STUN only helps punch a hole for the direct link — it relays nothing.
  // When both networks are too strict for hole-punching (carrier-grade NAT,
  // locked-down office firewalls), ICE falls back to the public TURN relay.
  // TURN forwards the already-encrypted DTLS stream; it cannot read the
  // content and stores nothing. Self-hosting a relay later only means
  // swapping these URLs.
  var ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.miwifi.com:3478' },
      { urls: 'stun:stun.chat.bilibili.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:80?transport=tcp',
          'turn:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  };

  // ---------- state ----------
  var wires = [];              // live peer connections
  var incoming = {};           // in-flight transfers
  var currentIncoming = null;  // chunks belong to the transfer announced last
  var fileSeq = 0;
  var backendName = '';
  var stopSignaling = null;    // cancels the active poll loop + closes its RTCPeerConnection

  // ---------- dom ----------
  var home = $('home'), chat = $('chat');
  var qrBox = $('qrBox'), codeDisplay = $('codeDisplay'), hostStatus = $('hostStatus');
  var joinCode = $('joinCode'), joinBtn = $('joinBtn'), joinStatus = $('joinStatus');
  var copyLinkBtn = $('copyLinkBtn');
  var messages = $('messages'), textInput = $('textInput');
  var sendBtn = $('sendBtn'), attachBtn = $('attachBtn'), fileInput = $('fileInput');
  var connState = $('connState'), connText = $('connText');
  var leaveBtn = $('leaveBtn');

  function setStatus(el, text, cls) {
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }
  function enterChat() {
    home.hidden = true;
    chat.hidden = false;
    connState.className = 'dot';
    connText.textContent = 'Connected over ' + backendName + ' — you can close this page any time; nothing is kept.';
    refreshCompose();
    textInput.focus();
  }
  function markDisconnected() {
    connState.className = 'dot bad';
    connText.textContent = 'The other device went offline — sending is disabled. Nothing was kept. Re-pair to continue.';
    refreshCompose();
  }
  // Compose controls are only live while at least one wire is actually open.
  function refreshCompose() {
    var live = wires.some(function (w) { return w.open; });
    [textInput, sendBtn, attachBtn, fileInput].forEach(function (el) { el.disabled = !live; });
  }
  // Liveness heartbeat: a silently departed peer (closed tab, killed browser,
  // dropped network) never fires the channel's close event, so without this
  // the other side keeps "sending" into a dead connection. Ping every 3s;
  // 12s without any inbound data means the peer is gone — UNLESS the send
  // buffer is actively draining, because bufferedAmount shrinking means the
  // peer's transport layer is consuming our bytes: the link is demonstrably
  // alive even if pongs are momentarily delayed. Without that guard a busy
  // mid-transfer peer could be killed for "silence" it didn't commit.
  setInterval(function () {
    var live = wires.filter(function (w) { return w.open; });
    live.forEach(function (w) { w.send(JSON.stringify({ t: 'ping' })); });
    var dead = live.filter(function (w) {
      var buf = w.buffered();
      if (typeof w._lastBuf === 'number' && buf < w._lastBuf) w.lastSeen = Date.now();
      w._lastBuf = buf;
      return Date.now() - (w.lastSeen || 0) > 12000;
    });
    dead.forEach(function (w) {
      w.open = false;
      w.close();
      wires = wires.filter(function (x) { return x !== w; });
    });
    if (dead.length && wires.filter(function (w) { return w.open; }).length === 0 && !chat.hidden) markDisconnected();
  }, 3000);
  // Connection status where the user can actually see it. A guest arriving via
  // an invite link never sees #home, so joinStatus alone is invisible: every
  // connection state must ALSO land in the chat header. Before this fix the
  // header showed the static "Connected" wording from the HTML even when no
  // connection existed, and Send silently did nothing.
  function connStatus(text, cls) {
    connState.className = 'dot' + (cls === 'err' ? ' bad' : cls === 'ok' ? '' : ' wait');
    connText.textContent = text;
  }
  function guestStatus(t, c) {
    setStatus(joinStatus, t, c);
    if (!chat.hidden) connStatus(t, c);
  }

  // Leave button: tear everything down, wipe every trace on this page and go
  // back to a fresh start — the UI counterpart of closing/refreshing the page,
  // for people who don't want to close the tab.
  function endSession() {
    if (stopSignaling) { try { stopSignaling(); } catch (e) {} stopSignaling = null; }
    if (hostKeepalive) { clearInterval(hostKeepalive); hostKeepalive = null; }
    wires.forEach(function (w) { if (w.close) { try { w.close(); } catch (e) {} } w.open = false; });
    wires = [];
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    incoming = {}; currentIncoming = null;
    messages.innerHTML = '';
    textInput.value = '';
    // Drop the invite hash so a refresh won't silently rejoin a dead session.
    if (location.hash) {
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch (e) { location.hash = ''; }
    }
    chat.hidden = true;
    home.hidden = false;
    // Don't let the old invite linger on screen while the new session starts.
    codeDisplay.textContent = '······';
    qrBox.innerHTML = '';
    joinCode.value = '';
    setStatus(joinStatus, '');
    startHost();
  }
  function addBubble(mine, build) {
    var msg = document.createElement('div');
    msg.className = 'msg' + (mine ? ' mine' : '');
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    build(bubble, msg);
    msg.appendChild(bubble);
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    return msg;
  }
  function addText(mine, text, time) {
    addBubble(mine, function (bubble, msg) {
      bubble.textContent = text;
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = (time || now()) + (mine ? ' · you' : ' · other device');
      msg.appendChild(meta);
    });
  }

  // ---------- wire: one unified interface over RTCDataChannel / PeerJS ----------
  function makeRtcWire(ch, handlers) {
    var wire = {
      kind: 'rtc',
      open: false,
      lastSeen: Date.now(),  // same liveness contract as makePeerWire
      send: function (d) {
        if (ch.readyState !== 'open') return;
        if (typeof d === 'string' || d instanceof ArrayBuffer) ch.send(d);
        else ch.send(JSON.stringify(d));
      },
      buffered: function () { return ch.bufferedAmount; },
      close: function () { try { ch.close(); } catch (e) {} },
    };
    ch.binaryType = 'arraybuffer';
    ch.onopen = function () { wire.open = true; handlers.open(); };
    ch.onclose = function () { wire.open = false; handlers.close(); };
    ch.onerror = function () { wire.open = false; handlers.close(); };
    ch.onmessage = function (e) { wire.lastSeen = Date.now(); handlers.data(e.data); };
    if (ch.readyState === 'open') { wire.open = true; setTimeout(handlers.open, 0); }
    return wire;
  }
  function makePeerWire(conn, handlers) {
    var wire = {
      kind: 'peerjs',
      open: false,
      lastSeen: Date.now(),   // any inbound data refreshes this; the heartbeat judges liveness by it
      send: function (d) { if (conn.open) conn.send(d); },
      buffered: function () { return conn.dataChannel ? conn.dataChannel.bufferedAmount : 0; },
      close: function () { try { conn.close(); } catch (e) {} },
    };
    conn.on('open', function () { wire.open = true; handlers.open(); });
    conn.on('data', function (d) { wire.lastSeen = Date.now(); handlers.data(d); });
    conn.on('close', function () { wire.open = false; handlers.close(); });
    conn.on('error', function () { wire.open = false; handlers.close(); });
    if (conn.open) { wire.open = true; setTimeout(handlers.open, 0); }
    return wire;
  }

  // ---------- messages ----------
  function registerWire(wire) {
    wires.push(wire);
    if (wire.open) enterChat();
  }
  function wireHandlers() {
    return {
      open: function () { enterChat(); },
      close: function () {
        wires = wires.filter(function (w) { return w !== this; }, this);
        if (wires.filter(function (w) { return w.open; }).length === 0) markDisconnected();
      },
      data: function (d) { onWireData(d); },
    };
  }
  function broadcast(payload) {
    var s = typeof payload === 'string' ? payload : JSON.stringify(payload);
    wires.forEach(function (w) { if (w.open) w.send(s); });
  }
  // Inbound messages MUST be processed strictly in wire order, but binary
  // chunks need an async unpack (Blob.arrayBuffer) while control messages
  // are plain strings. Handling file-end synchronously let it overtake the
  // chunk promises still queued behind it: the receiver "finished" a file
  // with most of its chunks unaccounted for (e.g. 0.8 KB of 184 KB), the
  // rest were dropped as ownerless, and the heartbeat then killed a link
  // that was actually fine. One ordered promise chain fixes the ordering
  // for every message kind; there is exactly one live wire at a time here,
  // so a single chain cannot cross-block.
  var inboundQueue = Promise.resolve();
  function queueInbound(step) {
    inboundQueue = inboundQueue.then(step).catch(function () {});
  }
  function onWireData(d) {
    if (typeof d === 'string') {
      var msg;
      try { msg = JSON.parse(d); } catch (e) { return; }
      queueInbound(function () { handleMessage(msg); });
    } else if (d instanceof ArrayBuffer) {
      queueInbound(function () { pushChunk(d); });
    } else if (typeof Blob !== 'undefined' && d instanceof Blob) {
      d.arrayBuffer().then(function (ab) { queueInbound(function () { pushChunk(ab); }); });
    }
  }
  function pushChunk(ab) {
    if (!currentIncoming) return;
    var st = incoming[currentIncoming];
    if (!st) return;
    st.chunks.push(ab);
    st.received += ab.byteLength;
    st.msg._bar(Math.min(st.received / st.meta.size, 1));
  }
  function handleMessage(msg) {
    if (msg.t === 'ping') { broadcast({ t: 'pong' }); return; }
    if (msg.t === 'pong') return;   // liveness only — lastSeen already refreshed on receipt
    if (msg.t === 'text') { addText(false, msg.v, msg.at); return; }
    if (msg.t === 'file-head') {
      var id = msg.id;
      var el = addBubble(false, function (bubble, wrap) {
        var name = document.createElement('span');
        name.className = 'fname';
        name.textContent = msg.name;
        var size = document.createElement('div');
        size.className = 'meta';
        size.textContent = fmtBytes(msg.size) + ' · receiving…';
        var bar = document.createElement('div');
        bar.className = 'progress';
        var fill = document.createElement('div');
        bar.appendChild(fill);
        bubble.appendChild(name); bubble.appendChild(size); bubble.appendChild(bar);
        wrap._bar = function (p, ok) {
          fill.style.width = Math.round(Math.min(p, 1) * 100) + '%';
          if (p >= 1) size.textContent = ok === false
            ? fmtBytes(msg.size) + ' · incomplete'
            : fmtBytes(msg.size) + ' · received ✓';
        };
      });
      incoming[id] = { meta: msg, chunks: [], received: 0, msg: el };
      currentIncoming = id;
      return;
    }
    if (msg.t === 'file-end') {
      var st = incoming[msg.id];
      if (!st) return;
      delete incoming[msg.id];
      if (currentIncoming === msg.id) currentIncoming = null;
      var blob = new Blob(st.chunks, { type: st.meta.mime || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var bubble = st.msg.querySelector('.bubble');
      var isImg = /^image\//.test(st.meta.mime);
      // The byte count is the only truth. A short blob is a broken file: say
      // so, keep the bar honest, and do NOT offer a download of bytes we
      // know are incomplete.
      var complete = blob.size === st.meta.size;
      if (!complete) {
        var warn = document.createElement('div');
        warn.className = 'meta';
        warn.textContent = 'Received ' + fmtBytes(blob.size) + ' of ' + fmtBytes(st.meta.size) + ' — the transfer was interrupted, please send this file again.';
        bubble.appendChild(warn);
      }
      if (isImg && complete) {
        var img = document.createElement('img');
        img.src = url; img.alt = st.meta.name;
        bubble.appendChild(img);
      }
      if (complete) {
        var link = document.createElement('a');
        link.href = url; link.download = st.meta.name;
        link.textContent = isImg ? 'Download original' : 'Save file';
        bubble.appendChild(link);
      }
      st.msg._bar(complete ? 1 : st.received / st.meta.size, complete);
    }
  }

  // ---------- sending ----------
  function notConnectedFeedback() {
    connStatus('No connection yet — nothing was sent. Keep this page open on BOTH devices and wait for "Connected" at the top; if it stays here, the two networks could not link directly.', 'err');
  }
  function sendText() {
    var v = textInput.value.trim();
    if (!v) return;
    if (!wires.some(function (w) { return w.open; })) { notConnectedFeedback(); return; }
    broadcast({ t: 'text', v: v, at: now() });
    addText(true, v, now());
    textInput.value = '';
    textInput.focus();
  }
  function sendFile(file, done) {
    var wire = wires.filter(function (w) { return w.open; })[0];
    if (!wire) { notConnectedFeedback(); if (done) done(); return; }
    var id = 'f' + (++fileSeq);
    var bar = null, fill = null, sizeEl = null;
    addBubble(true, function (bubble) {
      var name = document.createElement('span');
      name.className = 'fname';
      name.textContent = file.name;
      sizeEl = document.createElement('div');
      sizeEl.className = 'meta';
      sizeEl.textContent = fmtBytes(file.size) + ' · sending…';
      bar = document.createElement('div');
      bar.className = 'progress';
      fill = document.createElement('div');
      bar.appendChild(fill);
      bubble.appendChild(name); bubble.appendChild(sizeEl); bubble.appendChild(bar);
      if (/^image\//.test(file.type)) {
        var thumb = document.createElement('img');
        thumb.src = URL.createObjectURL(file);
        thumb.alt = file.name;
        bubble.appendChild(thumb);
      }
    });
    wire.send(JSON.stringify({ t: 'file-head', id: id, name: file.name, size: file.size, mime: file.type }));

    var offset = 0;
    (function pump() {
      if (!wire.open) { sizeEl.textContent = fmtBytes(file.size) + ' · failed'; if (done) done(); return; }
      if (offset >= file.size) {
        wire.send(JSON.stringify({ t: 'file-end', id: id }));
        sizeEl.textContent = fmtBytes(file.size) + ' · sent ✓';
        if (done) done();
        return;
      }
      if (wire.buffered() > 4 * CHUNK) { setTimeout(pump, 40); return; }
      var end = Math.min(offset + CHUNK, file.size);
      file.slice(offset, end).arrayBuffer().then(function (ab) {
        wire.send(ab);
        offset = end;
        fill.style.width = Math.round((offset / file.size) * 100) + '%';
        pump();
      }).catch(function () { sizeEl.textContent = fmtBytes(file.size) + ' · failed'; if (done) done(); });
    })();
  }

  // Files must travel one at a time: the receiver tracks a single "currently
  // receiving" entry, so concurrent pumps would interleave chunks of two
  // files and corrupt both. Chain every send behind the previous one.
  var sendChain = Promise.resolve();
  function enqueueFile(file) {
    sendChain = sendChain.then(function () {
      return new Promise(function (finished) { sendFile(file, finished); });
    }).catch(function () {});
  }

  // ---------- signaling backend A: same-origin long polling ----------
  // Instead of "probing" for a local backend (a probe with a short timeout
  // misjudges a cold-starting server and silently falls back to the blocked
  // public cloud), the real request IS the test: if create/join comes back as
  // valid JSON we stay same-origin, and only a transport-level failure or a
  // non-JSON answer (pure static hosting) switches us to the cloud backend.
  function postJson(path, body, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 10000);
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        clearTimeout(timer);
        var j = null;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        return { status: r.status, json: j };
      });
    }).catch(function () { clearTimeout(timer); return null; });
  }
  function postJsonRetry(path, body, tries) {
    var n = tries || 2;
    function attempt(i) {
      return postJson(path, body).then(function (r) {
        // retry only on transport failure (null), never on a real HTTP answer
        if (r === null && i + 1 < n) return new Promise(function (res) {
          setTimeout(function () { res(attempt(i + 1)); }, 1200);
        });
        return r;
      });
    }
    return attempt(0);
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }

  // Re-announce the host's room with the SAME code (idempotent on the server).
  // Managed hosting recycles the node process, which wipes in-memory rooms —
  // without this, the guest is told "no such session" and gives up, even though
  // the host is still sitting there with a perfectly good code on screen.
  function announceHost(code) {
    return post('/api/create', { code: code });
  }

  function pollHost(code, onStatus, onError, onWire) {
    var since = 0, pc = null, iceBuf = [], stopped = false, gotPeer = false;

    function signal(type, data) {
      return post('/api/signal', { code: code, role: 'host', type: type, data: data });
    }
    function attachIce(pc2) {
      pc2.onicecandidate = function (e) { if (e.candidate) signal('ice', e.candidate); };
      pc2.onconnectionstatechange = function () {
        if (pc2.connectionState === 'failed') onError('The direct connection failed — most likely both networks block peer-to-peer traffic.');
      };
    }
    function startPc() {
      if (pc) return;
      pc = new RTCPeerConnection(ICE);
      attachIce(pc);
      var ch = pc.createDataChannel('beam', { ordered: true });
      var wire = makeRtcWire(ch, {
        open: function () { registerWire(wire); onStatus('Connected', 'ok'); },
        close: function () { wires = wires.filter(function (w) { return w !== wire; }); if (!wires.some(function (w) { return w.open; })) markDisconnected(); },
        data: onWireData,
      });
      if (onWire) onWire(wire);
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer).then(function () { return signal('offer', pc.localDescription); });
      }).then(function () {
        iceBuf.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
        iceBuf = [];
      }).catch(function () { onError('Could not start the connection negotiation.'); });
    }
    function loop() {
      fetch('/api/poll?role=host&code=' + code + '&since=' + since)
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.error === 'no-such-session') {
            // The room is gone (server restarted). Recreate it under the same
            // code so the invite the other device already scanned still works.
            onStatus('Session lost on the server — restoring it…');
            announceHost(code);
            if (!stopped) setTimeout(loop, 1200);
            return;
          }
          (r.messages || []).forEach(function (m) {
            if (m.type === 'joined') { gotPeer = true; onStatus('Other device found — establishing a direct connection…'); startPc(); }
            else if (m.type === 'answer' && pc) pc.setRemoteDescription(new RTCSessionDescription(m.data));
            else if (m.type === 'ice') {
              var c = new RTCIceCandidate(m.data);
              if (pc && pc.remoteDescription) pc.addIceCandidate(c).catch(function () {}); else iceBuf.push(c);
            }
          });
          if (typeof r.lastId === 'number') since = Math.max(since, r.lastId);
          if (!stopped) loop();
        })
        .catch(function () { if (!stopped) setTimeout(loop, 1500); });
    }
    loop();
    return function stop() {
      stopped = true;
      if (pc) { try { pc.close(); } catch (e) {} }
    };
  }

  // Guest side. The caller must have joined the session already (POST /api/join),
  // otherwise the host never learns a guest arrived and never creates an offer.
  function pollGuest(code, onStatus, onError, onWire) {
    var since = 0, pc = null, iceBuf = [], stopped = false, missing = 0;

    function signal(type, data) {
      return post('/api/signal', { code: code, role: 'guest', type: type, data: data });
    }
    function handle(m) {
      if (m.type === 'offer' && !pc) {
        pc = new RTCPeerConnection(ICE);
        pc.onicecandidate = function (e) { if (e.candidate) signal('ice', e.candidate); };
        pc.onconnectionstatechange = function () {
          if (pc.connectionState === 'failed') onError('The direct connection failed — most likely both networks block peer-to-peer traffic.');
        };
        pc.ondatachannel = function (e) {
          var wire = makeRtcWire(e.channel, {
            open: function () { registerWire(wire); onStatus('Connected', 'ok'); },
            close: function () { wires = wires.filter(function (w) { return w !== wire; }); if (!wires.some(function (w) { return w.open; })) markDisconnected(); },
            data: onWireData,
          });
          if (onWire) onWire(wire);
        };
        pc.setRemoteDescription(new RTCSessionDescription(m.data)).then(function () {
          iceBuf.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
          iceBuf = [];
          return pc.createAnswer();
        }).then(function (a) {
          return pc.setLocalDescription(a).then(function () { signal('answer', pc.localDescription); });
        }).catch(function () { onError('Could not answer the connection offer.'); });
      } else if (m.type === 'ice') {
        var c = new RTCIceCandidate(m.data);
        if (pc && pc.remoteDescription) pc.addIceCandidate(c).catch(function () {}); else iceBuf.push(c);
      }
    }
    function loop() {
      fetch('/api/poll?role=guest&code=' + code + '&since=' + since)
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.error === 'no-such-session') {
            // Mid-session restart: the host re-announces every few seconds, so
            // wait for it to come back instead of failing outright.
            if (missing++ < 15) { onStatus('Session interrupted — waiting for the other device…'); if (!stopped) setTimeout(loop, 1500); return; }
            onError('No session with that code. Check the code and try again.');
            return;
          }
          missing = 0;
          (r.messages || []).forEach(handle);
          if (typeof r.lastId === 'number') since = Math.max(since, r.lastId);
          if (!stopped) loop();
        })
        .catch(function () { if (!stopped) setTimeout(loop, 1500); });
    }
    loop();
    return function stop() {
      stopped = true;
      if (pc) { try { pc.close(); } catch (e) {} }
    };
  }

  // ---------- signaling backend B: PeerJS public cloud (static-only hosting) ----------
  var peer = null;
  var backendCloud = false;
  var serverRetries = 0; // reset per pairing attempt in startHost/startGuest
  function cloudHost(onCode, onStatus, onError) {
    backendCloud = true;
    var code = randCode(6);
    // The code is generated locally, so the invite goes on screen before the
    // signaling connection opens — but as PENDING: it is not a valid session
    // until the pairing service has accepted the registration. A device that
    // types this code too early gets a retry, not a dead end.
    onCode(code, true);
    var open = false;
    var timer = setTimeout(function () {
      if (!open) onError('Could not reach the pairing service. This network appears to block it — try a different network, for example a mobile hotspot.');
    }, 12000);
    peer = new Peer('beam-' + code, { config: ICE });
    peer.on('open', function () {
      open = true;
      clearTimeout(timer);
      onCode(code, false); // now actually registered and reachable
    });
    // Mobile networks drop long-lived sockets; re-register so the shown code
    // stays alive instead of silently dying.
    peer.on('disconnected', function () {
      if (!peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
    });
    peer.on('connection', function (conn) {
      var wire = makePeerWire(conn, {
        open: function () { registerWire(wire); onStatus('Connected', 'ok'); },
        close: function () { wires = wires.filter(function (w) { return w !== wire; }); if (!wires.some(function (w) { return w.open; })) markDisconnected(); },
        data: onWireData,
      });
      if (onWire) onWire(wire);
    });
    peer.on('error', function (err) {
      var t = (err && err.type) || 'unknown';
      if (t === 'unavailable-id') { if (peer) peer.destroy(); cloudHost(onCode, onStatus, onError); return; }
      if (t === 'network' && open) { try { peer.reconnect(); } catch (e) {} return; }
      // server-error: the pairing service failed the registration itself —
      // usually transient, and VPN / proxy exit IPs are frequent offenders.
      if (t === 'server-error' && !open) {
        clearTimeout(timer);
        if (serverRetries < 2) {
          serverRetries++;
          onStatus('The pairing service hiccuped — retrying…');
          // Be gentle with the free shared service: wait longer between attempts.
          setTimeout(function () { cloudHost(onCode, onStatus, onError); }, serverRetries === 1 ? 2500 : 5000);
        } else {
          onError('The pairing service itself reported an error (server-error), not this network. Wait half a minute, then click the create/join button again. Also make sure you are using the code currently shown on the other device — an old code from before that page was refreshed will not work.');
        }
        return;
      }
      if (!open) { clearTimeout(timer); onError('Could not reach the pairing service (' + t + '). This network appears to block it — try a different network, for example a mobile hotspot.'); }
    });
  }
  function cloudGuest(code, onStatus, onError, onWire) {
    backendCloud = true;
    if (peer) { try { peer.destroy(); } catch (e) {} }
    peer = new Peer({ config: ICE });
    var open = false;
    var attempts = 0;
    var settled = false;
    var timer = setTimeout(function () {
      if (!open) onError('Could not reach the pairing service. This network appears to block it — try a different network, for example a mobile hotspot.');
    }, 12000);
    // The host's code may not be registered yet (it shows before its signaling
    // connection opens), and a mistyped code looks identical. Retry a few
    // times, then say so plainly instead of hanging on "Connecting…".
    function fail() {
      if (settled) return;
      settled = true;
      onError('No session answered that code. Make sure the other device still shows it — if that page was closed or refreshed, it now shows a different code — then try again.');
    }
    function retry() {
      if (settled) return;
      if (attempts < 4) { setTimeout(function () { if (!settled) attempt(); }, 1200); }
      else fail();
    }
    function attempt() {
      attempts++;
      // If the session exists but the two networks cannot punch a direct link
      // and TURN cannot carry it either, the browser stays silent forever.
      // Give the handshake a deadline and say what actually failed.
      var iceTimer = setTimeout(function () {
        if (!settled) {
          settled = true;
          onError('The devices found each other but could not establish the connection — at least one of the two networks is blocking peer-to-peer traffic. A different network (for example phone cellular data instead of office WiFi) usually works.');
        }
      }, 25000);
      var conn = peer.connect('beam-' + code, { reliable: true });
      var wire = makePeerWire(conn, {
        open: function () { clearTimeout(iceTimer); settled = true; registerWire(wire); onStatus('Connected', 'ok'); },
        close: function () { wires = wires.filter(function (w) { return w !== wire; }); if (!wires.some(function (w) { return w.open; })) markDisconnected(); },
        data: onWireData,
      });
      if (onWire) onWire(wire);
      conn.on('error', retry);
    }
    peer.on('open', function () { open = true; clearTimeout(timer); onStatus('Connecting…'); attempt(); });
    peer.on('error', function (err) {
      var t = (err && err.type) || 'unknown';
      if (t === 'peer-unavailable') { retry(); return; }
      // server-error: the pairing service itself rejected or failed the
      // request. It is usually transient (the free service is shared), and
      // VPN / proxy exit IPs are frequent offenders — a fresh peer often
      // just works, so retry the whole bootstrap before blaming the network.
      if (t === 'server-error') {
        clearTimeout(timer);
        settled = true;
        if (serverRetries < 2) {
          serverRetries++;
          onStatus('The pairing service hiccuped — retrying…');
          // Be gentle with the free shared service: wait longer between attempts.
          setTimeout(function () { cloudGuest(code, onStatus, onError, onWire); }, serverRetries === 1 ? 2500 : 5000);
        } else {
          onError('The pairing service itself reported an error (server-error), not this network. Wait half a minute, then click Connect again. Also make sure you are entering the code currently shown on the other device — an old code from before that page was refreshed will not work.');
        }
        return;
      }
      clearTimeout(timer);
      if (!open) onError('Connection problem (' + t + '). This network appears to block the pairing service.');
    });
  }

  // ---------- boot ----------
  function renderInvite(code) {
    codeDisplay.textContent = code.toUpperCase();
    var link = location.origin + location.pathname + '#c=' + code;
    try {
      var qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, scalable: true });
    } catch (e) {
      qrBox.textContent = 'QR unavailable — share the code or link instead.';
    }
    copyLinkBtn.onclick = function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(function () {
          copyLinkBtn.textContent = 'Copied ✓';
          setTimeout(function () { copyLinkBtn.textContent = 'Copy invite link'; }, 1600);
        });
      } else {
        window.prompt('Copy this link:', link);
      }
    };
  }

  function forcedCloud() {
    var forced = new URLSearchParams(location.search).get('sig');
    return forced === 'cloud' || forced === 'peerjs';
  }

  var hostKeepalive = null;

  function startHost(ignore) {
    serverRetries = 0;
    backendName = 'a direct peer-to-peer link';
    setStatus(hostStatus, 'Starting session…');
    var onCode = function (code, pending) {
      renderInvite(code);
      codeDisplay.classList.toggle('pending', !!pending);
      setStatus(hostStatus, pending
        ? 'Reaching the pairing service — the code will be ready in a moment…'
        : 'Waiting for the other device to scan or enter the code…', pending ? 'wait' : undefined);
      // Heartbeat: keeps the room on the server even if the process recycles,
      // so a code already shown / scanned never silently dies. Cloud signaling
      // has no server-side room to keep alive — skip the pointless POSTs.
      if (!forcedCloud() && !backendCloud) {
        if (hostKeepalive) clearInterval(hostKeepalive);
        hostKeepalive = setInterval(function () { announceHost(code); }, 8000);
      }
    };
    var onStatus = function (t, c) { setStatus(hostStatus, t, c); if (!chat.hidden) connStatus(t, c || 'wait'); };
    var onError = function (msg) { setStatus(hostStatus, msg, 'err'); if (!chat.hidden) connStatus(msg, 'err'); };

    if (forcedCloud()) { cloudHost(onCode, onStatus, onError); return; }

    // The create request itself is the capability test for same-origin signaling.
    postJsonRetry('/api/create', {}).then(function (r) {
      if (r && r.json && r.json.ok) {
        onCode(r.json.code);
        if (stopSignaling) { try { stopSignaling(); } catch (e) {} }
        stopSignaling = pollHost(r.json.code, onStatus, onError);
        return;
      }
      if (r && r.json && !r.json.ok) { onError('The server refused to start a session. Please refresh.'); return; }
      // No usable same-origin backend (static-only hosting) → cloud fallback.
      setStatus(hostStatus, 'No built-in signaling here — falling back to the public service…');
      cloudHost(onCode, onStatus, onError);
    });
  }

  function startGuest(code) {
    serverRetries = 0;
    backendName = 'a direct peer-to-peer link';
    guestStatus('Connecting…');
    var onStatus = guestStatus;
    var onError = function (msg) { guestStatus(msg, 'err'); };
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    wires = [];

    if (forcedCloud()) { cloudGuest(code, onStatus, onError); return; }

    var tries = 0;
    (function doJoin() {
      postJsonRetry('/api/join', { code: code }).then(function (r) {
        if (r && r.json) {
          if (r.json.ok) {
            onStatus('Waiting for the other device to respond…');
            if (stopSignaling) { try { stopSignaling(); } catch (e) {} }
            stopSignaling = pollGuest(code, onStatus, onError);
            return;
          }
          // A 404 here is often transient: the host re-announces its room every
          // few seconds, so retry briefly before telling the user it's wrong.
          if (tries++ < 4) { onStatus('Looking for that session…'); setTimeout(doJoin, 1500); return; }
          onError('No session with that code. Check the code and try again.');
          return;
        }
        setStatus(joinStatus, 'No built-in signaling here — falling back to the public service…');
        cloudGuest(code, onStatus, onError);
      });
    })();
  }

  var hashMatch = location.hash.match(/c=([a-zA-Z0-9]{6})/);

  // WebRTC support check BEFORE anything else: WeChat's built-in browser and
  // some in-app webviews ship without RTCPeerConnection. Without this the page
  // would just hang at "Joining…" with no explanation.
  if (typeof RTCPeerConnection === 'undefined') {
    var inWeChat = (navigator.userAgent || '').indexOf('MicroMessenger') !== -1;
    if (hashMatch) { home.hidden = true; chat.hidden = false; }
    connStatus(
      (inWeChat ? 'WeChat' : 'This browser') +
      ' does not support direct browser-to-browser transfer (no WebRTC). ' +
      'Open this page in Chrome, Safari or Edge instead.',
      'err'
    );
    return;
  }

  if (hashMatch) {
    joinCode.value = hashMatch[1].toUpperCase();
    home.hidden = true;
    chat.hidden = false;
    connStatus('Joining session ' + hashMatch[1].toUpperCase() + '…', 'wait');
    startGuest(hashMatch[1]);
  } else {
    startHost();
  }

  joinBtn.onclick = function () {
    var v = joinCode.value.trim().toLowerCase();
    if (v.length !== 6) { setStatus(joinStatus, 'The code has 6 characters.', 'err'); return; }
    startGuest(v);
  };
  joinCode.addEventListener('keydown', function (e) { if (e.key === 'Enter') joinBtn.onclick(); });

  sendBtn.onclick = sendText;
  leaveBtn.onclick = endSession;
  textInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendText(); });
  attachBtn.onclick = function () { fileInput.click(); };
  fileInput.addEventListener('change', function () {
    Array.prototype.forEach.call(fileInput.files, enqueueFile);
    fileInput.value = '';
  });

  // ---------- lightbox: tap a photo preview to view it full-screen ----------
  var lightbox = $('beamLightbox');
  function closeLightbox() {
    lightbox.hidden = true;
    lightbox.querySelector('img').src = '';
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.closest && t.closest('#beamApp')) {
      lightbox.querySelector('img').src = t.src;
      lightbox.hidden = false;
    } else if (t && t.id === 'beamLightbox') {
      closeLightbox();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });

  window.addEventListener('hashchange', function () { location.reload(); });
})();
