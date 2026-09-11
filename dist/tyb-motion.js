/*
 * TYB — navigate-out overlay + page-transition motion (launch polish 2026-09-09).
 * ============================================================================
 * The ONLY JS piece of the motion layer (parts 1-5 are pure CSS). CSP is `script-src 'self'` → this MUST be an
 * external file (no inline). Loaded on every page AFTER tyb-session.js. Fades a full-screen overlay in, then
 * navigates. Exposes window.TYB_TRANSITION.go(href) so the app-bar router (tyb-session.js) routes its NAV[a]
 * navigations (e.g. gtd->burn) through the same fade; a plain internal <a> click is intercepted here directly.
 *
 * Safety (triple-GO folded):
 *  - reduced-motion read LIVE (matchMedia.matches), not a boot snapshot → a mid-session RM flip is honored.
 *  - fire-once `done` latch + hard setTimeout(700) fallback → a missing transitionend never hangs a nav.
 *  - SELF-HEAL setTimeout(2500) after navigating → if the navigation aborts (Esc) or stalls and the document
 *    stays alive, the overlay clears itself instead of becoming a permanent full-screen click-shield.
 *  - `pageshow` clears the overlay + busy (bfcache back-restore of a faded-out page).
 *  - strict link filter: same-origin http(s), not target!=_self / download / hash-only / modified/middle-click.
 *  - NO-BLANK: the overlay defaults opacity:0 + pointer-events:none and is appended lazily; if this file never
 *    loads, links are plain <a> that navigate normally and the router uses its own location.href fallback.
 *  - revert: delete this file + its <script> tags; restore the one router line in tyb-session.js.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var mq = null;
  try { mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (_) {}
  function reduced() { return !!(mq && mq.matches); }

  var overlay = null, busy = false;
  function ensure() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'tyb-navout';
    overlay.setAttribute('aria-hidden', 'true');
    // mount INSIDE the phone frame so the cutting-mat wipe stays within it (position:absolute), not the whole
    // desktop viewport; fall back to body if the frame isn't found (still works, just viewport-sized).
    var host = (document.querySelector && document.querySelector('.mobile-frame')) || document.body || document.documentElement;
    host.appendChild(overlay);
    return overlay;
  }

  function go(href) {
    if (!href) return;
    if (reduced() || busy) { window.location.href = href; return; } // RM/in-flight → immediate, no fade
    busy = true;
    var ov = ensure(), done = false;
    function fire() {
      if (done) return; done = true;
      window.location.href = href;
      // self-heal: aborted (Esc) or stalled nav leaves this doc alive → clear the shield instead of hanging it
      setTimeout(function () { if (overlay) overlay.classList.remove('is-on'); busy = false; }, 2500);
    }
    // double-rAF: commit the pre-`is-on` (opacity 0) frame before transitioning to opacity 1
    requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add('is-on'); }); });
    ov.addEventListener('transitionend', function h(e) {
      if (e.target === ov && e.propertyName === 'opacity') { ov.removeEventListener('transitionend', h); fire(); }
    });
    setTimeout(fire, 700); // hard fallback if transitionend never fires
  }

  window.TYB_TRANSITION = { go: go };

  document.addEventListener('click', function (e) {
    if (reduced()) return;                                          // live reduced-motion → native nav, no overlay
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = (e.target && e.target.closest) ? e.target.closest('a[href]') : null;
    if (!a || (e.target.closest && e.target.closest('[data-action]'))) return; // gated/router buttons are <button>
    if (a.target && a.target !== '_self') return;                  // _blank: X badge, socials, etherscan
    if (a.hasAttribute('download')) return;
    var u;
    try { u = new URL(a.getAttribute('href'), window.location.href); } catch (_) { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return; // mailto/tel/javascript
    if (u.origin !== window.location.origin) return;               // external
    if (u.pathname === window.location.pathname && u.search === window.location.search) return; // same doc / hash
    e.preventDefault();
    go(u.href);
  });

  window.addEventListener('pageshow', function () {
    busy = false;
    if (overlay) overlay.classList.remove('is-on');
  });
})();
