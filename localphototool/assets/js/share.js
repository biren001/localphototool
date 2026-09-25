/* Sharing helpers for /share/. Every button here is optional: anything the
   browser cannot do simply stays hidden rather than turning into a dead click. */

(function () {
  'use strict';

  var SITE = 'https://localphototool.com/';
  var note = document.getElementById('shareStatus');
  var timer = null;

  function say(msg) {
    if (!note) return;
    note.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(function () { note.textContent = ''; }, 2600);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    /* Older Safari and anything served without a secure context. */
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy-unsupported'));
    });
  }

  /* ------------------------------------------------------- link --------- */

  var copyLink = document.getElementById('copyLink');
  if (copyLink) {
    copyLink.addEventListener('click', function () {
      copyText(SITE).then(
        function () { say('Link copied — paste it anywhere.'); },
        function () { say('Could not copy automatically. The address is ' + SITE); }
      );
    });
  }

  var shareBtn = document.getElementById('shareLink');
  if (shareBtn && navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', function () {
      navigator.share({ title: 'LocalPhotoTool', text: 'Compress images without uploading them', url: SITE })
        .catch(function () { /* cancelled — nothing to report */ });
    });
  }

  /* ------------------------------------------------------ posters ------- */

  Array.prototype.forEach.call(document.querySelectorAll('[data-share-poster]'), function (btn) {
    if (!navigator.canShare || !navigator.share) return;

    var src = btn.getAttribute('data-share-poster');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      fetch(src)
        .then(function (r) { return r.blob(); })
        .then(function (blob) {
          var file = new File([blob], src, { type: 'image/png' });
          if (!navigator.canShare({ files: [file] })) throw new Error('no-file-share');
          return navigator.share({
            files: [file],
            title: 'LocalPhotoTool',
            text: 'Compress images without uploading them'
          });
        })
        .catch(function () { say('Sharing is not available here — use “Save image” instead.'); })
        .then(function () { btn.disabled = false; });
    });
  });

  /* A File built from a fetch is only shareable on browsers that accept files
     at all, so the button is revealed after a cheap capability probe. */
  if (navigator.canShare && navigator.share) {
    try {
      if (navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] })) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-share-poster]'), function (b) {
          b.hidden = false;
        });
      }
    } catch (e) { /* leave them hidden */ }
  }

  /* ------------------------------- copy button used on other pages ------ */

  /* Any page can drop in <button data-copy-link data-status-for="id">. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy-link]'), function (btn) {
    var out = document.getElementById(btn.getAttribute('data-status-for') || '');
    var reset = null;
    btn.addEventListener('click', function () {
      copyText(SITE).then(function () {
        if (out) out.textContent = 'Link copied — paste it anywhere.';
      }, function () {
        if (out) out.textContent = 'The address is ' + SITE;
      });
      if (out) {
        clearTimeout(reset);
        reset = setTimeout(function () { out.textContent = ''; }, 2600);
      }
    });
  });

  /* -------------------------------------------------- prepared copy ----- */

  Array.prototype.forEach.call(document.querySelectorAll('[data-copy-btn]'), function (btn) {
    btn.addEventListener('click', function () {
      var box = btn.closest('.copy-item');
      var p = box && box.querySelector('[data-copy]');
      if (!p) return;
      copyText(p.textContent.trim()).then(
        function () { say('Post text copied.'); },
        function () { say('Copy failed — select the text and copy it manually.'); }
      );
    });
  });
})();
