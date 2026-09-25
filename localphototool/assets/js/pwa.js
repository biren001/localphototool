/* ==========================================================================
   LocalPhotoTool — PWA glue
   1. registers the service worker (offline support)
   2. offers an install entry: the native prompt where the browser allows it,
      step-by-step instructions on iOS, where it does not
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------- service worker ------ */

  /* Registered next to the manifest, so the worker also works when the site
     is served from a sub-folder (local previews, staging). */
  function swUrl() {
    var link = document.querySelector('link[rel="manifest"]');
    try {
      if (link && link.href) return new URL('sw.js', link.href).href;
      return new URL('sw.js', window.location.href).href;
    } catch (e) {
      return '/sw.js';
    }
  }

  /* `updateViaCache: 'none'` is load-bearing, not decoration.

     The zone's Browser Cache TTL is a floor: it rewrote our `no-cache` on
     /sw.js into `max-age=14400, must-revalidate`, and a browser holding that
     treats the copy it already has as fresh for four hours — so a deploy does
     not reach a returning visitor until the afternoon. That is a real defect
     for a site that ships fixes, and only the CDN dashboard can change the
     header. This option makes the browser skip its HTTP cache for the worker
     script entirely, which takes the decision back out of the CDN's hands.

     The cost is one small request per navigation, which is a fair trade for a
     visitor getting the version that is actually live. */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(swUrl(), { updateViaCache: 'none' }).then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) {
          reg.waiting.postMessage('skip-waiting');
        }
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('skip-waiting');
            }
          });
        });
      }).catch(function () { /* offline support is a bonus, never a blocker */ });
    });
  }

  /* ------------------------------------------------- install UI ---------- */

  function standalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (e) { /* ignore */ }
    return window.navigator.standalone === true;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  var deferred = null;
  var button = null;

  function makeButton() {
    if (button) return button;
    var node = document.createElement('button');
    node.type = 'button';
    node.className = 'icon-btn nav__install';
    node.id = 'installApp';
    node.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/>' +
      '<path d="M12 7.2v6.2"/><path d="m9.6 11 2.4 2.4 2.4-2.4"/><path d="M10.6 18.6h2.8"/></svg>' +
      '<span class="nav__install-text">Install app</span>';
    node.setAttribute('aria-label', 'Install LocalPhotoTool as an app');
    node.addEventListener('click', onClick);
    var actions = document.querySelector('.nav__actions');
    if (actions) {
      var anchor = document.getElementById('themeToggle');
      actions.insertBefore(node, anchor || actions.firstChild);
    } else {
      document.body.appendChild(node);
    }
    return node;
  }

  function showButton() {
    if (standalone()) return;
    makeButton().hidden = false;
  }

  function hideButton() {
    if (button) button.hidden = true;
  }

  function onClick() {
    if (deferred) {
      var prompt = deferred;
      deferred = null;
      hideButton();
      prompt.prompt();
      if (prompt.userChoice && prompt.userChoice.then) {
        prompt.userChoice.then(function (choice) {
          if (!choice || choice.outcome !== 'accepted') deferred = null;
        });
      }
      return;
    }
    showGuide();
  }

  /* iOS has no install API — show the three taps it takes instead. */
  function buildGuide() {
    if (document.getElementById('installGuide')) return;
    var wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.id = 'installGuide';
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'installGuideTitle');
    wrap.innerHTML =
      '<div class="modal__panel modal__panel--narrow">' +
        '<div class="modal__head">' +
          '<h2 class="modal__title" id="installGuideTitle">Add to your home screen</h2>' +
          '<button class="icon-btn" type="button" data-close aria-label="Close">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="save-guide">' +
          '<ol class="save-guide__steps">' +
            '<li>Tap the <strong>Share</strong> button in Safari — the square with an arrow pointing up.</li>' +
            '<li>Scroll the list and tap <strong>Add to Home Screen</strong>.</li>' +
            '<li>Tap <strong>Add</strong>. The tool then opens full screen and keeps working offline.</li>' +
          '</ol>' +
          '<p class="save-guide__note">On Android, open the browser menu and choose <strong>Install app</strong> — or use the button that appears here on Chrome.</p>' +
        '</div>' +
        '<div class="modal__foot">' +
          '<button class="btn btn--primary btn--sm" type="button" data-close>Got it</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (ev) {
      if (ev.target === wrap || ev.target.closest('[data-close]')) closeGuide();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !wrap.hidden) closeGuide();
    });
  }

  function openModal(node) {
    node.hidden = false;
    document.body.classList.add('no-scroll');
    var focusable = node.querySelector('button');
    if (focusable) focusable.focus();
  }

  function closeModal(node) {
    node.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  function showGuide() {
    buildGuide();
    openModal(document.getElementById('installGuide'));
  }

  function closeGuide() {
    var node = document.getElementById('installGuide');
    if (node) closeModal(node);
  }

  function boot() {
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      deferred = ev;
      showButton();
    });
    window.addEventListener('appinstalled', function () {
      deferred = null;
      hideButton();
    });

    if (standalone()) return;
    if (isIOS()) showButton();
    /* On other browsers the button only appears once the browser itself says
       the app is installable, so no dead button on unsupported platforms. */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
