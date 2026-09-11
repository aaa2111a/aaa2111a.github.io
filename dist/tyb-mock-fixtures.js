/*
 * TYB — MOCK fixtures for the seam (tyb-chain.js MOCK impl).
 * ===========================================================================
 * `resolve(name, kind, argv, scenario, seamRevert)` returns already-SHAPED data
 * (BigInt for every Solidity integer — design contract #1) for reads, and either
 * a tx `{hash, wait()}` or `{__throw: <seamRevert>}` for writes.
 *
 * REVERT-DRIVEN (GO headline): `?scenario=` drives every reachable UI STATE and
 * every reachable custom-error REVERT, so the error UI is exercised BEFORE "front
 * complete" — never a success-only mock. The scenario list per fn below IS the
 * page×state matrix, made runnable. (scenario is null in real mode → happy path.)
 */
(function () {
  'use strict';

  var NOW = function () { return BigInt(Math.floor(Date.now() / 1000)); };
  var HASH = '0x' + 'cd'.repeat(32);

  // ethers v6: receipt.status is a NUMBER (1 success / 0 reverted), NOT a bigint — it is receipt
  // metadata, not an ABI-decoded integer, so it is the ONE numeric field exempt from the bigint rule
  // (lesson C1: status ∈ {1,'0x1',true}, never 1n). Call-sites check Number(status)===1.
  function tx(status) {
    return { hash: HASH, wait: function () {
      return Promise.resolve({ status: status == null ? 1 : status, hash: HASH });
    } };
  }
  // a contract CUSTOM-ERROR revert (surfaces at the write call). `args` carries error args (e.g. tokenId).
  function revert(seamRevert, name, args, reason) { return { __throw: seamRevert(name, args || [], reason) }; }
  // a WALLET/PROVIDER error — an ethers `code` with NO `.revert` (user rejects, wallet locked, …).
  // Call-sites branch on `err.code` here, NEVER `err.revert?.name`.
  function providerErr(code, reason) {
    var e = new Error(reason || code); e.code = code; e.reason = reason || code; return { __throw: e };
  }

  // per-fn READ fixtures. s = scenario string (or null).
  var READS = {
    getPhase: function (s) {
      var m = { 'phase-setup': 0n, 'phase-gtd': 1n, 'phase-fcfs': 2n, 'phase-public': 3n, 'phase-closed': 4n };
      return (s in m) ? m[s] : 1n; // default GTD
    },
    getSupply: function (s) {
      if (s === 'sold-out') return { totalSupply: 4444n, totalMintedEver: 4444n };
      return { totalSupply: 1200n, totalMintedEver: 1240n };
    },
    getNumberMinted: function (s) { return s === 'wallet-cap' ? 4n : (s === 'minted-some' ? 1n : 0n); },
    getGtdMinted: function (s) { return s === 'gtd-partial' ? 1n : 0n; }, // GTD allowance already consumed (gtdMinted[you])
    getMintPaused: function (s) { return s === 'mint-paused'; },
    getRefundState: function (s) {
      // function-latch model (no timestamps): openRefund() sets refundOpen, closeRefund() latches refundClosed.
      if (s === 'refund-not-open') return { refundOpen: false, refundClosed: false }; // mint closed, not opened yet
      if (s === 'refund-closed')  return { refundOpen: true,  refundClosed: true };  // window latched shut
      return { refundOpen: true, refundClosed: false }; // open
    },
    getMyMintedTokens: function (s) {
      if (s === 'empty') return [];
      var t = [
        { id: 12n, isOriginalMinter: true, owned: true },
        { id: 88n, isOriginalMinter: true, owned: true },
        { id: 130n, isOriginalMinter: false, owned: true } // bought secondhand → ineligible (NotMinter)
      ];
      if (s === 'refund-partial-race') t[0].owned = false; // sold between load and tx → will revert
      return t;
    },
    getInventory: function (s) {
      if (s === 'empty') return [];
      return [
        { id: 12n, levels: [0n, 1n, 2n, 0n, 1n], metaUrl: 'mock:/meta/12' },
        { id: 88n, levels: [2n, 2n, 0n, 0n, 0n], metaUrl: 'mock:/meta/88' }
      ];
    },
    getPowerUpBalances: function (s) {
      return s === 'no-powerups' ? [0n, 0n, 0n, 0n, 0n] : [3n, 0n, 1n, 2n, 0n];
    },
    getClaimablePowerUps: function (s) {
      // purchases whose IN-PLAY power-ups are claimable NOW (round winnerFinalized + seed revealed +
      // startNonce <= winningNonce + !claimed[round][idx]). Real mode (since 2026-09-08): composed ON-CHAIN in
      // tyb-chain.js from rounds() + purchaseCount/purchases + TYBPowerUp1155.claimed() over the recent rounds
      // (CLAIM_ROUND_SCAN_CAP); there is no single on-chain view, but no indexer is needed either.
      if (s === 'no-powerup-claims' || s === 'no-round' || s === 'empty') return [];
      return [
        { roundId: 6n, purchaseIndex: 0n, qty: 2n },
        { roundId: 6n, purchaseIndex: 1n, qty: 1n }
      ];
    },
    getCurrentRoundId: function (s) { return s === 'no-round' ? 0n : 7n; },
    getBuysPaused: function (s) { return s === 'buys-paused'; }, // TYBGacha.buysPaused (same scenario as the buyTickets revert)
    getRound: function (s, argv) {
      var raw = (argv[0] === '' || argv[0] == null) ? 7 : argv[0]; // BigInt('')===0n guard (fold #8)
      var id = BigInt(raw);
      var base = {
        id: id, ticketPrice: 150000000000000n, salesEnd: NOW() + 3600n, ticketCount: 42n,
        winnerFinalized: false, hasWinner: false, winningNonce: (2n ** 256n - 1n), livePot: 0n
      };
      var st = { 'round-none': 0n, 'round-salesclosed': 2n, 'round-resolved': 3n,
        'round-resolved-unfinalized': 3n, 'round-refunded': 4n };
      base.state = (s in st) ? st[s] : 1n; // default Open
      if (base.state === 0n) base.ticketCount = 0n;
      if (base.state >= 2n) base.salesEnd = NOW() - 7200n; // sales ended once SalesClosed/Resolved/Refunded
      // ONLY a Resolved round that has been FINALIZED carries a winner. forceRefund (→ Refunded, state 4)
      // never finalizes (TYBGacha.sol:570); a fresh Resolved round sits in its settle window (unfinalized).
      // These are distinct states — never infer a winner from state>=3.
      if (base.state === 3n && s !== 'round-resolved-unfinalized') {
        base.winnerFinalized = true; base.hasWinner = true; base.livePot = 500000000000000000n;
      }
      return base;
    },
    getWinningIds: function () { return [12n, 88n, 256n, 901n]; },
    getMyPurchases: function (s) {
      if (s === 'empty' || s === 'no-round') return [];
      return [
        { purchaseIndex: 0n, startNonce: 3n, qty: 2n, settled: false },
        { purchaseIndex: 1n, startNonce: 20n, qty: 1n, settled: false }
      ];
    },
    getTicketId: function (s, argv) { return 88n; }, // a live id; NEVER computed in JS — real reads the view
    getClaimable: function (s) { return s === 'nothing-claimable' ? 0n : 1650000000000000n; },
    getAttempts: function (s, argv) {
      var rawCat = (argv[1] === '' || argv[1] == null) ? 0 : argv[1]; // BigInt('')===0n guard (fold #8)
      var cat = BigInt(rawCat);
      if (s === 'attempt-pending') return { pending: true, attemptId: 5n, roundResolved: false, canCancel: false };
      if (s === 'attempt-resolvable') return { pending: true, attemptId: 5n, roundResolved: true, canCancel: false };
      if (s === 'attempt-cancelable') return { pending: true, attemptId: 5n, roundResolved: false, canCancel: true };
      return { pending: false, attemptId: 0n, roundResolved: false, canCancel: false };
    },
    getInstantIds: function (s) { return s === 'no-round' ? [] : [88n, 300n]; },
    getFrogHeads: function (s) {
      if (s === 'no-frogs') return [];
      return [{ id: 101n }, { id: 202n }, { id: 303n }, { id: 404n }, { id: 505n }];
    },
    // ownerOf(selected ids) sweep → the subset of the passed ids STILL owned (shape-compatible with getFrogHeads).
    // argv[0] = ids, argv[1] = account. 'frog-moved' drops one to exercise burn.js's dropped-selection guard.
    getFrogOwners: function (s, argv) {
      var ids = (argv && argv[0]) || [];
      var owned = ids.map(function (x) { return { id: BigInt(x) }; });
      return s === 'frog-moved' ? owned.slice(1) : owned;
    },
    getFrogApproval: function (s) { return s === 'approved'; }, // isApprovedForAll(you, helper): default false

    // FRHD totalSupply() as a bigint (connect-free burn counter: burned = burnBaselineSupply − this). Baseline
    // is 6054 in the config → default 5804 = 250 burned (25% bar). Edge scenarios exercise the clamps.
    getFrhdTotalSupply: function (s) {
      if (s === 'burns-none') return 6054n; // == baseline → 0 burned (bar empty)
      if (s === 'burns-full') return 5000n; // baseline − 5000 = 1054 ≥ goal(1000) → clamp 100%
      if (s === 'burns-over') return 6056n; // > baseline → burned would be negative → clamp to 0
      return 5804n;                          // default: 250 burned
    },

    getGtdEligibility: function (s) {
      // definitive:true mirrors the real gtd-proofs.json path (per-wallet qty known) → the banner shows the count.
      if (s === 'gtd-not-on-list') return { onList: false, allowedQty: 0n, proof: [], definitive: true };
      return { onList: true, allowedQty: 2n, proof: ['0x' + '11'.repeat(32)], definitive: true };
    },
    getFcfsEligibility: function (s) {
      if (s === 'fcfs-not-on-list') return { onList: false, proof: [] };
      return { onList: true, proof: ['0x' + '22'.repeat(32)] };
    }
  };

  // per-fn WRITE fixtures → scenario → custom-error name (from the real contracts).
  var WRITE_ERRORS = {
    refund: {
      'refund-closed': 'RefundWindowClosed', 'not-minter': 'NotMinter', 'not-owner': 'NotOwner',
      'refund-partial-race': 'OwnerQueryForNonexistentToken', 'send-failed': 'RefundTransferFailed'
    },
    mintGtd: {
      'bad-proof': 'BadProof', 'gtd-allowance': 'GtdAllowanceExceeded', 'wallet-cap': 'WalletCapExceeded',
      'sold-out': 'SoldOut', 'bad-qty': 'BadQuantity', 'wrong-value': 'WrongValue',
      'wrong-phase': 'WrongPhase', 'mint-paused': 'MintPausedErr'
    },
    mintFcfs: {
      'bad-proof': 'BadProof', 'wallet-cap': 'WalletCapExceeded', 'sold-out': 'SoldOut',
      'bad-qty': 'BadQuantity', 'wrong-value': 'WrongValue', 'wrong-phase': 'WrongPhase', 'mint-paused': 'MintPausedErr'
    },
    mintPublic: {
      'wallet-cap': 'WalletCapExceeded', 'sold-out': 'SoldOut', 'bad-qty': 'BadQuantity',
      'wrong-value': 'WrongValue', 'wrong-phase': 'WrongPhase', 'mint-paused': 'MintPausedErr'
    },
    buyTickets: {
      'over-cap': 'BadQuantity', 'feistel-cap': 'BadQuantity', 'wrong-value': 'WrongValue',
      'sales-over': 'SalesOver', 'buys-paused': 'BuysPausedErr', 'wrong-state': 'WrongState'
    },
    withdraw: { 'nothing': 'NothingToDo', 'send-failed': 'SendFailed' },
    refundTicket: { 'not-buyer': 'NotBuyer', 'already': 'AlreadyDone', 'wrong-state': 'WrongState' },
    claimPowerUps: {
      'not-finalized': 'RoundNotFinalized', 'not-in-play': 'NotInPlay',
      'already': 'AlreadyClaimed', 'empty': 'EmptyPurchase'
    },
    commitAttempt: {
      'not-owner': 'NotOwner', 'bad-category': 'BadCategory', 'max-level': 'MaxLevel',
      'already-pending': 'AlreadyPending', 'insufficient-powerups': 'ERC1155InsufficientBalance'
    },
    resolveAttempt: { 'round-not-resolved': 'RoundNotResolved', 'unknown-attempt': 'UnknownAttempt', 'already': 'AlreadySettled' },
    cancelAttempt: { 'round-resolved': 'RoundAlreadyResolved', 'too-early': 'TooEarlyToCancel', 'already': 'AlreadySettled', 'unknown-attempt': 'UnknownAttempt' },
    // Frog Heads burn (ETH). Real burner errors: BadBatchSize (len 0 or >MAX_BATCH=2), NotYourToken(id).
    // Skipping the setApprovalForAll propagates FRHD's ERC721A TransferCallerNotOwnerNorApproved.
    // user-rejected is a PROVIDER error (handled in resolve, not a contract custom-error).
    frogApproveBurner: {},
    frogBurnMany: { 'bad-batch': 'BadBatchSize', 'not-your-token': 'NotYourToken', 'not-approved': 'TransferCallerNotOwnerNorApproved' }
  };

  function resolve(name, kind, argv, s, seamRevert) {
    if (kind === 'read') {
      var r = READS[name];
      return r ? r(s, argv) : (function () { throw new Error('mock: no read fixture for ' + name); })();
    }
    // write
    if (s === 'user-rejected') return providerErr('ACTION_REJECTED', 'user rejected the request in the wallet');
    if (s === 'mined-revert') return tx(0); // gas-estimate passed, mined but reverted (status 0)
    var map = WRITE_ERRORS[name] || {};
    if (s && (s in map)) {
      var errName = map[s];
      // NotYourToken(tokenId) is the one arg-bearing error — pass the first id from the ids array.
      var args = errName === 'NotYourToken'
        ? [BigInt((argv[0] && argv[0][0] != null) ? argv[0][0] : 0)]
        : [];
      return revert(seamRevert, errName, args, null);
    }
    return tx(1); // happy path
  }

  window.TYB_FIXTURES = Object.freeze({ resolve: resolve });
})();
