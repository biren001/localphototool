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

(function () {
  // ---------- helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  var CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  var CHUNK = 16 * 1024;

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

  // ICE servers: Google STUN first (most of this site's audience is outside
  // CN); the CN-reachable ones stay as fallbacks for visitors behind the
  // GFW. STUN only helps establish the direct link — it relays nothing.
  var ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.miwifi.com:3478' },
      { urls: 'stun:stun.chat.bilibili.com:3478' },
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
    textInput.focus();
  }
  function markDisconnected() {
    connState.className = 'dot bad';
    connText.textContent = 'Disconnected — nothing was kept. Refresh to start a new session.';
  }
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
    ch.onmessage = function (e) { handlers.data(e.data); };
    if (ch.readyState === 'open') { wire.open = true; setTimeout(handlers.open, 0); }
    return wire;
  }
  function makePeerWire(conn, handlers) {
    var wire = {
      kind: 'peerjs',
      open: false,
      send: function (d) { if (conn.open) conn.send(d); },
      buffered: function () { return conn.dataChannel ? conn.dataChannel.bufferedAmount : 0; },
      close: function () { try { conn.close(); } catch (e) {} },
    };
    conn.on('open', function () { wire.open = true; handlers.open(); });
    conn.on('data', function (d) { handlers.data(d); });
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
  function onWireData(d) {
    if (typeof d === 'string') {
      var msg;
      try { msg = JSON.parse(d); } catch (e) { return; }
      handleMessage(msg);
    } else if (d instanceof ArrayBuffer) {
      pushChunk(d);
    } else if (typeof Blob !== 'undefined' && d instanceof Blob) {
      d.arrayBuffer().then(pushChunk);
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
        wrap._bar = function (p) {
          fill.style.width = Math.round(p * 100) + '%';
          if (p >= 1) size.textContent = fmtBytes(msg.size) + ' · received ✓';
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
      if (isImg) {
        var img = document.createElement('img');
        img.src = url; img.alt = st.meta.name;
        bubble.appendChild(img);
      }
      var link = document.createElement('a');
      link.href = url; link.download = st.meta.name;
      link.textContent = isImg ? 'Download original' : 'Save file';
      bubble.appendChild(link);
      st.msg._bar(1);
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
  function sendFile(file) {
    var wire = wires.filter(function (w) { return w.open; })[0];
    if (!wire) { notConnectedFeedback(); return; }
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
      if (!wire.open) { sizeEl.textContent = fmtBytes(file.size) + ' · failed'; return; }
      if (offset >= file.size) {
        wire.send(JSON.stringify({ t: 'file-end', id: id }));
        sizeEl.textContent = fmtBytes(file.size) + ' · sent ✓';
        return;
      }
      if (wire.buffered() > 4 * CHUNK) { setTimeout(pump, 40); return; }
      var end = Math.min(offset + CHUNK, file.size);
      file.slice(offset, end).arrayBuffer().then(function (ab) {
        wire.send(ab);
        offset = end;
        fill.style.width = Math.round((offset / file.size) * 100) + '%';
        pump();
      }).catch(function () { sizeEl.textContent = fmtBytes(file.size) + ' · failed'; });
    })();
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
  function cloudHost(onCode, onStatus, onError, onWire) {
    var code = randCode(6);
    peer = new Peer('beam-' + code, { config: ICE });
    peer.on('open', function () { onCode(code); });
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
      if (t === 'unavailable-id') { if (peer) peer.destroy(); cloudHost(onCode, onStatus, onError, onWire); return; }
      onError('Could not reach the public signaling service (' + t + '). This network appears to block it — switching to a different network, for example a mobile hotspot, usually fixes it.');
    });
  }
  function cloudGuest(code, onStatus, onError, onWire) {
    peer = new Peer({ config: ICE });
    function attempt(n) {
      var conn = peer.connect('beam-' + code, { reliable: true });
      var wire = makePeerWire(conn, {
        open: function () { registerWire(wire); onStatus('Connected', 'ok'); },
        close: function () { wires = wires.filter(function (w) { return w !== wire; }); if (!wires.some(function (w) { return w.open; })) markDisconnected(); },
        data: onWireData,
      });
      if (onWire) onWire(wire);
      conn.on('error', function () {
        if (n < 2) setTimeout(function () { attempt(n + 1); }, 900);
        else onError('Could not reach that session. Check the code and try again.');
      });
    }
    peer.on('open', function () { onStatus('Connecting…'); attempt(0); });
    peer.on('error', function (err) {
      onError('Connection problem (' + ((err && err.type) || 'unknown') + '). This network appears to block the public signaling service.');
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
    backendName = 'a direct peer-to-peer link';
    setStatus(hostStatus, 'Starting session…');
    var onCode = function (code) {
      renderInvite(code);
      setStatus(hostStatus, 'Waiting for the other device to scan or enter the code…');
      // Heartbeat: keeps the room on the server even if the process recycles,
      // so a code already shown / scanned never silently dies.
      if (!forcedCloud()) {
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
    Array.prototype.forEach.call(fileInput.files, sendFile);
    fileInput.value = '';
  });

  window.addEventListener('hashchange', function () { location.reload(); });
})();
