/*
 * TYB — burn.html page controller (chunk 4; the GTD Frog-Heads burn, on Ethereum).
 * ===========================================================================
 * SEPARATION invariant (Le): Frog Heads live ONLY here — never in the TYB inventory.
 * Reads/writes are on ETHEREUM (the FRHD collection); the switch is lazy on the burn
 * action. Flow: FRHD.setApprovalForAll(helper) once (reversible) → FrogHeadBulkBurner
 * .burnMany(ids ≤ MAX_BATCH=2) (IRREVERSIBLE — warned). Each burned Frog = one GTD
 * allowlist spot for the TYB mint. Mirrors refund.js's proven shell: busy-guard
 * anti-repaint, re-validate-before-tx, wait-timeout→pending, XSS-safe DOM, keyboard a11y.
 * Reuses the shared .sub-card / .rf-* list+footer styles from chunk 3.
 */
(function () {
  'use strict';
  var TYB = window.TYB, S = window.TYB_SESSION, R = window.TYB_RENDER, CFG = window.TYB_ONCHAIN;
  if (!TYB || !S || !R || !CFG) { return; }
  var F = CFG.frogHeads;
  var MAX = (typeof F.maxBatch === 'number' && F.maxBatch > 0) ? F.maxBatch : 2; // FrogHeadBulkBurner.MAX_BATCH=2 (>MAX reverts BadBatchSize; guard the 0/kill-switch footgun)
  var WAIT_TIMEOUT_MS = 120000;

  var sel = new Set();
  var frogs = [];        // [{id:bigint}]
  var approved = false;  // isApprovedForAll(you, helper) at load
  var gtd = null;        // { onList, allowedQty }
  var busy = false;
  var countReached = false; // UI-only soft cutoff: the connect-free counter saw burned ≥ burnGoal at load → close
                            // burning ON THE PAGE (bypassable by a direct contract call — Le accepts; most burn here).
                            // Stays false if the count read fails (fail-open: never block an irreversible action on a
                            // cosmetic read that hiccuped; the real GTD cutoff is the snapshot, not this counter).
  var heldAcct = null;   // account whose "✓ burned" confirmation is showing — holds it against an INCIDENTAL
                         // same-account tyb:session echo; yields (refreshes) on a real account switch / disconnect
                         // so we never show stale state (arm-3c: scoped to Back / a real change, NOT indefinite).

  var elStatus = document.getElementById('bn-status');
  var elBody = document.getElementById('bn-body');
  var elFoot = document.getElementById('bn-foot');
  var elCount = document.getElementById('bn-burncount');
  var LC = CFG.launch || {};

  function msg(text, cls) { return R.el('p', { class: 'rf-msg' + (cls ? ' ' + cls : '') }, text); }
  function setBody(node) { R.mount(elBody, node); }
  function box(text, btnLabel, onClick) {
    var b = R.el('button', { type: 'button', class: 'rf-btn' }, btnLabel || 'Back to Frog Heads');
    b.addEventListener('click', onClick || refresh);
    return R.el('div', {}, [msg(text), b]);
  }

  // Vertical numbered progress stepper (Le UX: ① Approve the burn contract → ② Accept the burn). `steps` = label
  // strings; `active` = current step index (0-based): earlier steps render DONE (✓), the active one highlighted,
  // later ones pending. Presentation only — it reflects the flow's REAL phase (approve vs burn), never gates it.
  function stepUI(steps, active) {
    var rows = steps.map(function (label, i) {
      var st = i < active ? 'done' : (i === active ? 'active' : 'pending');
      var num = R.el('span', { class: 'bn-step__num', 'aria-hidden': 'true' }, st === 'done' ? '✓' : String(i + 1));
      var attrs = { class: 'bn-step is-' + st, role: 'listitem' };
      if (st === 'active') attrs['aria-current'] = 'step';
      return R.el('div', attrs, [num, R.el('span', { class: 'bn-step__label' }, label)]);
    });
    return R.el('div', { class: 'bn-steps', role: 'list', 'aria-label': 'Burn progress' }, rows);
  }
  function stepBody(steps, active, text) { setBody(R.el('div', {}, [stepUI(steps, active), msg(text)])); }

  // Success indicator: a big green circular checkmark (Le UX — replaces the "Back to Frog Heads" button on a
  // SUCCESSFUL burn only). Clickable → back to the frog list. Error/revert paths keep the text button (a green
  // check on a failure would lie).
  function burnedBox(text, onBack) {
    var check = R.el('button', { type: 'button', class: 'bn-done', 'aria-label': 'Done — back to your Frog Heads' }, '✓');
    check.addEventListener('click', onBack || refresh);
    return R.el('div', { class: 'bn-done-wrap' }, [check, msg(text)]);
  }

  function renderStatus() {
    R.clear(elStatus);
    if (!gtd) return;
    if (gtd.onList) {
      // Only show a hard spot COUNT when the source is DEFINITIVE (the real gtd-proofs.json, on burn day).
      // The pre-burn check-list.json snapshot has no per-wallet qty → show "on the allowlist" rather than a
      // placeholder "1 spot" a 2-spot wallet would misread as its cap (GO fold: opus P3-b). The mint modal
      // enforces the real allowance; each burn = one spot, shown in the burn flow itself.
      var label = gtd.definitive
        ? ('GTD ✓ · ' + gtd.allowedQty.toString() + ' spot' + (gtd.allowedQty === 1n ? '' : 's'))
        : 'GTD ✓ · on the allowlist';
      elStatus.appendChild(R.el('span', { class: 'rf-status rf-status--open' }, label));
    } else {
      elStatus.appendChild(R.el('span', { class: 'rf-status rf-status--closed' }, 'Not on the GTD list yet'));
    }
  }

  // UI-only cutoff: burning is closed on the page once the counter saw the goal reached (Le 2026-09-10). The
  // header bar stays full (1000/1000); the body says closed and the footer/Burn button is gone. NOT enforced
  // on-chain (the helper is ownerless, no cap) — a direct contract call still works; that's accepted.
  function renderCountClosed() {
    elFoot.hidden = true;
    R.clear(elStatus);
    var goal = (LC && typeof LC.burnGoal === 'number') ? LC.burnGoal.toLocaleString() : '1,000';
    setBody(msg('The ' + goal + '-burn goal has been reached — burning is closed on this page. Thanks to everyone who burned for GTD.'));
  }

  function backFromDone() { heldAcct = null; refresh(); }
  function refresh() {
    if (busy) return; // never repaint over an in-flight burn
    if (countReached) { renderCountClosed(); return; } // goal reached → burning closed on the page (fail-open if unknown)
    var snap = S.snapshot();
    if (heldAcct !== null && snap.connected && snap.account === heldAcct) return; // hold the ✓ confirmation for the same connected account
    heldAcct = null;
    elFoot.hidden = true;
    if (!snap.connected) { R.clear(elStatus); setBody(connectPrompt()); return; }
    setBody(msg('Loading your Frog Heads…'));
    // getFrogHeads is CRITICAL (no frog list → cannot burn) → its rejection surfaces the error box. The GTD
    // banner (getGtdEligibility, the swappable check-list.json snapshot) is COSMETIC → decoupled with a
    // .catch(→null) so a missing/broken list never kills the burn page (renderStatus no-ops on gtd===null).
    // getFrogApproval never rejects (returns false off-ETH). (lesson: a cosmetic read in the same Promise.all
    // as a critical read kills the page the first time its state is reachable.)
    Promise.all([TYB.call.getFrogHeads(snap.account), TYB.call.getFrogApproval(snap.account), TYB.call.getGtdEligibility(snap.account).catch(function () { return null; })])
      .then(function (res) { frogs = res[0] || []; approved = !!res[1]; gtd = res[2]; renderStatus(); renderFrogs(); })
      .catch(function (e) { setBody(box('Could not load your Frog Heads. ' + ((e && e.message) || ''), 'Retry', refresh)); });
  }

  function connectPrompt() {
    var b = R.el('button', { type: 'button', class: 'rf-btn', dataset: { action: 'connect' } }, 'Connect wallet');
    return R.el('div', { class: 'rf-connect' }, [msg('Connect your wallet to see your Frog Heads and burn them for GTD.'), b]);
  }

  function frogRow(fr) {
    var k = fr.id.toString();
    var row = R.el('div', { class: 'rf-token', role: 'checkbox', 'aria-checked': 'false', tabindex: '0', 'aria-label': 'Frog Head #' + k }, [
      R.el('span', { class: 'rf-check' }, ''),
      R.el('span', { class: 'rf-token__id' }, '#' + k)
    ]);
    var toggle = function () {
      if (sel.has(k)) { sel.delete(k); row.classList.remove('is-sel'); row.setAttribute('aria-checked', 'false'); }
      else {
        if (sel.size >= MAX) return; // cap at MAX_BATCH per burn (>MAX reverts BadBatchSize)
        sel.add(k); row.classList.add('is-sel'); row.setAttribute('aria-checked', 'true');
      }
      renderFoot();
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    return row;
  }

  function renderFrogs() {
    sel.clear();
    if (frogs.length === 0) {
      elFoot.hidden = true;
      setBody(msg('You have no Frog Heads to burn. (Frog Heads live on Ethereum — this is the only place they appear.)'));
      return;
    }
    setBody(R.el('div', {}, frogs.map(frogRow)));
    renderFoot();
  }

  function renderFoot() {
    elFoot.hidden = false;
    var n = sel.size;
    var atCap = n >= MAX;
    var btn = R.el('button', { type: 'button', class: 'rf-btn' }, n ? ('Burn ' + n + ' Frog Head' + (n > 1 ? 's' : '')) : 'Select Frog Heads to burn');
    btn.disabled = (n === 0 || busy);
    btn.addEventListener('click', doBurn);
    R.mount(elFoot, [
      R.el('p', { class: 'rf-warn' }, '⚠ Burning is PERMANENT — the Frog Head is destroyed. Up to ' + MAX + ' per burn' + (atCap ? ' (max reached)' : '') + '. Each burn = one GTD spot.'),
      R.el('div', { class: 'rf-total' }, [R.el('span', {}, n + ' selected'), R.el('span', {}, n + ' GTD spot' + (n === 1 ? '' : 's'))]),
      btn
    ]);
  }

  function revertCopy(e) {
    if (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) return 'You cancelled the request in your wallet.';
    if (e && e.receipt && Number(e.receipt.status) === 0) return 'The transaction reverted on-chain. Nothing was burned.';
    var name = e && e.revert && e.revert.name;
    var m = {
      BadBatchSize: 'You can burn between 1 and ' + MAX + ' Frog Heads per transaction.',
      NotYourToken: 'One of these Frog Heads is no longer yours.',
      TransferCallerNotOwnerNorApproved: 'The burner is not approved yet — approve it and try again.'
    };
    if (m[name]) return m[name];
    if (e && e.message && !name && !e.code) {
      if (/^timeout:/i.test(e.message)) return 'The wallet took too long to respond. Please try again.'; // internal _withTimeout label, not for users
      return e.message;
    }
    return 'The burn could not be completed. Please try again.';
  }

  function waitWithTimeout(tx, stage) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; var e = new Error('pending'); e._pending = true; e._stage = stage; e._hash = tx && tx.hash; reject(e); } }, WAIT_TIMEOUT_MS);
      Promise.resolve(tx.wait()).then(
        function (r) { if (!done) { done = true; clearTimeout(t); resolve(r); } },
        function (err) { if (!done) { done = true; clearTimeout(t); reject(err); } });
    });
  }

  function doBurn() {
    if (busy || sel.size === 0) return;
    if (countReached) { renderCountClosed(); return; } // belt: never start a burn once the UI cutoff is on
    heldAcct = null; // a new action supersedes any held confirmation
    busy = true; renderFoot();
    var ids = Array.from(sel).map(function (s) { return BigInt(s); });
    var steps = null, burnIdx = 0; // the progress stepper's labels + which index the burn write is (set after the approval re-read)
    setBody(msg('Preparing…'));
    Promise.resolve()
      .then(function () { return S.isOnChain('ethereum') ? null : S.switchToChain('ethereum'); })
      .then(function () {
        if (!S.isOnChain('ethereum')) throw new Error('Please switch to Ethereum to burn your Frog Heads.');
        if (!S.snapshot().connected) throw new Error('Your wallet disconnected. Please reconnect and try again.');
        // RE-VALIDATE the SELECTED ids are still held via ownerOf on the live chain (getFrogOwners = the Worker
        // /rpc ownerOf sweep, NOT the lagging enum), and re-read approval.
        return Promise.all([TYB.call.getFrogOwners(ids, S.snapshot().account), TYB.call.getFrogApproval(S.snapshot().account)]);
      })
      .then(function (res) {
        var held = new Set((res[0] || []).map(function (fr) { return fr.id.toString(); }));
        var dropped = ids.filter(function (id) { return !held.has(id.toString()); });
        if (dropped.length) { var err = new Error('selection changed'); err._dropped = true; throw err; }
        approved = !!res[1];
        // 2-step stepper when an approval is needed (① approve the burn contract → ② accept the burn tx); a
        // single step ("Accept the burn") when the burner is already approved. Set here, once we know.
        steps = approved ? ['Accept the burn'] : ['Approve the burn contract', 'Accept the burn'];
        burnIdx = approved ? 0 : 1;
        if (approved) return null;
        // ★ re-check the chain IMMEDIATELY before the APPROVE write too — the getFrogOwners/getFrogApproval
        // read above is a network round-trip during which the wallet's shared, mutable chain can flip (another
        // tab/dapp). Without this a setApprovalForAll lands on a no-code address (status 1) and the flow proceeds
        // as "approved". Bounded (the burn gate below still catches it, and an unapproved burnMany reverts) but
        // wrong — the gate goes before EACH write, never a network read between the gate and the send. (GO fold: sonnet P2)
        if (!S.isOnChain('ethereum')) throw new Error('Please switch to Ethereum to burn your Frog Heads.');
        // one-time approval (reversible) before the irreversible burn.
        stepBody(steps, 0, 'Approve the burn contract in your wallet — a one-time, reversible approval that lets the burner move your Frog Heads (collection-wide, the standard for batch burns). Only the ' + ids.length + ' you selected will be burned.');
        return TYB.call.frogApproveBurner().then(function (tx) { return waitWithTimeout(tx, 'approve'); }).then(function (rec) {
          if (Number(rec.status) !== 1) { var er = new Error('approve-failed'); er.receipt = rec; throw er; }
        });
      })
      .then(function () {
        // ★ re-check the chain after the up-to-120s APPROVE wait — the wallet's chain is shared, mutable state
        // (another tab/dapp can switch it during that window). This gate covers the approve wait; the FINAL gate
        // (below, right before frogBurnMany) covers the getFrogOwners re-read window. A burnMany on the wrong
        // chain hits a no-code address, returns status 1, and FORGES a "✓ burned / GTD earned" — gate before EACH write.
        if (!S.isOnChain('ethereum')) throw new Error('Please switch to Ethereum to burn your Frog Heads.');
        if (!S.snapshot().connected) throw new Error('Your wallet disconnected. Please reconnect and try again.');
        // ★ RE-READ ownerOf of the SELECTED ids right before the burn, too: the approve step can wait up to
        // 120s, and a Frog can move out of the wallet during that window (the earlier re-validate is stale by
        // now). getFrogOwners = the live-chain ownerOf sweep (never the lagging enum). This NARROWS the TOCTOU —
        // it does not close it (a sub-second pre-broadcast gap remains; the on-chain NotYourToken revert is the
        // real backstop). P1-B, audit 2026-09-04.
        return TYB.call.getFrogOwners(ids, S.snapshot().account);
      })
      .then(function (heldFrogs) {
        var held = new Set((heldFrogs || []).map(function (fr) { return fr.id.toString(); }));
        var dropped = ids.filter(function (id) { return !held.has(id.toString()); });
        if (dropped.length) { var err = new Error('selection changed'); err._dropped = true; throw err; }
        // ★ FINAL chain re-check IMMEDIATELY before the irreversible burn — getFrogOwners above is a Worker
        // round-trip (chain-INDEPENDENT, so it would NOT catch a wallet chain flip); NO network read may sit
        // between the last chain gate and the send, or a burnMany on the wrong chain forges a "✓ burned"
        // that never happened (no-code address → status 1). (GO fold: fable P1 / opus P3-a)
        if (!S.isOnChain('ethereum')) throw new Error('Please switch to Ethereum to burn your Frog Heads.');
        if (!S.snapshot().connected) throw new Error('Your wallet disconnected. Please reconnect and try again.');
        stepBody(steps, burnIdx, 'Accept the burn in your wallet — this is the irreversible step.');
        return TYB.call.frogBurnMany(ids);
      })
      .then(function (tx) { stepBody(steps, burnIdx, 'Burning… waiting for on-chain confirmation.'); return waitWithTimeout(tx, 'burn'); })
      .then(function (rec) {
        busy = false; elFoot.hidden = true;
        if (Number(rec.status) === 1) {
          sel.clear();
          // The "NOT ON THE GTD LIST YET" status tag would now contradict the ✓ — drop it (the green check +
          // the GTD-READY badge below communicate the earned spot; the check-list.json snapshot doesn't know
          // about this just-made burn, so we can't honestly flip it to "GTD ✓" — we just remove it). (Le UX)
          R.clear(elStatus); gtd = null;
          heldAcct = S.snapshot().account; // hold this confirmation against an incidental same-account session echo
          setBody(burnedBox('Burned ' + ids.length + ' Frog Head' + (ids.length > 1 ? 's' : '') + ' — counted toward your GTD allowlist for the TYB mint (' + ids.length + ' spot' + (ids.length === 1 ? '' : 's') + '). You must mint during the GTD phase to use your spots — they are not held for later phases.', backFromDone));
          // Burning earns GTD → replace the checker input below with the downloadable OG "GTD READY OG" badge for this wallet.
          try { if (window.TYB_CHECK && window.TYB_CHECK.showBadge) window.TYB_CHECK.showBadge(S.snapshot().account, 'GTD_OG'); } catch (_) {}
        } else {
          setBody(box('The burn reverted on-chain. Nothing was burned.', 'Back to Frog Heads', refresh));
        }
      })
      .catch(function (e) {
        busy = false; elFoot.hidden = true;
        if (e && e._pending) { var what = e._stage === 'approve' ? 'approval' : 'burn'; setBody(box('Your ' + what + ' is still pending — it may confirm shortly. Check your wallet or Etherscan' + (e._hash ? ' (tx ' + String(e._hash).slice(0, 10) + '…)' : '') + ' before retrying.', 'Back to Frog Heads', refresh)); return; }
        if (e && e._dropped) { setBody(box('Your selection changed (a Frog Head moved out of your wallet). Please reload and re-select.', 'Back to Frog Heads', refresh)); return; }
        setBody(box(revertCopy(e), 'Back to Frog Heads', refresh));
      });
  }

  // ── Campaign burn counter (CONNECT-FREE, NO bot). ─────────────────────────────────────────────────────
  // Pure: burned = baseline − live totalSupply, clamped ≥ 0; bar % clamped 0..100. baseline may be number or
  // bigint, total is a bigint from the seam. Exposed for a unit test; the render below is the only caller.
  function computeBurnBar(baseline, goal, total) {
    var base = BigInt(baseline), tot = BigInt(total);
    var b = base - tot; if (b < 0n) b = 0n;                 // defensive: totalSupply can only drop from a burn-only baseline
    var burned = Number(b), g = Number(goal);
    var pct = g > 0 ? Math.max(0, Math.min(100, Math.round((burned / g) * 100))) : 0;
    return { burned: burned, goal: g, pct: pct, text: burned.toLocaleString() + ' / ' + g.toLocaleString() + ' burned' };
  }
  function renderBurnCount(total) {
    if (!elCount) return;
    var base = LC.burnBaselineSupply, goal = LC.burnGoal;
    if (typeof base !== 'number' || typeof goal !== 'number' || goal <= 0) return; // misconfigured → stay hidden
    // PLAUSIBILITY gate (fable P2, 2026-09-10): a valid-SHAPE but wrong-DATA read (e.g. 0n from a wrong-chain /
    // empty-state node / proxy bug) would give burned = baseline − 0 ≥ goal and FALSELY close burning for
    // everyone — a fail-CLOSED bug. A real FRHD totalSupply is 0 < tot ≤ baseline (burns only DECREASE it from
    // the snapshot baseline). Outside that range → treat as UNKNOWN: leave the bar hidden, countReached stays
    // false (preserves the fail-OPEN intent). Note: an in-range bogus value is indistinguishable and accepted.
    var tot = BigInt(total);
    if (!(tot > 0n && tot <= BigInt(base))) return;
    var r = computeBurnBar(base, goal, tot);
    var fill = R.el('div', { class: 'burn-count__fill', style: 'width:' + r.pct + '%' });
    var track = R.el('div', {
      class: 'burn-count__track', role: 'progressbar',
      'aria-valuemin': '0', 'aria-valuemax': String(r.goal), 'aria-valuenow': String(Math.min(r.burned, r.goal)),
      'aria-label': r.text
    }, [fill]);
    R.mount(elCount, [R.el('div', { class: 'burn-count__label' }, r.text), track]);
    elCount.hidden = false;
    // UI-only cutoff (Le 2026-09-10): burned ≥ goal → close burning on the page. Don't clobber an in-flight
    // burn (busy) — the flag still blocks the NEXT action via refresh()/doBurn.
    if (r.burned >= r.goal) { countReached = true; if (!busy) renderCountClosed(); }
  }
  // Decoupled from refresh()/connect: the counter is COSMETIC. A Worker hiccup, a missing seam, or a bad shape
  // → the bar simply stays hidden (never blocks or errors the burn page). Runs once on load regardless of wallet.
  function initBurnCount() {
    if (!elCount || !TYB || !TYB.call || typeof TYB.call.getFrhdTotalSupply !== 'function') return;
    Promise.resolve().then(function () { return TYB.call.getFrhdTotalSupply(); })
      .then(function (total) { if (typeof total === 'bigint') renderBurnCount(total); })
      .catch(function () { /* cosmetic — leave the bar hidden */ });
  }

  window.addEventListener('tyb:session', refresh);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
  initBurnCount();

  // test-only surface (the pure compute + a re-init hook for the cutoff test); no browser effect beyond a frozen global.
  try { window.TYB_BURNCOUNT = Object.freeze({ compute: computeBurnBar, _init: initBurnCount }); } catch (_) {}
})();
