/*
 * TYB — shared wallet SESSION (REAL connect; loaded on ALL pages).
 * ===========================================================================
 * Le's decision (2026-09-02): connect is REAL now (needs no deployed address —
 * only chain params). Contract reads/writes stay behind the mock seam. This owns:
 *   - EIP-6963 multi-wallet discovery + picker (+ legacy window.ethereum fallback).
 *   - MULTI-CHAIN: the wallet stays on whatever chain it's on; a chain SWITCH is
 *     lazy — only when an ACTION needs it (burn→ETH, mint/refund/gacha→Robinhood).
 *   - Cross-page state (non-SPA, 6 docs): sessionStorage holds ONLY the address
 *     (public UX hint, never authority). Every page silently re-probes eth_accounts
 *     on load and repaints the app-bar. connected ≡ (account && provider).
 *   - Symmetric teardown (accountsChanged []=disconnect / provider disconnect) nulls EVERY session var +
 *     clears the hint + removes listeners (C0 lesson). chainChanged does NOT tear down — it only updates
 *     the tracked chainId (multi-chain: a network change is lazy, never a disconnect).
 *   - Mobile / social in-app-webview → guest deep-link banner.
 * Design contracts honoured: chainId null = wrong-chain; isUnlocked is MetaMask-only
 * (optional-chain + eth_accounts fallback); no secrets stored; connected gated on
 * account&&provider (never a residual field). Exposed as window.TYB_SESSION.
 */
