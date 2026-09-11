/*
 * TYB — MINT modal controller (chunk 5; index-only, opened by the page-2 MINT button).
 * ===========================================================================
 * A modal (NOT a page) over the pack. tyb-session.js routes data-action="mint" → TYB_MINT.open().
 * It reuses the shared modal primitive (TYB_SESSION.modal → ✕ / Escape / backdrop / focus-restore,
 * per Le's "every window needs a way out") and the proven write-page shell from refund.js/burn.js:
 *   busy-guard anti-repaint · re-validate right before the tx · ★ re-check isOnChain+connected
 *   IMMEDIATELY before the write (the wallet chain is shared mutable state) · wait-timeout→pending ·
 *   revert map == TYB721 custom errors · ACTION_REJECTED · receipt.status===0 · all DOM via the
 *   XSS-safe builder · keyboard-reachable controls.
 *
 * Phases (TYB721 enum Setup/GTD/FCFS/Public/Closed): GTD and FCFS are BOTH Merkle-gated.
 *   mintGtd(qty, allowedQty, proof) · mintFcfs(qty, proof) · mintPublic(qty). All payable; the real
 *   seam attaches value = PRICE*qty (single source: onchain-config priceWei). Caps: per-wallet
 *   MAX_PER_WALLET=4 (numberMinted, monotonic), global MAX_SUPPLY=4444 (totalMintedEver), and for GTD
 *   the leaf allowance minus gtdMinted[you]. Reads go through the mock seam now; connect is real.
 *
 * The pure state machine (computeState/revertCopy) is exposed on window.TYB_MINT for node tests;
 * the DOM half only wires when TYB + TYB_SESSION + TYB_RENDER + document are present.
 */
