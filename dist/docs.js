/*
 * TYB — docs.html page controller (the drop's info page; launch redesign 2026-09-09).
 * ===========================================================================
 * TWO views over ONE set of facts + a category panel. The numbers ALWAYS come from onchain-config.js via
 * docFacts() (byte-verified contract constants) so DEGEN and DETAIL can never show different facts and a
 * displayed number can't drift from the audited value (price was 0.003->0.002 once). Everything dynamic is
 * built through the XSS-safe R.el/R.txt builder (tyb-render.js) — never innerHTML.
 *   - DETAIL = the full static prose in docs.html (7 <section data-cat> blocks), numbers via [data-cfg].
 *   - DEGEN  = quick cards built here from CAT_DEGEN(facts), one per category.
 *   - PANEL  = category chips (mobile, sticky top) / left rail (desktop) with scroll-spy; a click jumps to
 *              the category in the CURRENT view. Mode persists in localStorage (validated, default degen).
 *   - VERSION stamp from CFG.launch.docsVersion — a hand-bumped version string (e.g. v1.0), never a date.
 * Pure surface (docFacts / CATEGORIES / CAT_DEGEN) is exposed on window.TYB_DOCS for a node test; the DOM
 * build runs only in a browser (typeof document guard) so the test loads docs.js with no document.
 */
