/*
 * TYB — burn.html GTD/FCFS eligibility CHECKER + shareable badge (Le 2026-09-08, redesign 2).
 * ===========================================================================
 * CONNECT-FREE (Le): the user PASTES any address into the module and checks it against a swappable, NON-
 * DEFINITIVE pre-burn allowlist snapshot (check-list.json, same-origin). On a hit the input module is
 * REPLACED by a downloadable "GTD/FCFS READY" banner (canvas -> PNG) to post on X. On a miss the input stays
 * (try another). This is NOT the on-chain root — the burn flow (burn.js) is the real GTD earner; when a burn
 * succeeds burn.js calls TYB_CHECK.showBadge(account,'GTD') and the input is likewise replaced by the badge.
 * Reuses R (XSS-safe DOM). GTD wins over FCFS. Address validated format-only; lowercased for the lookup.
 *
 * The PNG download <a href> is a data: URL, which R.el's safeUrl intentionally DROPS — so the canvas is a live
 * node and the link's .href is set programmatically (a value WE generate from the canvas, not untrusted).
 */
(function () {
  'use strict';
  var R = window.TYB_RENDER;
  if (!R) return;
  var host = document.getElementById('bn-check');
  if (!host) return;

  var RX_ADDR = /^0x[0-9a-fA-F]{40}$/;
  var listP = null, gtdSet = null, fcfsSet = null;

  function loadList() {
    if (listP) return listP;
    listP = fetch('check-list.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('list ' + r.status); return r.json(); })
      .then(function (j) {
        gtdSet = new Set((j.gtd || []).map(function (a) { return String(a).toLowerCase(); }));
        fcfsSet = new Set((j.fcfs || []).map(function (a) { return String(a).toLowerCase(); }));
        return true;
      })
      .catch(function (e) { listP = null; throw e; }); // don't cache a REJECTED load — allow retry (burn-day swap / blip)
    return listP;
  }

  function tierFor(account) {
    var a = String(account || '').toLowerCase();
    if (gtdSet && gtdSet.has(a)) return 'GTD';
    if (fcfsSet && fcfsSet.has(a)) return 'FCFS';
    return null;
  }
  function short(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : ''; }
  function msg(t, cls) { return R.el('p', { class: 'rf-msg' + (cls ? ' ' + cls : '') }, t); }

  // ---- banner: the DENPA CLUB member card (assets/credential/card.png) with dynamic fields drawn on it.
  // The card art is fixed; the circle interior is TRANSPARENT (measured), so we draw a RANDOM cropped
  // character first and the card on top → the card's own transparency masks the crop to the circle. Then
  // the 3 blank lines get: 氏名 = wallet, チェーン = Robinhood, 被害者 = a random 1..1,000,000 member no.
  // Same-origin assets → canvas stays untainted → toDataURL('image/png') works under the page CSP.
  var CARD_W = 1586, CARD_H = 992, CROP_COUNT = 12;
  var HOLE = { cx: 1171, cy: 559, d: 600 };          // transparent circle (measured from card.png)
  var LINE = { name: 656, chain: 746, member: 838 }; // underline y of each field
  var LINE_X = 300;                                   // where the dynamic text starts (just past the label)
  var STAMP = { cx: 1360, cy: 820, w: 540 };          // stamp overlay, drawn CENTERED here — bottom-right of the circle, slightly overlapping it
  // three READY variants: the checker's GTD/FCFS list hits + the OG variant earned by BURNING Frog Heads for GTD.
  var VARIANTS = {
    GTD:    { label: 'GTD READY',    stamp: 'stamp-gtd.png',    file: 'tyb-gtd-card.png' },
    FCFS:   { label: 'FCFS READY',   stamp: 'stamp-fcfs.png',   file: 'tyb-fcfs-card.png' },
    GTD_OG: { label: 'GTD READY OG', stamp: 'stamp-gtd-og.png', file: 'tyb-gtd-og-card.png' }
  };
  function variantOf(k) { return VARIANTS[k] || VARIANTS.GTD; }
  var _cardP = null;
  function loadImg(src) {
    return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('img ' + src)); }; im.src = src; });
  }
  function loadCard() { if (!_cardP) _cardP = loadImg('assets/credential/card.png'); return _cardP; }
  function fontsReady() { try { return (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve(); } catch (_) { return Promise.resolve(); } }

  // async: composite the member card into `canvas` for `account` (+ the variant's READY stamp). Resolves with the canvas.
  function composeBanner(account, canvas, tier) {
    var n = (Math.random() * CROP_COUNT | 0) + 1;                 // random crop 1..12 (per render, Le)
    var member = Math.floor(Math.random() * 1000000) + 1;          // random member no. 1..1,000,000 (per render, Le)
    // the variant's stamp (GTD / FCFS from the checker, GTD-OG from a burn); a missing file resolves null → skipped cleanly
    var stampP = loadImg('assets/credential/' + variantOf(tier).stamp).catch(function () { return null; });
    return Promise.all([loadCard(), loadImg('assets/credential/' + n + '.png'), stampP, fontsReady()]).then(function (r) {
      var card = r[0], crop = r[1], stamp = r[2];
      canvas.width = CARD_W; canvas.height = CARD_H;
      var x = canvas.getContext('2d');
      x.clearRect(0, 0, CARD_W, CARD_H);
      x.drawImage(crop, HOLE.cx - HOLE.d / 2, HOLE.cy - HOLE.d / 2, HOLE.d, HOLE.d); // crop first…
      x.drawImage(card, 0, 0, CARD_W, CARD_H);                                       // …card on top (transparent hole = mask)
      x.fillStyle = '#020201'; x.textBaseline = 'alphabetic'; x.textAlign = 'left'; // match the card's printed ink (measured ~#000000), not a soft grey
      x.font = '800 52px "Plus Jakarta Sans", system-ui, sans-serif';
      x.fillText(short(account), LINE_X, LINE.name - 16);
      x.fillText('Robinhood', LINE_X, LINE.chain - 16);
      x.fillText(String(member), LINE_X, LINE.member - 16);
      if (stamp && stamp.naturalWidth) {                          // draw the variant's READY stamp if its asset exists
        var sw = STAMP.w, sh = sw * (stamp.naturalHeight / stamp.naturalWidth);
        x.drawImage(stamp, STAMP.cx - sw / 2, STAMP.cy - sh / 2, sw, sh);
      }
      return canvas;
    });
  }

  // compat: kept on the exposed API (returns the canvas immediately; content fills in async).
  function drawBanner(tier, account) {
    var c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H;
    composeBanner(account, c, tier);
    return c;
  }

  // ---- the HIT view: the input module is REPLACED by the badge (used by paste-hit AND burn-success) ----
  function renderBadge(tier, account) {
    var v = variantOf(tier);
    var canvas = document.createElement('canvas');
    canvas.width = CARD_W; canvas.height = CARD_H; canvas.className = 'chk-banner';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', v.label + ' member card for ' + short(account));
    var fileName = v.file;
    var dl = R.el('a', { class: 'rf-btn' }, 'Preparing card…');
    R.mount(host, R.el('div', { class: 'chk-hit' }, [
      msg("You're " + v.label + '.', 'chk-ok'),
      canvas,
      R.el('div', { class: 'chk-actions' }, [dl]),
      msg('Snapshot only — the final allowlist is locked at mint.', 'chk-fine')
    ]));
    composeBanner(account, canvas, tier).then(function () {
      dl.setAttribute('download', fileName);
      try { dl.href = canvas.toDataURL('image/png'); dl.textContent = 'Download card (PNG)'; }
      catch (_) { dl.textContent = 'Download unavailable'; }
    }).catch(function () { dl.textContent = 'Card unavailable'; });
  }

  // ---- the INPUT view (connect-free): paste an address + Check ----
  function renderInput(prefill, errText) {
    var input = R.el('input', { class: 'chk-input', type: 'text', spellcheck: 'false', autocapitalize: 'off',
      autocomplete: 'off', placeholder: 'Paste a wallet address (0x...)', 'aria-label': 'Wallet address to check' });
    if (prefill) input.value = prefill;
    var btn = R.el('button', { type: 'button', class: 'rf-btn' }, 'Check');
    var err = errText ? R.el('p', { class: 'rf-msg chk-err', role: 'alert' }, errText) : null; // role=alert → announced to SRs on retry
    function submit() {
      var v = String(input.value || '').trim();
      if (!RX_ADDR.test(v)) { renderInput(v, 'Enter a valid wallet address (0x + 40 hex characters).'); return; }
      btn.disabled = true; btn.textContent = 'Checking...';
      loadList().then(function () {
        var t = tierFor(v);
        if (t) { renderBadge(t, v.toLowerCase()); }
        else { renderInput(v, 'This address is not on the pre-burn allowlist snapshot. Burn a Frog Head above to earn a guaranteed (GTD) spot.'); }
      }).catch(function () { renderInput(v, 'Could not load the allowlist snapshot. Please try again in a moment.'); });
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    R.mount(host, R.el('div', { class: 'chk-form' }, [
      msg('Paste any wallet address to check if it is already on the GTD or FCFS list — no connection needed.'),
      R.el('div', { class: 'chk-row' }, [input, btn]),
      err
    ]));
    if (errText) { try { input.focus(); } catch (_) {} } // restore focus on a retry (keyboard/SR a11y)
  }

  // Testable / cross-module seam (same convention as TYB_RENDER / TYB_SESSION). showBadge lets burn.js drop the
  // input and show the badge on a successful burn; the pure lookup + banner factory are exposed for tests.
  window.TYB_CHECK = Object.freeze({
    tierFor: tierFor, drawBanner: drawBanner, _loadList: loadList,
    showBadge: function (account, tier) { renderBadge(VARIANTS[tier] ? tier : 'GTD', String(account || '').toLowerCase()); }
  });

  renderInput('', '');
})();