(function () {
  'use strict';

  var CFG = (typeof window !== 'undefined' && window.TYB_ONCHAIN) || null;
  var R = (typeof window !== 'undefined' && window.TYB_RENDER) || null;
  var HINT_KEY = 'tyb:addr-hint';

  // launch-phase gate (config-driven single source of truth): which data-actions are live THIS phase.
  // An absent/empty launch block → everything enabled (dev / mock default). connect/disconnect are in the
  // configured allowlist, so no action is special-cased here. Read by BOTH the boot() click router (no-op a
  // gated action) and gateLaunchActions() (grey + disable its trigger) — one predicate, two enforcers.
  function actionEnabled(a) {
    var L = CFG && CFG.launch;
    if (L && Array.isArray(L.enabledActions)) return L.enabledActions.indexOf(a) > -1;
    // No valid launch allowlist: all-enabled in dev/mock (tests, local), but FAIL CLOSED (gate every
    // flow) in a REAL build — a truncated/updated config that drops or malforms `launch` must never
    // silently re-open mint/gacha on the public page (GO: opus P3-2 + fable P3 + sonnet P2).
    return !(CFG && CFG.SEAM_MODE === 'real');
  }

  // ── PURE helpers (node-testable; no DOM / no provider) ───────────────────
  // EIP-6963 dedupe: keep the last announcement per rdns (spec: re-announce updates).
  function dedupeProviders(list) {
    var byId = {};
    (list || []).forEach(function (d) {
      if (d && d.info && d.info.rdns) byId[d.info.rdns] = d;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }
  // chainId null (detection in-flight / unknown) is treated as WRONG, never OK.
  function chainMatch(current, targetDec) {
    if (current == null) return false;
    return BigInt(current) === BigInt(targetDec);
  }
  function isConnectedState(s) { return !!(s && s.account && s.provider); }
  function shortAddr(a) {
    if (!a || typeof a !== 'string' || a.length < 10) return a || '';
    return a.slice(0, 6) + '…' + a.slice(-4);
  }
  // wallet_addEthereumChain params for a config chain key ('robinhood' | 'ethereum'),
  // optionally the robinhood testnet.
  function addChainParams(chainKey, useTestnet) {
    if (!CFG) return null;
    var c = CFG.chains[chainKey];
    if (!c) return null;
    if (chainKey === 'robinhood' && useTestnet) {
      var t = c.testnet;
      return { chainId: t.chainIdHex, chainName: t.name, nativeCurrency: c.nativeCurrency,
        rpcUrls: t.rpcUrl ? [t.rpcUrl] : [], blockExplorerUrls: t.explorer ? [t.explorer] : [] };
    }
    return { chainId: c.chainIdHex, chainName: c.name, nativeCurrency: c.nativeCurrency,
      rpcUrls: c.rpcUrl ? [c.rpcUrl] : [], blockExplorerUrls: c.explorer ? [c.explorer] : [] };
  }
  // social/in-app webviews (IG/TikTok/Telegram/Discord/FB) usually inject no wallet → guest.
  function isMobileInApp(ua, hasInjected) {
    ua = ua || '';
    var mobile = /Android|iPhone|iPad|iPod/i.test(ua);
    var inApp = /(FBAN|FBAV|Instagram|Twitter|Line|Micromessenger|TikTok|musical_ly|Telegram|Discord|Snapchat)/i.test(ua);
    return mobile && (inApp || !hasInjected);
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // node/test context: expose only the pure helpers.
    if (typeof window !== 'undefined') {
      window.TYB_SESSION = { dedupeProviders: dedupeProviders, chainMatch: chainMatch,
        isConnectedState: isConnectedState, shortAddr: shortAddr, addChainParams: addChainParams,
        isMobileInApp: isMobileInApp, _pureOnly: true };
    }
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { dedupeProviders: dedupeProviders, chainMatch: chainMatch,
        isConnectedState: isConnectedState, shortAddr: shortAddr, addChainParams: addChainParams,
        isMobileInApp: isMobileInApp };
    }
    return;
  }

  // ── live state ───────────────────────────────────────────────────────────
  var state = { account: null, chainId: null, provider: null, providerInfo: null };
  var announced = [];       // EIP-6963 announcements
  var boundHandlers = null; // {accountsChanged, chainChanged, disconnect} for removeListener
  var gen = 0;              // generation token: a new connect OR a teardown invalidates any in-flight async connect
                            // (kills the "a slow silentReconnect overwrites the user's fresh pick" race — C0 latch).
  var unlockBound = (typeof WeakSet !== 'undefined') ? new WeakSet() : null; // providers with a one-shot 'unlock' retry

  // parse a wallet/RPC chainId to bigint, or null on empty/malformed. Co-located per the BigInt('')===0n
  // lesson: unknown chainId = WRONG-chain (fail-closed), never a stale value or a thrown handler.
  function parseChainId(cid) {
    if (cid == null || cid === '') return null;
    try { return BigInt(cid); } catch (_) { return null; }
  }

  function hintGet() { try { return sessionStorage.getItem(HINT_KEY); } catch (_) { return null; } }
  function hintSet(a) { try { a ? sessionStorage.setItem(HINT_KEY, a) : sessionStorage.removeItem(HINT_KEY); } catch (_) {} }

  function emit() {
    try { window.dispatchEvent(new CustomEvent('tyb:session', { detail: snapshot() })); } catch (_) {}
    paintBar();
  }
  function snapshot() {
    return { account: state.account, chainId: state.chainId, connected: isConnectedState(state),
      wallet: state.providerInfo ? state.providerInfo.name : null };
  }

  function _withTimeout(p, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout: ' + (label || 'wallet'))); } }, ms || 30000);
      Promise.resolve(p).then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
    });
  }

  // ── EIP-6963 discovery ────────────────────────────────────────────────────
  function initDiscovery() {
    window.addEventListener('eip6963:announceProvider', function (ev) {
      if (ev && ev.detail && ev.detail.info && ev.detail.provider) {
        announced.push({ info: ev.detail.info, provider: ev.detail.provider });
      }
    });
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (_) {}
  }
  function providers() {
    var list = dedupeProviders(announced);
    if (list.length === 0 && window.ethereum) {
      // legacy fallback: a single injected provider that never announced (older wallets).
      var eth = window.ethereum;
      var infos = eth.providers && eth.providers.length ? eth.providers : [eth];
      list = infos.map(function (p, i) {
        return { info: { rdns: 'legacy.' + i, name: p.isMetaMask ? 'MetaMask' : 'Injected wallet' }, provider: p };
      });
    }
    return list;
  }

  // ── connect / teardown ─────────────────────────────────────────────────────
  function bindProviderEvents(p) {
    unbindProviderEvents();
    boundHandlers = {
      provider: p,
      accountsChanged: function (accs) {
        if (!accs || accs.length === 0) { resetSession(); return; }   // [] = site disconnected
        state.account = String(accs[0]).toLowerCase();                 // switch account
        hintSet(state.account); emit();
      },
      chainChanged: function (cid) { state.chainId = parseChainId(cid); emit(); }, // malformed → null = wrong-chain
      disconnect: function () { resetSession(); }
    };
    if (p.on) { p.on('accountsChanged', boundHandlers.accountsChanged);
      p.on('chainChanged', boundHandlers.chainChanged);
      p.on('disconnect', boundHandlers.disconnect); }
  }
  function unbindProviderEvents() {
    if (boundHandlers && boundHandlers.provider) {
      var p = boundHandlers.provider;
      var off = p.removeListener || p.off; // some providers expose only .off — detach either way (C0 #3)
      if (off) {
        off.call(p, 'accountsChanged', boundHandlers.accountsChanged);
        off.call(p, 'chainChanged', boundHandlers.chainChanged);
        off.call(p, 'disconnect', boundHandlers.disconnect);
      }
    }
    boundHandlers = null;
  }
  // SYMMETRIC teardown — every path leaves identical state (C0 lesson). Bumps `gen` so any in-flight
  // connect/reconnect discards its commit. Does NOT touch readerChainId: that is a property of the
  // read-provider layer (wallet-INDEPENDENT — reads must work for guests), set by the READER inside
  // tyb-chain.js (B3-1: proxy→public ladder, `TYB.readerStatus()`), never from the wallet's chainId.
  function resetSession() {
    gen++;
    unbindProviderEvents();
    state = { account: null, chainId: null, provider: null, providerInfo: null };
    hintSet(null);
    emit();
  }

  async function useProvider(entry) {
    var myGen = ++gen; // a fresh explicit connect supersedes any in-flight reconnect/connect
    var p = entry.provider;
    var accs = await _withTimeout(p.request({ method: 'eth_requestAccounts' }), 30000, 'connect');
    if (!accs || accs.length === 0) throw new Error('no accounts');
    var cid = await _withTimeout(p.request({ method: 'eth_chainId' }), 15000, 'chainId');
    if (myGen !== gen) return snapshot(); // superseded (newer connect / teardown) while awaiting — discard commit
    state.provider = p; state.providerInfo = entry.info;
    state.account = String(accs[0]).toLowerCase();
    state.chainId = parseChainId(cid);
    hintSet(state.account);
    bindProviderEvents(p);
    emit();
    return snapshot();
  }

  async function connect() {
    var list = providers();
    if (list.length === 0) {
      if (isMobileInApp(navigator.userAgent, false)) { showMobileBanner(); return; }
      showPicker([]); // "no wallet found" state
      return;
    }
    if (list.length === 1) {
      try { return await useProvider(list[0]); }
      catch (e) { showConnectError(e); return; }
    }
    return new Promise(function (resolve) { showPicker(list, resolve); });
  }

  function disconnect() { resetSession(); }

  // silent reconnect on load — eth_accounts (NO prompt), isUnlocked optional (MetaMask-only).
  async function silentReconnect() {
    if (state.provider) return;              // already connected — NEVER overwrite a live session (C0 race)
    var myGen = gen;
    var list = providers();
    if (list.length === 0) return;
    var hint = hintGet();
    var candidates = [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      try {
        var mm = entry.provider._metamask; // MetaMask-only; other EIP-6963 wallets fall through to eth_accounts
        if (mm && typeof mm.isUnlocked === 'function') {
          var unlocked = await mm.isUnlocked().catch(function () { return true; });
          if (!unlocked) { bindUnlockRetry(entry.provider); continue; } // locked → don't claim; retry on 'unlock'
        }
        var accs = await entry.provider.request({ method: 'eth_accounts' }); // silent, no prompt
        if (accs && accs.length) candidates.push({ entry: entry, account: String(accs[0]).toLowerCase() });
      } catch (_) { /* try next */ }
    }
    if (!candidates.length || myGen !== gen || state.provider) return; // nothing authorized, or superseded
    // prefer the wallet whose authorized account matches the last-used hint (an ADDRESS); else the first.
    var chosen = (hint && candidates.filter(function (c) { return c.account === String(hint).toLowerCase(); })[0]) || candidates[0];
    var cid = await chosen.entry.provider.request({ method: 'eth_chainId' }).catch(function () { return null; });
    if (myGen !== gen || state.provider) return; // re-check after the last await
    state.provider = chosen.entry.provider; state.providerInfo = chosen.entry.info;
    state.account = chosen.account;
    state.chainId = parseChainId(cid);
    hintSet(state.account);
    bindProviderEvents(chosen.entry.provider);
    emit();
  }
  // one-shot 'unlock' retry (MetaMask) so a page opened with a locked wallet auto-connects once unlocked.
  function bindUnlockRetry(p) {
    if (!p || !p.on || !unlockBound || unlockBound.has(p)) return;
    unlockBound.add(p);
    try { p.on('unlock', function () { if (!state.provider) silentReconnect().catch(function () {}); }); } catch (_) {}
  }

  // ── chain switch (LAZY — called by an action, not at connect) ──────────────
  // target: 'robinhood' | 'ethereum'; useTestnet only meaningful for robinhood.
  async function switchToChain(target, useTestnet) {
    if (!state.provider) throw new Error('not connected');
    var params = addChainParams(target, useTestnet);
    if (!params) throw new Error('unknown chain ' + target);
    try {
      await _withTimeout(state.provider.request({ method: 'wallet_switchEthereumChain',
        params: [{ chainId: params.chainId }] }), 30000, 'switchChain');
    } catch (e) {
      // 4902 = chain not added to the wallet → add it (needs a non-empty rpcUrls).
      if (e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902))) {
        if (!params.rpcUrls.length) throw new Error('cannot add ' + target + ': no rpcUrl in config');
        await _withTimeout(state.provider.request({ method: 'wallet_addEthereumChain', params: [params] }), 60000, 'addChain');
      } else { throw e; }
    }
    var cid = await state.provider.request({ method: 'eth_chainId' }).catch(function () { return null; });
    state.chainId = parseChainId(cid);
    emit();
    // NOTE: some wallets ADD a chain without switching to it — the CALLER (an action in chunks 3-8) must
    // re-check isOnChain(target) after this resolves before proceeding to the write.
    return state.chainId;
  }
  // is the wallet currently on `target`? For a READ-liveness check (no 2nd arg) 'robinhood' accepts
  // EITHER mainnet (4663) or testnet (46630). For a WRITE gate, pass `useTestnet` (the action's env)
  // to require the EXACT env: without it a wallet sitting on the WRONG Robinhood env passes the
  // pre-write gate (switchToChain is env-aware but the both-accept isOnChain wasn't), the write lands
  // on a no-code address (a mainnet addr on testnet, or vice-versa) → status-1 FORGED success, or REAL
  // ETH to a dead address during a testnet rehearsal. (opus P2, chunk-5 GO — same class as the ★ lesson.)
  function isOnChain(target, useTestnet) {
    if (target === 'ethereum') return chainMatch(state.chainId, CFG.chains.ethereum.chainId);
    var mainOk = chainMatch(state.chainId, CFG.chains.robinhood.chainId);
    var testOk = chainMatch(state.chainId, CFG.chains.robinhood.testnet.chainId);
    if (useTestnet === true) return testOk;   // exact — testnet rehearsal
    if (useTestnet === false) return mainOk;  // exact — mainnet launch
    return mainOk || testOk;                  // read-liveness watermark: either env
  }

  // ── app-bar (rendered on every page; one source of truth) ──────────────────
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(paths, extra) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    (paths || []).forEach(function (d) {
      var el = document.createElementNS(SVG_NS, d.tag || 'path');
      Object.keys(d.attrs || {}).forEach(function (k) { el.setAttribute(k, d.attrs[k]); });
      s.appendChild(el);
    });
    if (extra) Object.keys(extra).forEach(function (k) { s.setAttribute(k, extra[k]); });
    return s;
  }
  var ICON = {
    back: [{ attrs: { d: 'M15 5l-7 7 7 7' } }],
    docs: [{ attrs: { d: 'M5 4.5A2.5 2.5 0 0 1 7.5 2H19v20H7.5A2.5 2.5 0 0 1 5 19.5z' } }, { attrs: { d: 'M9 7h7M9 11h7M9 15h4.5' } }],
    inventory: [{ tag: 'rect', attrs: { x: '3', y: '3', width: '7', height: '7', rx: '1.6' } }, { tag: 'rect', attrs: { x: '14', y: '3', width: '7', height: '7', rx: '1.6' } }, { tag: 'rect', attrs: { x: '3', y: '14', width: '7', height: '7', rx: '1.6' } }, { tag: 'rect', attrs: { x: '14', y: '14', width: '7', height: '7', rx: '1.6' } }],
    gacha: [{ attrs: { d: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z' } }, { attrs: { d: 'M14 6.5v11', 'stroke-dasharray': '1.6 2.4' } }],
    claim: [{ tag: 'rect', attrs: { x: '3.5', y: '8', width: '17', height: '4', rx: '1' } }, { attrs: { d: 'M5 12v8h14v-8' } }, { attrs: { d: 'M12 8v12' } }, { attrs: { d: 'M12 8S10.6 4.2 8.6 4.2 6.3 6 8.2 8zM12 8s1.4-3.8 3.4-3.8S17.7 6 15.8 8z' } }]
  };
  function iconBtn(action, title, paths) {
    var b = R.el('button', { type: 'button', class: 'app-ibtn', title: title, 'aria-label': title, dataset: { action: action } });
    b.appendChild(svg(paths)); return b;
  }
  // Verified-badge seal — 1:1 with Modulo's official X-verified geometry: the scallop points are ROUNDED
  // (the real badge burst), NOT a spiky star (Le 2026-09-09 "las puntas redondeadas ojo"). Two TRUSTED
  // static subpaths in raw 0..6000 coords under a translate(0,600) scale(0.1,-0.1) flip: blue seal body +
  // white check. Used for the app-bar X link — a plain external <a>, NOT a [data-action], so the launch
  // gate never touches it (socials/X stay live through the pre-mint phase).
  var SEAL_D = 'M2826 5685 c-294 -61 -554 -256 -685 -514 -25 -48 -18 -47 -126 -17 -105 29 -235 38 -343 26 -410 -49 -737 -341 -850 -758 -23 -87 -26 -115 -25 -267 0 -152 3 -180 26 -265 14 -52 22 -96 16 -98 -5 -2 -44 -26 -86 -54 -154 -100 -308 -290 -374 -463 -63 -163 -72 -215 -73 -400 0 -153 3 -180 27 -270 31 -115 99 -262 161 -349 57 -81 162 -185 239 -237 l62 -42 1 -151 c1 -128 5 -166 27 -248 65 -245 223 -471 420 -601 74 -49 205 -110 282 -130 163 -44 363 -42 509 4 34 10 67 19 73 19 7 0 22 -19 34 -42 113 -222 341 -413 579 -486 161 -49 356 -54 515 -13 256 66 505 266 624 500 25 48 18 47 126 17 145 -39 331 -40 479 -1 258 68 485 249 619 495 83 152 135 377 125 548 l-5 89 46 29 c63 40 184 156 243 234 28 36 72 110 99 165 233 476 76 1063 -359 1343 -35 22 -68 42 -74 44 -6 2 -3 27 10 68 46 149 53 352 18 516 -92 433 -431 752 -855 803 -129 16 -290 -1 -408 -43 l-41 -14 -13 30 c-22 54 -103 171 -163 235 -120 130 -301 239 -471 284 -104 27 -310 35 -409 14z';
  var CHECK_D = 'M3936 3994 c72 -41 108 -127 85 -204 -13 -45 -1131 -1729 -1172 -1767 -13 -12 -37 -26 -52 -32 -42 -16 -123 -13 -160 5 -45 23 -663 639 -695 694 -72 121 13 279 151 282 85 1 100 -9 352 -262 132 -132 243 -240 248 -240 4 0 228 332 498 738 270 405 500 748 512 760 60 65 149 74 233 26z';
  function sealSvg() {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 600 600'); s.setAttribute('class', 'app-vbadge__seal'); s.setAttribute('aria-hidden', 'true');
    var g = document.createElementNS(SVG_NS, 'g'); g.setAttribute('transform', 'translate(0,600) scale(0.1,-0.1)');
    var seal = document.createElementNS(SVG_NS, 'path'); seal.setAttribute('d', SEAL_D); seal.setAttribute('fill', '#4f8df7');
    var check = document.createElementNS(SVG_NS, 'path'); check.setAttribute('d', CHECK_D); check.setAttribute('fill', '#fff');
    g.appendChild(seal); g.appendChild(check); s.appendChild(g); return s;
  }
  function buildBar() {
    // "Back to the pack" — a plain <a> to the home page, shown on every SUB-page (Le 2026-09-02:
    // every window needs a way back/out). The index IS the pack (it owns the snap-scroll .track), so
    // the back link is hidden there. safeUrl passes 'index.html' (bare relative).
    var isHome = !!document.querySelector('.track');
    var back = R.el('a', { class: 'app-btn app-btn--back', href: 'index.html', title: 'Back to the pack', 'aria-label': 'Back to the pack' }, [svg(ICON.back), R.txt(' Back')]);
    back.hidden = isHome;
    var docs = R.el('a', { class: 'app-btn app-btn--docs', href: 'docs.html' }, [svg(ICON.docs), R.txt(' Docs')]);
    // Verified-badge X link, right beside Docs (Le 2026-09-09). Denpa Club is the project hub → the main
    // account. External <a> (opens a new tab, noopener/noreferrer) — no [data-action], so always live.
    var x = R.el('a', { class: 'app-btn app-btn--x app-vbadge', href: 'https://x.com/denpaclub', target: '_blank', rel: 'noopener noreferrer', title: 'Denpa Club on X', 'aria-label': 'Denpa Club on X (opens in a new tab)' }, [sealSvg()]);
    // LIVE watermark (design contract #3): "N/M live" from TYB.liveStatus() so a partial wiring is never silent;
    // "· degraded" while the reader is latched onto the public RPC. Hidden in mock mode. Text only (XSS-safe).
    var live = R.el('span', { class: 'app-live mono', title: 'on-chain reads wired / total (deferred seams excluded)' }, '');
    live.hidden = true;
    var left = R.el('div', { class: 'app-left' }, [back, docs, x, live]);
    var connect = R.el('button', { type: 'button', class: 'app-btn app-btn--connect', dataset: { action: 'connect' } }, 'Connect');
    var account = R.el('button', { type: 'button', class: 'app-btn app-btn--account', title: 'Disconnect', 'aria-label': 'Wallet connected — tap to disconnect', dataset: { action: 'disconnect' } },
      [R.el('span', { class: 'app-dot', 'aria-hidden': 'true' }), R.el('span', { class: 'app-addr mono' }, '')]);
    var nav = R.el('nav', { class: 'app-actions', 'aria-label': 'Wallet' },
      [iconBtn('inventory', 'Inventory', ICON.inventory), iconBtn('gacha', 'Gacha', ICON.gacha), iconBtn('claim', 'Claim', ICON.claim), account]);
    var wallet = R.el('div', { class: 'app-wallet' }, [connect, nav]);
    return R.el('header', { class: 'app-bar' }, [left, wallet]);
  }
  function paintBar() {
    var top = document.querySelector('.app-top');
    if (!top) return;
    if (!top.querySelector('.app-bar')) { R.mount(top, buildBar()); }
    if (isConnectedState(state)) top.classList.add('is-connected'); else top.classList.remove('is-connected');
    var addr = top.querySelector('.app-addr');
    if (addr) R.mount(addr, R.txt(shortAddr(state.account)));
    paintLive(top);
  }
  var liveBound = false;
  function paintLive(top) {
    var el = top.querySelector('.app-live'); var T = window.TYB;
    if (!el || !T || T.MODE !== 'real' || typeof T.liveStatus !== 'function') return;
    if (CFG && CFG.launch && CFG.launch.showLiveWatermark === false) return; // launch build: the internal wiring chip stays hidden
    if (!liveBound) { liveBound = true; window.addEventListener('tyb:reader', function () { paintBar(); }); }
    var ls = T.liveStatus(); var rs = T.readerStatus ? T.readerStatus() : null;
    var wired = ls.total - ls.deferred;
    var txt = ls.live + '/' + wired + ' live';
    if (ls.misconfigured > 0) txt += ' · ' + ls.misconfigured + ' misconfigured';
    if (rs && rs.degraded) txt += ' · degraded (public RPC)';
    if (rs && !rs.chainId) txt += ' · reader down';
    el.hidden = false;
    R.mount(el, R.txt(txt));
  }

  // ── shared MODAL primitive (XSS-safe) — one home for "a window with a way out" ──
  // Every overlay (wallet picker, mobile banner, the mint modal in mint.js) gets: a ✕ close
  // button, Escape-to-close, backdrop-click-to-close, a focus trap, and focus RESTORE to the
  // element that opened it. Le 2026-09-02: every window needs a visible close/back control.
  // Returns { overlay, card, body, close }; the caller renders into `body`. Exposed as TYB_SESSION.modal.
  var modalStack = []; // topmost-last; Escape only closes the top one (nested picker-over-mint, GO 3/3)
  function buildModal(titleText, opts) {
    opts = opts || {};
    var prevFocus = (document.activeElement && typeof document.activeElement.focus === 'function') ? document.activeElement : null;
    var closeBtn = R.el('button', { type: 'button', class: 'tyb-modal__close', title: 'Close', 'aria-label': 'Close' }, '✕');
    var head = R.el('div', { class: 'tyb-modal__head' }, [R.el('h3', { class: 'tyb-modal__title' }, titleText || ''), closeBtn]);
    var body = R.el('div', { class: 'tyb-modal__body' });
    var card = R.el('div', { class: 'tyb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': titleText || 'Dialog', tabindex: '-1' }, [head, body]);
    var ov = R.el('div', { class: 'tyb-overlay' }, card);
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      var i = modalStack.indexOf(inst); if (i >= 0) modalStack.splice(i, 1);
      ov.remove();
      if (prevFocus && (!document.contains || document.contains(prevFocus))) { try { prevFocus.focus(); } catch (_) {} }
      if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (_) {} }
    }
    function focusables() {
      var all = card.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      return Array.prototype.slice.call(all).filter(function (n) { return !n.disabled; });
    }
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== inst) return; // only the topmost modal handles keys
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) { e.preventDefault(); try { card.focus(); } catch (_) {} return; }
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
    var inst = { overlay: ov, card: card, body: body, close: close };
    closeBtn.addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey, true);
    modalStack.push(inst);
    document.body.appendChild(ov);
    try { card.focus(); } catch (_) {}
    return inst;
  }
  function connectErrorMsg(e) {
    if (e && (e.code === 4001 || e.code === 'ACTION_REJECTED')) return 'Connection cancelled in the wallet.';
    if (e && /timeout/i.test(e.message || '')) return 'The wallet did not respond. Please try again.';
    return 'Could not connect. Please try again.';
  }
  function showConnectError(e) {
    var m = buildModal('Connect a wallet');
    R.mount(m.body, R.el('p', { class: 'tyb-modal__empty' }, connectErrorMsg(e)));
  }
  function showPicker(list, resolve) {
    var m = buildModal('Connect a wallet', { onClose: function () { if (resolve) { resolve(null); resolve = null; } } });
    var rows = (list && list.length)
      ? list.map(function (entry) {
          var b = R.el('button', { type: 'button', class: 'tyb-wallet-row' }, entry.info.name || 'Wallet');
          b.addEventListener('click', function () {
            var done = resolve; resolve = null; // consume before close() (onClose must not resolve(null) after success)
            m.close();
            useProvider(entry).then(function (s) { if (done) done(s); })
              .catch(function (e) { showConnectError(e); if (done) done(null); }); // feedback, never a hung promise
          });
          return b;
        })
      : [R.el('p', { class: 'tyb-modal__empty' }, 'No wallet detected. Install a browser wallet (e.g. MetaMask) and reload.')];
    R.mount(m.body, rows);
  }
  function showMobileBanner() {
    var m = buildModal('Open in your wallet');
    R.mount(m.body, [
      R.el('p', { class: 'tyb-modal__empty' }, 'This in-app browser has no wallet. Open this page inside your wallet app’s browser, or copy the link:'),
      R.el('code', { class: 'tyb-modal__url' }, location.href)
    ]);
    return m;
  }

  // ── boot ───────────────────────────────────────────────────────────────────
  // launch-phase: grey + disable every [data-action] entry point NOT enabled this phase — the index
  // reverse mint/gacha buttons, the refund button, AND the app-bar inventory/gacha/claim icons (the
  // shared bar injects those on every page, so gating here covers all pages in one place). Own marker
  // `.is-gated` (the look) + native `disabled` (the behavioral block: no mouse, keyboard, or .click())
  // + aria-disabled + tabindex -1. The router (boot) ALSO no-ops a gated action — defense-in-depth for
  // any trigger added later without going through this sweep. Runs AFTER paintBar() so the bar exists.
  function gateLaunchActions() {
    var nodes = document.querySelectorAll('[data-action]');
    Array.prototype.forEach.call(nodes, function (el) {
      var a = el.dataset.action;
      if (!a || a === 'connect' || a === 'disconnect') return;
      if (actionEnabled(a)) return;
      el.classList.add('is-gated');
      if (typeof el.disabled === 'boolean') el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('tabindex', '-1');
    });
  }

  function boot() {
    // frame-buster: a wallet-bearing page must never run framed (clickjacking / drainer bait).
    try { if (window.top !== window.self) { window.top.location = window.self.location; return; } }
    catch (_) { document.documentElement.style.display = 'none'; return; }
    initDiscovery();
    // give wallets a tick to announce, then paint + silent-reconnect.
    paintBar();
    gateLaunchActions(); // launch-phase: grey + disable off-phase entry points (bar is built above)
    setTimeout(function () { silentReconnect().catch(function () {}); }, 60);
    // (no cross-tab 'storage' sync: the hint is sessionStorage — per-tab by design — so it never fires
    //  across tabs; each tab's own silentReconnect + the wallet's accountsChanged keep its bar correct.)
    // SESSION owns every data-action on every page (it loads on all 6; script.js is index-only).
    // connect/disconnect + nav (inventory/gacha/claim/refund, gtd→burn.html) + mint→TYB_MINT.open() (mint.js).
    var NAV = { inventory: 'inventory.html', gacha: 'gacha.html', claim: 'claim.html', refund: 'refund.html', gtd: 'burn.html' };
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-action]');
      if (!el) return;
      var a = el.dataset.action;
      if (!actionEnabled(a)) { e.preventDefault(); return; } // launch-phase gate — no-op a gated action even if a click reaches it
      if (a === 'connect') { e.preventDefault(); connect().catch(function () {}); }
      else if (a === 'disconnect') { e.preventDefault(); disconnect(); }
      else if (a === 'mint') { if (window.TYB_MINT && typeof window.TYB_MINT.open === 'function') { e.preventDefault(); window.TYB_MINT.open(); } }
      // NAV → route through the page-transition fade when tyb-motion.js is present; plain redirect otherwise
      // (revert: this else-branch reverts to `window.location.href = NAV[a]`). Gate already returned above.
      else if (NAV[a]) { e.preventDefault(); if (window.TYB_TRANSITION) window.TYB_TRANSITION.go(NAV[a]); else window.location.href = NAV[a]; }
    });
  }

  window.TYB_SESSION = {
    // pure (tested)
    dedupeProviders: dedupeProviders, chainMatch: chainMatch, isConnectedState: isConnectedState,
    shortAddr: shortAddr, addChainParams: addChainParams, isMobileInApp: isMobileInApp,
    // live
    connect: connect, disconnect: disconnect, switchToChain: switchToChain, isOnChain: isOnChain,
    snapshot: snapshot, get: function () { return snapshot(); }, hint: hintGet,
    // WRITE path only (B3-2): the raw EIP-1193 provider of the connected wallet, for tyb-chain's signer. Never used for
    // reads (those go through the wallet-independent reader) and never exposed in snapshot() (it is not display state).
    rawProvider: function () { return state.provider; },
    modal: buildModal // shared "window with a close button" primitive (used by mint.js)
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