(function () {
  'use strict';
  var win = (typeof window !== 'undefined') ? window : null;

  // PURE: derive the display strings from config (node-testable; no DOM). UNCHANGED across the redesign.
  function docFacts(CFG) {
    if (!CFG) return {};
    var col = CFG.collection || {}, ga = CFG.gacha || {}, ev = CFG.evolution || {}, rh = (CFG.chains && CFG.chains.robinhood) || {};
    var mp = (CFG.launch && CFG.launch.mintPlan) || {}, mpPhases = mp.phases || [];
    var supply = Number(col.maxSupply);
    function pct(bps) { return (Number(bps) / 100) + '%'; }
    return {
      supply: isFinite(supply) ? supply.toLocaleString('en-US') : String(col.maxSupply),
      price: col.price + ' ETH',
      maxPerWallet: String(col.maxPerWallet),
      maxPerWalletTx: 'up to ' + col.maxPerWallet,
      idRange: col.firstTokenId + ' – ' + (isFinite(supply) ? supply.toLocaleString('en-US') : String(col.maxSupply)), // en-dash; comma-grouped like `supply`
      refundPct: pct(col.refundBps),
      refundPerToken: col.refundPerToken + ' ETH',
      refundDays: String(Number(col.refundWindowSecs) / 86400),
      royaltyPct: pct(col.royaltyBps),
      // NO literal fallbacks: a missing config field must surface as '' / 'undefined' (caught by the
      // test's length>0 + !NaN|undefined asserts, and no-filled by the DOM's != null guard → the HTML's
      // own static text remains), NEVER a plausible-but-frozen number that would silently outlive a
      // config reshape (the whole reason this file derives from config — GO fold: single-arm P2).
      chainName: String(rh.name || '').replace(/\s*Chain$/, ''),
      chainId: String(rh.chainId),
      ticketUsd: '$' + ga.ticketUsd,
      maxTicketsPerTx: String(ga.maxTicketsPerTx),
      evoCategories: String(ev.categories),
      evoOdds1: ev.odds && ev.odds.toLevel1,
      evoOdds2: ev.odds && ev.odds.toLevel2,
      evoMaxTier: String(Number(ev.maxLevel) + 1),
      // ANNOUNCED mint plan (docs only; NOT the on-chain cap — the contract still caps at maxPerWallet over
      // GTD/FCFS/Public). frenzyExtra = the raised cap MINUS the GTD/FCFS cap ("4 more"); NaN if either is
      // missing (caught by the clean-string assert), never a frozen literal.
      mintPhases: mpPhases.join(' · '),                 // 'GTD · FCFS · Frenzy · Public'
      mintPhaseCount: String(mpPhases.length),          // '4'
      frenzyCap: String(mp.walletCapMax),               // '6' — per-wallet total once Frenzy opens
      frenzyExtra: String(Number(mp.walletCapMax) - Number(col.maxPerWallet)) // '4' — how many more Frenzy adds
    };
  }

  // Category taxonomy — id matches the docs.html detail <section data-cat> + the degen card id; `kick` is the
  // kicker-dot colour class. ONE source for the panel, the degen cards and the (static) detail kickers.
  // `noChip` = a category that renders as a Degen card + Detail section but gets NO panel chip (overview = the
  // intro, redundant as a jump target). `noCard` = a chip + Detail section with NO Degen card (faq is
  // detail-only; buildDegen also self-skips it since CAT_DEGEN has no faq entry).
  var CATEGORIES = [
    { id: 'overview',   label: 'Overview',           kick: 'dk-red',    noChip: true },
    { id: 'collection', label: 'Collection & price', kick: 'dk-blue' },
    { id: 'ways-in',    label: 'Ways in',            kick: 'dk-teal' },
    { id: 'gacha',      label: 'Gacha',              kick: 'dk-red' },
    { id: 'evolution',  label: 'Evolution',          kick: 'dk-teal',   tba: true },
    { id: 'refund',     label: 'Refund & royalties', kick: 'dk-blue' },
    { id: 'onchain',    label: 'On-chain',           kick: 'dk-yellow' },
    { id: 'schedule',   label: 'Schedule',           kick: 'dk-blue',   noCard: true },
    { id: 'faq',        label: 'FAQ',                kick: 'dk-red',    noCard: true }
  ];

  // DEGEN card copy per category, derived from docFacts (numbers never drift from detail/config).
  function CAT_DEGEN(f) {
    f = f || {};
    return {
      overview:   { stat: f.supply,     sub: 'pieces on ' + f.chainName,                          line: 'Mint, gacha, evolution & refund — one drop.' },
      collection: { stat: f.price,      sub: 'mint · ' + f.maxPerWallet + ' per wallet, up to ' + f.frenzyCap + ' in Frenzy', line: 'ERC-721 · IPFS art, revealed after the refund window.' },
      'ways-in':  { stat: f.mintPhaseCount, sub: 'ways in: ' + f.mintPhases,                        line: 'Burn a Frog Heads for a guaranteed spot; up to ' + f.frenzyCap + ' per wallet in total.' },
      gacha:      { stat: f.ticketUsd,  sub: 'per ticket',                                         line: 'Hit a winning number and take the prize. Every ticket also pays straight to the holder (not the dev) of the number it draws — plus a power-up for later. Hold to earn.' },
      evolution:  { stat: f.evoOdds1,   sub: 'Tier 1 → 2 · ' + f.evoOdds2 + ' to Tier ' + f.evoMaxTier, line: 'Burn a power-up to evolve a trait, across ' + f.evoCategories + ' categories.' },
      refund:     { stat: f.refundPct,  sub: 'back · blind refund',                                line: 'Original minter only, before the reveal. ' + f.royaltyPct + ' royalty.' },
      onchain:    { stat: f.chainName,  sub: 'Chain ID ' + f.chainId + ' · L2 Orbit',              line: 'Everything verifiable on-chain. Addresses posted at launch.' }
    };
  }

  var API = { docFacts: docFacts, CATEGORIES: CATEGORIES, CAT_DEGEN: CAT_DEGEN };

  // ── DOM build (browser only) ─────────────────────────────────────────────
  if (win && win.TYB_ONCHAIN && typeof document !== 'undefined') {
    var R = win.TYB_RENDER;
    var CFG = win.TYB_ONCHAIN;
    var MODE_KEY = 'tyb:docs-mode';
    var facts = docFacts(CFG);

    var mode = 'degen';
    try { var stored = localStorage.getItem(MODE_KEY); if (stored === 'degen' || stored === 'detail') mode = stored; } catch (_) {}
    function persist() { try { localStorage.setItem(MODE_KEY, mode); } catch (_) {} }

    // fill every [data-cfg] in the static detail prose (textContent; XSS-safe; source = frozen config)
    function fillCfg() {
      var nodes = document.querySelectorAll('[data-cfg]');
      for (var i = 0; i < nodes.length; i++) {
        var k = nodes[i].getAttribute('data-cfg');
        if (k && Object.prototype.hasOwnProperty.call(facts, k) && facts[k] != null) nodes[i].textContent = facts[k];
      }
    }

    function buildDegen() {
      var host = document.getElementById('deg-group'); if (!host) return;
      var copy = CAT_DEGEN(facts);
      var cards = CATEGORIES.map(function (c) {
        var d = copy[c.id]; if (!d) return null;
        var kick = R.el('span', { class: 'deg-card__kick' }, [R.el('i', { class: c.kick }), R.txt(' ' + c.label)]);
        var inner = [
          R.el('div', { class: 'deg-card__stat' }, [R.txt(d.stat), R.el('span', { class: 'deg-card__sub' }, d.sub)]),
          R.el('p', { class: 'deg-card__line' }, d.line)
        ];
        // c.tba → the info is a blurred teaser under a centered "To be announced" pill (evolution: mechanic deferred)
        var body = c.tba
          ? [R.el('div', { class: 'doc-tba' }, [
              R.el('div', { class: 'doc-tba__blur', 'aria-hidden': 'true' }, inner),
              R.el('span', { class: 'doc-tba__badge' }, R.el('b', { class: 'doc-tba__pill' }, 'To be announced'))
            ])]
          : inner;
        return R.el('article', { class: 'deg-card' + (c.tba ? ' deg-card--tba' : ''), id: 'deg-' + c.id, dataset: { cat: c.id } }, [kick].concat(body));
      }).filter(Boolean);
      R.mount(host, cards);
    }

    function reducedMotion() { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }

    // edge-fade mask: fade a side ONLY when there's more panel to scroll that way (hints "more pills →").
    function updatePanelFade() {
      var p = document.getElementById('doc-panel');
      if (!p || !p.style || typeof p.style.setProperty !== 'function') return; // stub-safe (node test)
      var max = (p.scrollWidth || 0) - (p.clientWidth || 0);
      p.style.setProperty('--fade-l', p.scrollLeft > 2 ? '8cqw' : '0px');
      p.style.setProperty('--fade-r', (max - p.scrollLeft) > 2 ? '8cqw' : '0px');
    }
    var _fadeRaf = 0;
    function onPanelScroll() {
      if (typeof requestAnimationFrame !== 'function') { updatePanelFade(); return; }
      if (_fadeRaf) return;
      _fadeRaf = requestAnimationFrame(function () { _fadeRaf = 0; updatePanelFade(); });
    }
    // horizontally center the active chip in the panel (auto-follows the section you're reading).
    function centerChip(panel, chip) {
      if (!panel || !chip || !chip.getBoundingClientRect || !panel.clientWidth) return; // stub-safe
      var cr = chip.getBoundingClientRect(), pr = panel.getBoundingClientRect();
      var target = panel.scrollLeft + (cr.left - pr.left) - (panel.clientWidth - cr.width) / 2;
      if (panel.scrollTo) panel.scrollTo({ left: target, behavior: reducedMotion() ? 'auto' : 'smooth' });
      else panel.scrollLeft = target;
    }

    // mouse drag-to-scroll the chip panel (touch already pans natively). A real drag suppresses the chip click.
    function enablePanelDrag(panel) {
      if (!panel || !panel.addEventListener) return;
      var down = false, startX = 0, startScroll = 0, moved = false, pid = null;
      panel.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.button !== 0) return; // only left mouse; touch uses native scrolling
        down = true; moved = false; startX = e.clientX; startScroll = panel.scrollLeft; pid = e.pointerId;
        panel.classList.add('is-dragging');
        if (panel.setPointerCapture) { try { panel.setPointerCapture(e.pointerId); } catch (_) {} }
      });
      panel.addEventListener('pointermove', function (e) {
        if (!down) return;
        var dx = e.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        panel.scrollLeft = startScroll - dx;
      });
      function end() {
        if (!down) return;
        down = false; panel.classList.remove('is-dragging');
        if (pid != null && panel.releasePointerCapture) { try { panel.releasePointerCapture(pid); } catch (_) {} }
        pid = null;
      }
      panel.addEventListener('pointerup', end);
      panel.addEventListener('pointercancel', end);
      // capture-phase: a drag never lands as a chip click (navigation)
      panel.addEventListener('click', function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    }

    var _lastCat = null;
    function setActiveChip(cat) {
      var host = document.getElementById('doc-panel'); if (!host) return;
      var activeBtn = null;
      Array.prototype.forEach.call(host.querySelectorAll('.doc-chip'), function (b) {
        var on = b.dataset.cat === cat;
        b.classList.toggle('is-active', on);
        if (on) { b.setAttribute('aria-current', 'true'); activeBtn = b; } else b.removeAttribute('aria-current');
      });
      if (activeBtn && cat !== _lastCat) centerChip(host, activeBtn); // scroll the panel to the new active chip
      _lastCat = cat;
    }

    function activeAnchor(cat) { return document.getElementById((mode === 'degen' ? 'deg-' : 'det-') + cat); }
    function pick(cat) {
      var t = activeAnchor(cat);
      if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveChip(cat);
    }

    function buildPanel() {
      var host = document.getElementById('doc-panel'); if (!host) return;
      var chips = CATEGORIES.filter(function (c) { return !c.noChip; }).map(function (c) {
        var b = R.el('button', { type: 'button', class: 'doc-chip', dataset: { cat: c.id }, 'aria-label': 'Go to ' + c.label },
          [R.el('i', { class: 'doc-chip__dot ' + c.kick }), R.txt(c.label)]);
        b.addEventListener('click', function () { pick(c.id); });
        return b;
      });
      R.mount(host, chips);
      if (host.addEventListener) host.addEventListener('scroll', onPanelScroll);
      enablePanelDrag(host);
      updatePanelFade();
    }

    function buildSwitch() {
      var host = document.getElementById('doc-switch'); if (!host) return;
      var defs = [{ m: 'degen', label: 'Degen' }, { m: 'detail', label: 'Detail' }];
      var thumb = R.el('span', { class: 'doc-switch__thumb', 'aria-hidden': 'true' }); // the sliding black bar
      var btns = defs.map(function (d) {
        var b = R.el('button', { type: 'button', class: 'doc-switch__btn', role: 'tab', dataset: { mode: d.m } }, d.label);
        b.addEventListener('click', function () { if (mode === d.m) return; mode = d.m; persist(); applyMode(); });
        return b;
      });
      R.mount(host, [thumb].concat(btns));
    }

    // Socials — ONE source (Le 2026-09-09: Denpa Club / ubk / vndv). Rendered XSS-safe via R.el into the
    // static #doc-socials section, which lives outside the mode groups → present in both Degen and Detail.
    var SVG_NS = 'http://www.w3.org/2000/svg';
    function xLogo() {
      var s = document.createElementNS(SVG_NS, 'svg');
      s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'doc-socials__x'); s.setAttribute('aria-hidden', 'true');
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z');
      p.setAttribute('fill', 'currentColor'); s.appendChild(p); return s;
    }
    var SOCIALS = [
      { name: 'Denpa Club', tag: '@denpaclub',       url: 'https://x.com/denpaclub' },
      { name: 'ubk',        tag: '@unbearableKnife', url: 'https://x.com/unbearableKnife' },
      { name: 'vndv',       tag: '@Anduresuu',       url: 'https://x.com/Anduresuu' }
    ];
    function buildSocials() {
      var host = document.getElementById('doc-socials'); if (!host) return;
      var head = R.el('h4', { class: 'doc-socials__head' }, 'Socials');
      var items = SOCIALS.map(function (s) {
        return R.el('a', { class: 'doc-socials__item', href: s.url, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': s.name + ' on X (opens in a new tab)' }, [
          xLogo(),
          R.el('span', { class: 'doc-socials__name' }, s.name),
          R.el('span', { class: 'doc-socials__tag mono' }, s.tag)
        ]);
      });
      R.mount(host, [head, R.el('div', { class: 'doc-socials__list' }, items)]);
    }

    function buildVersion() {
      var host = document.getElementById('doc-version'); if (!host) return;
      var v = (CFG.launch && CFG.launch.docsVersion) || '';
      R.mount(host, R.el('p', {}, [R.txt('TYB Docs · '), R.el('b', {}, v), R.txt(' · Denpa Club · living document')]));
    }

    // scroll-spy over the VISIBLE group's sections → highlight the matching chip
    var spy = null;
    function observeSpy() {
      if (spy) { spy.disconnect(); spy = null; }
      if (mode !== 'detail') return; // chips only render in Detail → nothing to scroll-spy in Degen
      if (!('IntersectionObserver' in window)) return;
      var group = document.getElementById(mode === 'degen' ? 'deg-group' : 'det-group');
      var scroller = document.querySelector('.docs-body');
      if (!group) return;
      var secs = group.querySelectorAll('[data-cat]');
      if (!secs.length) return;
      spy = new IntersectionObserver(function (entries) {
        var vis = entries.filter(function (e) { return e.isIntersecting; })
          .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
        if (vis.length) setActiveChip(vis[0].target.dataset.cat);
      }, { root: scroller || null, rootMargin: '0px 0px -60% 0px', threshold: 0 });
      Array.prototype.forEach.call(secs, function (s) { spy.observe(s); });
      setActiveChip(secs[0].dataset.cat);
    }

    function applyMode() {
      var deg = document.getElementById('deg-group'), det = document.getElementById('det-group');
      if (deg) deg.hidden = (mode !== 'degen');
      if (det) det.hidden = (mode !== 'detail');
      // the category chips are only useful in DETAIL (long reference); DEGEN is a few short cards → just scroll,
      // no nav needed (Le 2026-09-09). Hide the whole panel in Degen; the Degen/Detail switch stays either way.
      var panel = document.getElementById('doc-panel');
      if (panel) panel.hidden = (mode !== 'detail');
      var sw = document.getElementById('doc-switch');
      if (sw) sw.classList.toggle('is-detail', mode === 'detail'); // slide the thumb to the active tab
      if (sw) Array.prototype.forEach.call(sw.querySelectorAll('button'), function (b) {
        var on = b.dataset.mode === mode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      observeSpy();
      // recompute the edge-fade once the panel has laid out (it's display:none in Degen → 0-width until shown)
      if (mode === 'detail' && typeof requestAnimationFrame === 'function') requestAnimationFrame(updatePanelFade);
    }

    // Evolution announce gate: until CFG.launch.evolutionAnnounced, the .doc-tba teasers (degen card +
    // detail section) stay blurred and every .evo-only block (the "Can I max out a trait?" FAQ) is hidden.
    // Flipping the flag reveals both, in one place.
    function applyEvoState() {
      var announced = !!(CFG.launch && CFG.launch.evolutionAnnounced);
      Array.prototype.forEach.call(document.querySelectorAll('.doc-tba'), function (el) {
        el.classList.toggle('doc-tba--revealed', announced);
      });
      Array.prototype.forEach.call(document.querySelectorAll('.evo-only'), function (el) {
        el.hidden = !announced;
      });
    }

    function build() {
      fillCfg();
      buildDegen();
      buildSwitch();
      buildPanel();
      buildSocials();
      buildVersion();
      applyEvoState();
      applyMode();
      if (win && win.addEventListener) win.addEventListener('resize', updatePanelFade);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  }

  if (win) win.TYB_DOCS = Object.freeze(API);
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