(function () {
  'use strict';
  var win = (typeof window !== 'undefined') ? window : null;
  var CFG = win && win.TYB_ONCHAIN;
  if (!CFG) { if (typeof module !== 'undefined' && module.exports) module.exports = {}; return; }
  var C = CFG.collection;
  var MAXW = C.maxPerWallet;   // 4 — per-wallet AND per-tx cap
  var MAXSUP = C.maxSupply;    // 4444

  // ── PURE state machine (node-testable; no DOM / no provider) ───────────────
  // x: { connected, phase:bigint, totalMintedEver:bigint, numberMinted:bigint, paused:bool,
  //      gtd:{onList,allowedQty:bigint,proof}|null, gtdMinted:bigint|null, fcfs:{onList,proof}|null }
  // Returns { kind, ... }. Mintable kinds (gtd/fcfs/public) carry `cap` (>=1) + display fields +
  // the write inputs (allowedQty/proof). Ordering: phase-level → global sold-out → personal cap →
  // paused → per-phase eligibility, so each message is the most specific true one.
  function computeState(x) {
    if (!x || !x.connected) return { kind: 'connect' };
    var phase = x.phase;
    if (phase === 0n) return { kind: 'setup' };
    if (phase === 4n) return { kind: 'closed' };
    var walletRem = Number(BigInt(MAXW) - x.numberMinted);
    var supplyRem = Number(BigInt(MAXSUP) - x.totalMintedEver);
    if (walletRem <= 0) return { kind: 'wallet-cap' };
    if (supplyRem <= 0) return { kind: 'sold-out' };
    if (x.paused) return { kind: 'paused' };
    if (phase === 1n) {
      if (!x.gtd || !x.gtd.onList) return { kind: 'gtd-not-on-list' };
      var gtdRem = Number(x.gtd.allowedQty - (x.gtdMinted || 0n));
      if (gtdRem <= 0) return { kind: 'gtd-exhausted' };
      return { kind: 'gtd', cap: Math.min(gtdRem, walletRem, supplyRem),
        allowedQty: x.gtd.allowedQty, proof: x.gtd.proof || [], walletRem: walletRem, supplyRem: supplyRem };
    }
    if (phase === 2n) {
      if (!x.fcfs || !x.fcfs.onList) return { kind: 'fcfs-not-on-list' };
      return { kind: 'fcfs', cap: Math.min(walletRem, supplyRem), proof: x.fcfs.proof || [],
        walletRem: walletRem, supplyRem: supplyRem };
    }
    if (phase === 3n) return { kind: 'public', cap: Math.min(walletRem, supplyRem),
      walletRem: walletRem, supplyRem: supplyRem };
    return { kind: 'unknown' };
  }

  var PHASE_LABEL = { gtd: 'GTD phase', fcfs: 'FCFS phase', public: 'Public mint' };

  function revertCopy(e) {
    if (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) return 'You cancelled the request in your wallet.';
    if (e && e.receipt && Number(e.receipt.status) === 0) return 'The mint transaction reverted on-chain. Nothing was minted.';
    var name = e && e.revert && e.revert.name;
    var m = {
      BadProof: 'Your wallet is not on this phase’s allowlist.',
      GtdAllowanceExceeded: 'That is more than your GTD allowance.',
      WalletCapExceeded: 'That exceeds the limit of ' + MAXW + ' per wallet.',
      SoldOut: 'Tokyo Youth Battle is sold out.',
      BadQuantity: 'Choose between 1 and ' + MAXW + ' tokens.',
      WrongValue: 'The payment amount was wrong. Please reopen and try again.',
      WrongPhase: 'The mint phase just changed. Please reopen the mint window.',
      MintPausedErr: 'Minting is paused right now.'
    };
    if (m[name]) return m[name];
    if (e && e.message && !name && !e.code) {
      if (/^timeout:/i.test(e.message)) return 'The wallet took too long to respond. Please try again.'; // internal _withTimeout label, not for users
      return e.message; // an error WE threw (switch/disconnect/changed) — actionable, user-facing
    }
    return 'The mint could not be completed. Please try again.';
  }

  // display: PRICE(ether) * qty, trimmed (small values, display only — the tx value is computed on-chain).
  function fmtEth(q) {
    var v = (parseFloat(C.price) * q).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return v === '' ? '0' : v;
  }

  // ── expose the pure surface (always) ───────────────────────────────────────
  var API = { open: function () {}, computeState: computeState, revertCopy: revertCopy, fmtEth: fmtEth };

  // ── DOM half (only when the browser globals are present) ───────────────────
  if (win.TYB && win.TYB_SESSION && win.TYB_RENDER && typeof document !== 'undefined') {
    var TYB = win.TYB, S = win.TYB_SESSION, R = win.TYB_RENDER;
    var USE_TESTNET = CFG.activeEnv === 'testnet';
    var WAIT_TIMEOUT_MS = 120000;

    var modal = null, body = null, busy = false, qty = 1, gen = 0;
    // `gen` is the modal-session generation latch (C0/chunk-2 pattern applied to this controller): open,
    // close, and each render bump it; every async commit captures myGen and no-ops if superseded. Kills
    // the reopen-during-pending race (a stale tx painting "✓ Minted" over a NEW modal / re-arming a 3rd
    // mint — fable P2-2) and out-of-order tyb:session renders (sonnet P2-3). chunk-5 GO.

    function msg(text, cls) { return R.el('p', { class: 'rf-msg' + (cls ? ' ' + cls : '') }, text); }
    function setBody(node) { if (body) R.mount(body, node); }
    function closeBtnEl(label) {
      var b = R.el('button', { type: 'button', class: 'rf-btn rf-btn--ghost' }, label || 'Close');
      b.addEventListener('click', function () { if (modal) modal.close(); });
      return b;
    }

    function open() {
      if (modal) return; // one modal at a time
      gen++; qty = 1; busy = false;
      modal = S.modal('Mint · Tokyo Youth Battle', { onClose: onClose });
      body = modal.body;
      win.addEventListener('tyb:session', onSession);
      render();
    }
    // bump gen so any in-flight render/mint from this now-dead session no-ops its commit.
    function onClose() { gen++; win.removeEventListener('tyb:session', onSession); modal = null; body = null; busy = false; }
    function onSession() { if (busy || !modal) return; render(); } // connect/account change → refresh (never mid-tx)

    function render() {
      if (!modal) return;
      var myGen = ++gen; // supersede any older in-flight render (out-of-order tyb:session — sonnet P2-3)
      var snap = S.snapshot();
      if (!snap.connected) { paint({ kind: 'connect' }); return; }
      setBody(msg('Loading mint status…'));
      Promise.all([TYB.call.getPhase(), TYB.call.getSupply(), TYB.call.getNumberMinted(snap.account), TYB.call.getMintPaused()])
        .then(function (core) {
          var base = { connected: true, phase: core[0], totalMintedEver: core[1].totalMintedEver,
            numberMinted: core[2], paused: core[3] };
          if (base.phase === 1n) {
            return Promise.all([TYB.call.getGtdEligibility(snap.account), TYB.call.getGtdMinted(snap.account)])
              .then(function (g) { base.gtd = g[0]; base.gtdMinted = g[1]; return base; });
          }
          if (base.phase === 2n) {
            return TYB.call.getFcfsEligibility(snap.account).then(function (f) { base.fcfs = f; return base; });
          }
          return base;
        })
        .then(function (base) { if (myGen !== gen || !modal) return; qty = 1; paint(computeState(base)); })
        .catch(function (e) { if (myGen !== gen || !modal) return; paintDone('Could not load the mint status. ' + ((e && e.message) || ''), true); });
    }

    // fetch fresh state (no paint) for the re-validate step right before the tx.
    // ★ STRICT reads (B3-2): the pre-write re-validation goes through the pinned proxy ONLY — never the public
    // fallback (a forced proxy outage must not let an un-pinned node feed the allowedQty/phase the user signs on).
    function refetch(account) {
      var R = TYB.strict || TYB.call;
      return Promise.all([R.getPhase(), R.getSupply(), R.getNumberMinted(account), R.getMintPaused()])
        .then(function (core) {
          var base = { connected: S.snapshot().connected, phase: core[0], totalMintedEver: core[1].totalMintedEver,
            numberMinted: core[2], paused: core[3] };
          if (base.phase === 1n) {
            return Promise.all([R.getGtdEligibility(account), R.getGtdMinted(account)])
              .then(function (g) { base.gtd = g[0]; base.gtdMinted = g[1]; return computeState(base); });
          }
          if (base.phase === 2n) {
            return R.getFcfsEligibility(account).then(function (f) { base.fcfs = f; return computeState(base); });
          }
          return computeState(base);
        });
    }

    function paint(state) {
      if (!modal) return;
      switch (state.kind) {
        case 'connect': return paintConnect();
        case 'setup': return paintInfo('Minting hasn’t started yet. Check back soon.');
        case 'closed': return paintInfo('Minting has closed.');
        case 'wallet-cap': return paintInfo('You’ve minted the maximum of ' + MAXW + ' TYB for this wallet.');
        case 'sold-out': return paintInfo('Tokyo Youth Battle is sold out.');
        case 'paused': return paintInfo('Minting is paused right now. Check back soon.');
        case 'gtd-not-on-list': return paintInfo('You’re not on the GTD allowlist yet. Burn Frog Heads to earn a guaranteed spot, or wait for public minting.', 'burn');
        case 'gtd-exhausted': return paintInfo('You’ve used your full GTD allowance.');
        case 'fcfs-not-on-list': return paintInfo('You’re not on the FCFS allowlist. Public minting opens later.');
        case 'gtd': case 'fcfs': case 'public': return paintMint(state);
        default: return paintInfo('Minting is unavailable right now.');
      }
    }

    function paintConnect() {
      var b = R.el('button', { type: 'button', class: 'rf-btn', dataset: { action: 'connect' } }, 'Connect wallet');
      setBody(R.el('div', { class: 'rf-connect' }, [msg('Connect your wallet to mint a Tokyo Youth Battle NFT.'), b]));
    }

    function paintInfo(text, extra) {
      var kids = [msg(text)];
      if (extra === 'burn') {
        kids.push(R.el('a', { class: 'rf-btn', href: 'burn.html' }, 'Burn Frog Heads'));
      }
      kids.push(closeBtnEl('Close'));
      setBody(R.el('div', {}, kids));
    }

    function paintDone(text, retry) {
      var kids = [msg(text)];
      if (retry) {
        var again = R.el('button', { type: 'button', class: 'rf-btn' }, 'Try again');
        again.addEventListener('click', render);
        kids.push(again);
      }
      kids.push(closeBtnEl('Close'));
      setBody(R.el('div', {}, kids));
    }

    function paintSuccess(n) {
      setBody(R.el('div', {}, [
        msg('✓ Minted ' + n + ' Tokyo Youth Battle NFT' + (n === 1 ? '' : 's') + '. It’ll appear in your Inventory.'),
        closeBtnEl('Done')
      ]));
    }

    function paintMint(state) {
      if (qty > state.cap) qty = state.cap;
      if (qty < 1) qty = 1;
      var badge = R.el('span', { class: 'rf-status rf-status--open' }, PHASE_LABEL[state.kind] || 'Mint');
      var sub = 'Up to ' + state.cap + ' this transaction · ' + fmtEth(1) + ' ETH each' +
        (state.kind === 'gtd' ? ' · GTD allowance ' + state.allowedQty.toString() : '');

      var minus = R.el('button', { type: 'button', class: 'mint-step', 'aria-label': 'Decrease quantity' }, '−');
      var plus = R.el('button', { type: 'button', class: 'mint-step', 'aria-label': 'Increase quantity' }, '+');
      var qtyEl = R.el('span', { class: 'mint-qty', role: 'status', 'aria-live': 'polite' }, String(qty));
      minus.disabled = busy || qty <= 1;
      plus.disabled = busy || qty >= state.cap;
      minus.addEventListener('click', function () { if (qty > 1) { qty--; paintMint(state); } });
      plus.addEventListener('click', function () { if (qty < state.cap) { qty++; paintMint(state); } });
      var stepper = R.el('div', { class: 'mint-stepper', role: 'group', 'aria-label': 'Quantity' }, [minus, qtyEl, plus]);

      var total = R.el('div', { class: 'rf-total' }, [R.el('span', {}, qty + ' × TYB'), R.el('span', {}, fmtEth(qty) + ' ETH')]);
      var mintBtn = R.el('button', { type: 'button', class: 'rf-btn' }, 'Mint ' + qty + ' for ' + fmtEth(qty) + ' ETH');
      mintBtn.disabled = busy;
      mintBtn.addEventListener('click', function () { doMint(state, qty); });

      setBody(R.el('div', {}, [
        R.el('div', { class: 'mint-head' }, [badge]),
        R.el('p', { class: 'rf-msg' }, sub),
        stepper, total, mintBtn,
        R.el('p', { class: 'rf-warn' }, 'You pay ' + fmtEth(qty) + ' ETH on Robinhood Chain. Minting is final — there is a separate refund window after minting closes.')
      ]));
    }

    function waitWithTimeout(tx) {
      return new Promise(function (resolve, reject) {
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; var e = new Error('pending'); e._pending = true; e._hash = tx && tx.hash; reject(e); } }, WAIT_TIMEOUT_MS);
        Promise.resolve(tx.wait()).then(
          function (r) { if (!done) { done = true; clearTimeout(t); resolve(r); } },
          function (err) { if (!done) { done = true; clearTimeout(t); reject(err); } });
      });
    }

    function callMint(state, n) {
      var q = BigInt(n);
      if (state.kind === 'gtd') return TYB.call.mintGtd(q, state.allowedQty, state.proof || []);
      if (state.kind === 'fcfs') return TYB.call.mintFcfs(q, state.proof || []);
      if (state.kind === 'public') return TYB.call.mintPublic(q);
      throw new Error('This phase is not mintable.');
    }

    function doMint(state, n) {
      if (busy) return;
      var myGen = gen; // latch: if the modal is closed/reopened mid-flow, every commit below no-ops
      busy = true; paintMint(state); // disable controls
      setBody(msg('Preparing…'));
      function superseded() { if (myGen !== gen) { var e = new Error('superseded'); e._superseded = true; throw e; } }
      Promise.resolve()
        // env-EXACT switch/gate (opus P2): isOnChain('robinhood', USE_TESTNET) matches ONLY the active
        // env's chainId, so a wallet on the wrong Robinhood env can't pass the gate un-switched.
        .then(function () { return S.isOnChain('robinhood', USE_TESTNET) ? null : S.switchToChain('robinhood', USE_TESTNET); })
        .then(function () {
          superseded();
          if (!S.isOnChain('robinhood', USE_TESTNET)) throw new Error('Please switch to Robinhood Chain to mint.');
          if (!S.snapshot().connected) throw new Error('Your wallet disconnected. Please reconnect and try again.');
          // RE-VALIDATE against fresh reads — phase/supply/allowance may have moved since the modal opened.
          return refetch(S.snapshot().account);
        })
        .then(function (fresh) {
          superseded(); // don't send the write if the user closed the modal during Preparing/re-validate
          if (fresh.kind !== state.kind) { var er = new Error('changed'); er._changed = true; throw er; }
          if (typeof fresh.cap === 'number' && n > fresh.cap) { var e2 = new Error('changed'); e2._changed = true; throw e2; }
          // ★ re-check the chain IMMEDIATELY before the write — the wallet's chain is shared, mutable
          // state (another tab/dapp can switch it). A mint sent on the wrong chain hits a no-code address,
          // returns status 1, and FORGES a "minted" success. Re-checked before EACH write, not once.
          if (!S.isOnChain('robinhood', USE_TESTNET)) throw new Error('Please switch to Robinhood Chain to mint.');
          if (!S.snapshot().connected) throw new Error('Your wallet disconnected. Please reconnect and try again.');
          setBody(msg('Confirm in your wallet…'));
          return callMint(fresh, n); // FRESH inputs (proof/allowedQty may have changed on re-read)
        })
        .then(function (tx) { setBody(msg('Minting… waiting for on-chain confirmation.')); return waitWithTimeout(tx); })
        .then(function (rec) {
          if (myGen !== gen) return; // superseded — the current generation owns the UI + busy
          busy = false;
          if (Number(rec.status) === 1) paintSuccess(n);
          else paintDone('The mint transaction reverted on-chain. Nothing was minted.', true);
        })
        .catch(function (e) {
          if (e && e._superseded) return; // benign: we bailed because the modal-session changed
          if (myGen !== gen) return;      // a real error, but on a stale generation — drop it
          busy = false;
          if (e && e._pending) { paintDone('Your mint is still pending — it may confirm shortly. Check your wallet or the block explorer' + (e._hash ? ' (tx ' + String(e._hash).slice(0, 10) + '…)' : '') + ' before retrying.'); return; }
          if (e && e._changed) { paintDone('The mint state changed (phase, supply, or your allowance). Please reopen the mint window.'); return; }
          // strict pre-write read failed (proxy down/rate-limited): we could NOT verify the state → never proceed, say so
          if (TYB.isReaderError && TYB.isReaderError(e)) { paintDone('Couldn’t verify the on-chain state right now. Nothing was sent — please try again in a moment.'); return; }
          paintDone(revertCopy(e), true);
        });
    }

    API.open = open;
  }

  win.TYB_MINT = Object.freeze(API);
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
