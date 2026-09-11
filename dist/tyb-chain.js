/*
 * TYB — the CHAIN SEAM (the one file that differs mock vs live).
 * ===========================================================================
 * Everything the front knows about the chain crosses THIS boundary. Two impls
 * behind one identical surface, selected by TYB_ONCHAIN.SEAM_MODE:
 *   - MOCK                : serves deterministic fixtures; honours ?scenario= (page suites run here).
 *   - REAL  (LIVE since 2026-09-07, B3-1 reads + B3-2 writes): ethers v6 — READER (proxy→public
 *                           ladder, TYB.strict proxy-only) + WRITES via the wallet. Design + GOs:
 *                           Code/tyb-front-B3-DESIGN-2026-09-07/. 7 seams stay deferred (CFG.deferredFns;
 *                           getClaimablePowerUps was wired ON-CHAIN 2026-09-08 — rehearsal 3 S5 fix).
 *
 * DESIGN CONTRACTS (from the divergent-design triple GO, 2026-09-02):
 *  1. BigInt discipline — every Solidity integer (uint8 enum, uint64 ts, uint256
 *     wei/id) is a `bigint` here, mock AND real. `state===3n`, never `state===3`.
 *  2. Revert shape — a write's custom-error revert surfaces at the WRITE CALL
 *     (ethers rejects at gas-estimate, before send). Both impls throw the SAME
 *     shape: { code:'CALL_EXCEPTION', revert:{ name, args }, reason }. Call-sites
 *     branch on `err.revert?.name` — code that never changes at wiring.
 *  3. LIVE_FNS — a fn is "live" ONLY when its contract address is set AND its
 *     read-provider chainId matches its chain. In real mode an UN-WIRED WRITE
 *     THROWS (fail-closed), never simulates success. liveStatus() drives the
 *     "N/M live" watermark so a partial wiring can never silently ship half-real
 *     data. Reads AND writes are tracked; per-chain (a Frog read is live only
 *     against ETH, a TYB read only against Robinhood).
 *  4. ?scenario= is INERT when SEAM_MODE==='real' (anti screenshot-scam).
 *  5. The Feistel `ticketId` is NEVER reimplemented in JS — read via the view.
 *
 * SEAM_SPEC below is the machine-checkable manifest (chain · kind · ABI method).
 * `tyb-seam-parity.test.mjs` diffs it against `forge inspect` so the real body
 * can't drift from the ABI. Exposed as frozen `window.TYB` (classic script).
 */
(function () {
  'use strict';

  var CFG = window.TYB_ONCHAIN;
  var FIX = window.TYB_FIXTURES; // tyb-mock-fixtures.js
  if (!CFG) throw new Error('tyb-chain: onchain-config.js must load first');

  var MODE = CFG.SEAM_MODE; // 'mock' | 'real'

  // ── SEAM_SPEC: the canonical surface. name → { chain, kind, method }.
  //    chain: 'robinhood' | 'ethereum'. kind: 'read' | 'write'.
  //    method: the contract fn the real impl maps to (or 'offchain:<svc>').
  var SEAM_SPEC = Object.freeze({
    // reads — Robinhood / TYB
    getPhase:            { chain: 'robinhood', kind: 'read',  method: 'TYB721.phase' },
    getSupply:           { chain: 'robinhood', kind: 'read',  method: 'TYB721.totalSupply+TYB721.totalMintedEver' },
    getNumberMinted:     { chain: 'robinhood', kind: 'read',  method: 'TYB721.numberMinted' },
    getGtdMinted:        { chain: 'robinhood', kind: 'read',  method: 'TYB721.gtdMinted' },
    getMintPaused:       { chain: 'robinhood', kind: 'read',  method: 'TYB721.mintPaused' },
    getRefundState:      { chain: 'robinhood', kind: 'read',  method: 'TYB721.refundOpen+TYB721.refundClosed' },
    getMyMintedTokens:   { chain: 'robinhood', kind: 'read',  method: 'TYB721.tokensOfOwner+TYB721.originalMinter' },
    getInventory:        { chain: 'robinhood', kind: 'read',  method: 'TYB721.tokensOfOwner+TYBEvolution.levelsOf' },
    getPowerUpBalances:  { chain: 'robinhood', kind: 'read',  method: 'TYBPowerUp1155.balanceOf' },
    getClaimablePowerUps:{ chain: 'robinhood', kind: 'read',  method: 'TYBGacha.currentRoundId+TYBGacha.rounds+TYBGacha.purchaseCount+TYBGacha.purchases+TYBPowerUp1155.claimed' },
    getCurrentRoundId:   { chain: 'robinhood', kind: 'read',  method: 'TYBGacha.currentRoundId' },
    getRound:            { chain: 'robinhood', kind: 'read',  method: 'TYBGacha.rounds' },
    getBuysPaused:       { chain: 'robinhood', kind: 'read',  method: 'TYBGacha.buysPaused' },
    getWinningIds:       { chain: 'robinhood', kind: 'read',  method: 'TYBGacha.winningIdsOf' },
    getMyPurchases:      { chain: 'robinhood', kind: 'read',  method: 'TYBGacha.purchaseCount+TYBGacha.purchases' },
    getTicketId:         { chain: 'robinhood', kind: 'read',  method: 'TYBGacha.ticketId' },
    getClaimable:        { chain: 'robinhood', kind: 'read',  method: 'TYBGacha.claimable' },
    getAttempts:         { chain: 'robinhood', kind: 'read',  method: 'TYBEvolution.nextAttemptId+TYBEvolution.attempts+TYBGacha.rounds+TYBEvolution.CANCEL_DEADLINE' },
    getInstantIds:       { chain: 'robinhood', kind: 'read',  method: 'offchain:instant-id-display' },
    // reads — Ethereum / Frog Heads (burn/GTD page only). FRHD is base ERC721A (NO tokensOfOwner), so there is
    // NO ethers ETH reader: getFrogHeads = the holder's ids via the key-hiding enum Worker (paginated, LAGS a
    // fresh burn → a DISPLAY list); getFrogOwners = ownerOf(selected ids) via the Worker /rpc = the FRESH
    // pre-burn re-read (lesson: verify the SELECTED ids on the live chain, never a lagging enumeration).
    getFrogHeads:        { chain: 'ethereum',  kind: 'read',  method: 'offchain:frhd-enum-worker' },
    getFrogOwners:       { chain: 'ethereum',  kind: 'read',  method: 'offchain:frhd-ownerof-sweep' },
    getFrogApproval:     { chain: 'ethereum',  kind: 'read',  method: 'FRHD.isApprovedForAll' },
    getGtdEligibility:   { chain: 'ethereum',  kind: 'read',  method: 'offchain:gtd-allowlist' },
    getFcfsEligibility:  { chain: 'ethereum',  kind: 'read',  method: 'offchain:fcfs-allowlist' },
    // CONNECT-FREE burn counter: FRHD.totalSupply() via the enum Worker /rpc (no wallet). burned = baseline − live.
    getFrhdTotalSupply:  { chain: 'ethereum',  kind: 'read',  method: 'offchain:frhd-totalsupply' },
    // writes — Robinhood / TYB
    mintGtd:             { chain: 'robinhood', kind: 'write', method: 'TYB721.mintGtd' },
    mintFcfs:            { chain: 'robinhood', kind: 'write', method: 'TYB721.mintFcfs' },
    mintPublic:          { chain: 'robinhood', kind: 'write', method: 'TYB721.mintPublic' },
    refund:              { chain: 'robinhood', kind: 'write', method: 'TYB721.refund' },
    buyTickets:          { chain: 'robinhood', kind: 'write', method: 'TYBGacha.buyTickets' },
    withdraw:            { chain: 'robinhood', kind: 'write', method: 'TYBGacha.withdraw' },
    refundTicket:        { chain: 'robinhood', kind: 'write', method: 'TYBGacha.refundTicket' },
    claimPowerUps:       { chain: 'robinhood', kind: 'write', method: 'TYBPowerUp1155.claimPowerUps' },
    commitAttempt:       { chain: 'robinhood', kind: 'write', method: 'TYBEvolution.commitAttempt' },
    resolveAttempt:      { chain: 'robinhood', kind: 'write', method: 'TYBEvolution.resolveAttempt' },
    cancelAttempt:       { chain: 'robinhood', kind: 'write', method: 'TYBEvolution.cancelAttempt' },
    // writes — Ethereum / Frog Heads. setApprovalForAll's operator arg IS the helper (read from config in the
    // body); the manifest gates each write on the contract whose METHOD it calls (FRHD / the helper).
    frogApproveBurner:   { chain: 'ethereum',  kind: 'write', method: 'FRHD.setApprovalForAll' },
    frogBurnMany:        { chain: 'ethereum',  kind: 'write', method: 'FrogHeadBulkBurner.burnMany' }
  });

  // ── revert helper: the ONE shape both impls throw (design contract #2). ──
  function seamRevert(name, args, reason) {
    var e = new Error(reason || ('execution reverted: ' + name));
    e.code = 'CALL_EXCEPTION';
    e.revert = { name: name, args: args || [] };
    e.reason = reason || name;
    return e;
  }

  // ── LIVE_FNS: per-chain address+chainId gate (design contract #3). ───────
  // In mock mode nothing is "live". In real mode a fn is live only when the
  // contract(s) its method touches are addressed AND the reader chainId matches.
  var METHOD_ADDR = {
    'TYB721': 'tyb721', 'TYBGacha': 'tybGacha', 'TYBPowerUp1155': 'tybPowerUp1155',
    'TYBEvolution': 'tybEvolution', 'TYBRenderer': 'tybRenderer',
    'FRHD': 'frhd', 'FrogHeadBulkBurner': 'frogHeadBulkBurner'
  };
  function isHexAddr(a) { return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a); }

  // valid reader chainIds per chain. Robinhood accepts BOTH mainnet (4663) and testnet (46630) so a
  // rehearsal on testnet still reports 'live' (GO fold: the gate must not force mainnet-only).
  function validChainIds(chain) {
    if (chain === 'ethereum') return [BigInt(CFG.chains.ethereum.chainId)];
    return [BigInt(CFG.chains.robinhood.chainId), BigInt(CFG.chains.robinhood.testnet.chainId)];
  }

  // Reader chainId observed at runtime (set by tyb-session when a read-provider is built).
  var readerChainId = { robinhood: null, ethereum: null };
  // '' → null (not 0n): an empty/absent id is "unknown", which must land on the null sentinel (→
  // 'misconfigured'), NOT on BigInt('')===0n (a number that only fails closed by never matching a valid
  // id). Both fail closed, but null is the explicit "not set" the gate is written around. (audit P2-L→FRONT-UX)
  function setReaderChainId(chain, id) { readerChainId[chain] = (id == null || id === '' ? null : BigInt(id)); }

  function fnLiveState(name) {
    if (MODE !== 'real') return 'mock';
    var spec = SEAM_SPEC[name];
    if (!spec) return 'mock';
    // off-chain seams are "live" once their real impl is wired — tracked by a flag the real body sets.
    if (spec.method.indexOf('offchain:') === 0) return REAL._wired[name] ? 'live' : 'misconfigured';
    // every contract the method names must be addressed. A '+'-joined segment WITHOUT a "Contract."
    // prefix inherits the previous segment's contract (defensive — all SPEC methods are fully
    // qualified today, but a future shorthand must not silently pin a fn to 'misconfigured' forever).
    var segs = spec.method.split('+');
    var prev = null;
    for (var i = 0; i < segs.length; i++) {
      var c = segs[i].indexOf('.') >= 0 ? segs[i].split('.')[0] : prev;
      prev = c;
      var slot = METHOD_ADDR[c];
      if (!slot || !isHexAddr(CFG.addresses[slot])) return 'misconfigured';
    }
    // Ethereum (FRHD burn) seams have NO ethers reader — reads go via the enum Worker / the wallet, writes via
    // the wallet — so there is no reader chainId to gate on; addresses configured IS the wiring-complete state.
    // The wallet-chain check happens at ACTION time (burn.js gates isOnChain('ethereum') before each write;
    // getFrogApproval returns false off-ETH). (chunk-c wiring 2026-09-08)
    if (spec.chain === 'ethereum') return 'live';
    // reader chainId must be one of the fn's chain's valid ids
    var rc = readerChainId[spec.chain];
    if (rc == null) return 'misconfigured';
    var okIds = validChainIds(spec.chain);
    if (okIds.indexOf(rc) < 0) return 'misconfigured';
    return 'live';
  }

  // DEFERRED seams (CFG.deferredFns, B3): an EXPLICITLY-listed fn that computes 'misconfigured' is reported in
  // its own bucket (declared, not alarming). Any OTHER 'misconfigured' is a real wiring gap. The GATE is
  // unchanged — fnLiveState still says 'misconfigured' for both; only the display bucket differs.
  var DEFERRED = CFG.deferredFns || {};
  function liveStatus() {
    var names = Object.keys(SEAM_SPEC);
    var live = 0, mock = 0, bad = 0, deferred = 0, perFn = {};
    names.forEach(function (n) {
      var s = fnLiveState(n); perFn[n] = s;
      if (s === 'live') live++;
      else if (s === 'misconfigured') { if (Object.prototype.hasOwnProperty.call(DEFERRED, n)) deferred++; else bad++; }
      else mock++;
    });
    return { total: names.length, live: live, mock: mock, misconfigured: bad, deferred: deferred, perFn: perFn };
  }

  // ── ?scenario= (design contract #4: inert in real). ─────────────────────
  function scenario() {
    if (MODE === 'real') return null;
    try { return new URLSearchParams(window.location.search).get('scenario'); }
    catch (_) { return null; }
  }

  // ── MOCK impl — thin wrappers over the fixtures, in the seam shape. ──────
  function mockFor(name, kind) {
    return function () {
      var argv = Array.prototype.slice.call(arguments);
      if (!FIX) return Promise.reject(new Error('tyb-mock-fixtures.js not loaded'));
      // The fixtures module owns the scenario logic + returns already-shaped data.
      // Writes: it may return a rejection (a seamRevert) to exercise the error UI.
      var out = FIX.resolve(name, kind, argv, scenario(), seamRevert);
      return Promise.resolve().then(function () {
        if (out && out.__throw) throw out.__throw;         // seam revert / error state
        if (kind === 'write') return out || mockTx();      // {hash, wait}
        return out;
      });
    };
  }
  function mockTx() {
    var hash = '0x' + 'ab'.repeat(32);
    // status is a Number (1/0) — ethers v6 receipt metadata, NOT an ABI int (matches the fixtures' tx()).
    return { hash: hash, wait: function () { return Promise.resolve({ status: 1, hash: hash }); } };
  }

  // ── REAL impl (B3-1, 2026-09-07: the 19 Robinhood READS; B3-2 lands the writes) ──────────────────────
  //    Fail-closed baseline: every fn NOT wired below REJECTS async with the SEAM SHAPE
  //    (seamRevert 'NotWired' — a call-site's revertCopy shows a clean "not available yet", never a raw
  //    dev string; the message still carries "not wired" for the parity test). Writes MUST NOT simulate
  //    success (contract #3). WIRING = edit bodies in SOURCE (TYB.call binds at load); never runtime-patch.
  //    Setting _wired[name]=true marks an off-chain seam live — only from inside its wired body.
  var REAL = { _wired: {} };
  var NOT_WIRED = 'Not available yet.';
  function notWired(name) {
    return function () {
      return Promise.reject(seamRevert('NotWired', [], 'tyb-chain: "' + name + '" not wired yet (SEAM_MODE=real). ' + NOT_WIRED));
    };
  }
  Object.keys(SEAM_SPEC).forEach(function (name) { REAL[name] = notWired(name); });
  var STRICT = {}; // proxy-only variants of the reads (pre-write re-validation); filled by the reader block below

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // READER (real mode only) — wallet-INDEPENDENT ethers v6 read layer + the proxy→public LADDER.
  //   · primary  = the key-hiding rpc-proxy Worker (CFG.readers[chain][env].primary)  — batch ≤20
  //   · fallback = the chain's public RPC (…fallback)                                — batchMaxCount 1 (no batch guarantee)
  //   · withReader(fn): runs fn(provider) — the WHOLE read body, all its phases — on the primary; on a TRANSPORT
  //     failure (isFailover) re-runs the whole body ONCE on the fallback and latches preferFallback for
  //     LATCH_MS (a tripped Worker doesn't cost a double round-trip per read). A CALL_EXCEPTION (revert) is an
  //     ANSWER, never retried; a 403/400 from the proxy means OUR pin/allowlist is wrong → surfaced, never routed
  //     around the proxy (ethers folds every non-2xx/non-429 HTTP into code 'SERVER_ERROR' — the numeric status
  //     lives in err.info.responseStatus and is the only discriminator).
  //   · strict(fn): primary ONLY, ignores the latch, never touches the fallback — the pre-write re-validation
  //     must never trust the un-pinned public RPC (design GO 2026-09-07, adversarial catch).
  //   · Boot: eth_chainId on the primary (then fallback) → TYB.setReaderChainId(chain, id) → LIVE_FNS turn 'live'.
  //     Both down → reads reject with code 'READER_DOWN'; retried lazily after RETRY_MS.
  //   · Failure DIRECTION: display reads degrade to the public RPC (with a 'degraded' flag the app-bar shows);
  //     strict reads FAIL (caller shows "cannot verify right now"). Nothing ever simulates a value.
  var LATCH_MS = 60000, RETRY_MS = 5000, PROXY_TIMEOUT_MS = 8000, PUBLIC_TIMEOUT_MS = 12000;
  var CHUNK = 20;               // ≤ the proxy's batch cap; sibling calls inside a chunk are issued before any await
  var PURCHASE_SCAN_CAP = 400;  // 20 chunks — a wallet's purchases beyond this are not shown (mainnet: indexer)
  var ATTEMPT_SCAN_CAP = 40;    // RL_GLOBAL bills per SUB-CALL: a wide scan self-trips the proxy (GO fold opus P2-4)
  var CLAIM_ROUND_SCAN_CAP = 30; // getClaimablePowerUps scans the most recent rounds only; older unclaimed purchases stay claimable (permissionless), just unlisted (mainnet: indexer)
  var ATTEMPT_MEMO_MS = 2000;   // one scan per refresh: concurrent getAttempts cells share one in-flight promise
  var readerState = { chainId: null, degraded: false, degradedUntil: 0, lastErr: null, primaryUrl: null, fallbackUrl: null };
  var rd = null, rdPromise = null, rdFailedAt = 0;

  function E() { var e = window.ethers; if (!e) throw new Error('tyb-chain: ethers not loaded (assets/ethers-6.17.0.umd.min.js must load first)'); return e; }
  function robinhoodEnv() { return CFG.activeEnv === 'testnet' ? CFG.chains.robinhood.testnet : CFG.chains.robinhood; }
  function readerUrls() { var r = CFG.readers && CFG.readers.robinhood; return (r && r[CFG.activeEnv === 'testnet' ? 'testnet' : 'mainnet']) || {}; }
  function codedErr(code, msg) { var e = new Error(msg || code); e.code = code; e.reason = msg || code; return e; }
  function httpStatus(e) {
    var s = e && e.info && e.info.responseStatus; if (typeof s !== 'string') return null;
    var n = parseInt(s, 10); return isNaN(n) ? null : n;
  }
  // The failover predicate (design GO folds: opus P2-1, lens-C). TRUE only for transport-class failures.
  function isFailover(e) {
    if (!e) return false;
    var c = e.code;
    if (c === 'CALL_EXCEPTION' || c === 'BAD_DATA' || c === 'INVALID_ARGUMENT' || c === 'UNSUPPORTED_OPERATION' ||
        c === 'ACTION_REJECTED' || c === 'READER_DOWN') return false;
    if (c === 'NETWORK_ERROR' || c === 'TIMEOUT') return true;
    // 5xx = the Worker tripped/upstream died; 429 = an EDGE rate-limit in front of the proxy (outside the Worker's own
    // 503 contract, still transport-class — code-GO fable P2); 403/400 = OUR pin/origin is wrong → false (surface it).
    if (c === 'SERVER_ERROR') { var st = httpStatus(e); return st == null ? true : (st === 429 || st >= 500); }
    if (!c) return e instanceof TypeError; // a raw fetch/CORS failure in the browser surfaces as a TypeError
    return false;
  }
  function mkProvider(url, chainId, batchMax, timeoutMs) {
    var eth = E();
    var req = new eth.FetchRequest(url); req.timeout = timeoutMs;
    var net = eth.Network.from(chainId);
    var p = new eth.JsonRpcProvider(req, net, { batchMaxCount: batchMax, batchStallTime: 10, staticNetwork: net, polling: false });
    p.__tybFanout = batchMax; // chunked() fan-out width: 20 against the proxy (one batch), 1 against the public RPC (no bursts)
    return p;
  }
  function emitReader() {
    try { window.dispatchEvent(new CustomEvent('tyb:reader', { detail: readerStatus() })); } catch (_) {}
  }
  function readerStatus() {
    var degraded = readerState.degraded && Date.now() < readerState.degradedUntil;
    return { mode: MODE, chainId: readerState.chainId, degraded: degraded, primary: readerState.primaryUrl,
      fallback: readerState.fallbackUrl, trustedReader: !!(rd && rd.primaryIsProxy), lastError: readerState.lastErr };
  }
  function clearDegradedIfExpired() { // the latch lapsed and the proxy answered again → tell the watermark (code-GO opus P3-2)
    if (readerState.degraded && Date.now() >= readerState.degradedUntil) { readerState.degraded = false; emitReader(); }
  }
  function probeChain(provider) {
    return provider.send('eth_chainId', []).then(function (hex) { return BigInt(hex); });
  }
  // Build + verify the reader once; memoized. A total failure is remembered for RETRY_MS then retried.
  function ensureReader() {
    // LAUNCH BUILD: the Robinhood/TYB reader is OFF this phase (CFG.launch.readerEnabled === false) — refuse to boot
    // it for the boot probe AND every lazy read, so a public origin never touches the staging proxy, even on a
    // direct-URL visit to a page that should have been excluded from the upload. FRHD reads never reach here (they
    // dispatch directly), so the burn/GTD path is unaffected.
    if (CFG.launch && CFG.launch.readerEnabled === false) return Promise.reject(codedErr('READER_DOWN', 'TYB reader disabled this launch phase'));
    if (rd) return Promise.resolve(rd);
    if (rdPromise) return rdPromise;
    if (rdFailedAt && Date.now() - rdFailedAt < RETRY_MS) return Promise.reject(codedErr('READER_DOWN', readerState.lastErr || 'reader down'));
    var urls = readerUrls(), env = robinhoodEnv(), want = BigInt(env.chainId);
    readerState.primaryUrl = urls.primary || null; readerState.fallbackUrl = urls.fallback || null;
    var primary = null, fallback = null;
    function build() { // inside the chain so a missing ethers / bad config REJECTS (never a sync throw at load)
      if (!urls.primary && !urls.fallback) throw codedErr('READER_DOWN', 'no reader configured for ' + CFG.activeEnv);
      // OPS LOUDNESS (code-GO sonnet P2): without a pinned proxy every STRICT read rejects → ALL writes' pre-validation is
      // unavailable (total write lockout, not a degrade). Say so at boot instead of at the first user's first click.
      if (!urls.primary) { try { console.warn('[tyb-chain] no rpc-proxy configured for ' + CFG.activeEnv + ': display reads use the public RPC; WRITES are unavailable (strict reads reject)'); } catch (_) {} }
      primary = urls.primary ? mkProvider(urls.primary, env.chainId, CHUNK, PROXY_TIMEOUT_MS) : null;
      fallback = urls.fallback ? mkProvider(urls.fallback, env.chainId, 1, PUBLIC_TIMEOUT_MS) : null;
    }
    function accept(id, viaFallback) {
      if (id !== want) throw codedErr('READER_DOWN', 'reader chainId ' + id + ' != ' + want + ' (wrong env?)');
      // primaryIsProxy: strict() may ONLY run when the primary is the real (pinned) proxy. With no proxy configured
      // (mainnet primary null) display reads still work off the public RPC, but strict rejects (code-GO fable P1).
      rd = { primary: primary || fallback, fallback: primary ? fallback : null, primaryIsProxy: !!primary, preferFallbackUntil: 0, contracts: new Map() };
      readerState.chainId = id; readerState.lastErr = null;
      if (viaFallback) latchFallback(new Error('primary unreachable at boot'));
      setReaderChainId('robinhood', id);
      emitReader();
      return rd;
    }
    rdPromise = Promise.resolve()
      .then(function () { build(); if (!primary) throw codedErr('NETWORK_ERROR', 'no primary'); return probeChain(primary); })
      .then(function (id) { return accept(id, false); })
      .catch(function (e1) {
        if (!fallback || !isFailover(e1)) throw e1;
        return probeChain(fallback).then(function (id) { return accept(id, true); });
      })
      .catch(function (e) {
        rdFailedAt = Date.now(); readerState.lastErr = (e && (e.shortMessage || e.message)) || 'reader down'; rd = null;
        setReaderChainId('robinhood', null); emitReader();
        throw codedErr('READER_DOWN', readerState.lastErr);
      })
      .finally(function () { rdPromise = null; });
    return rdPromise;
  }
  function latchFallback(e) {
    if (rd) rd.preferFallbackUntil = Date.now() + LATCH_MS;
    readerState.degraded = true; readerState.degradedUntil = Date.now() + LATCH_MS;
    readerState.lastErr = (e && (e.shortMessage || e.message)) || 'transport error';
    emitReader();
  }
  function withReader(fn) {
    return ensureReader().then(function (r) {
      var useFallback = !!r.fallback && Date.now() < r.preferFallbackUntil;
      var first = useFallback ? r.fallback : r.primary;
      return Promise.resolve().then(function () { return fn(first); }).then(function (v) {
        if (!useFallback) clearDegradedIfExpired();
        return v;
      }).catch(function (e) {
        if (useFallback || !r.fallback || !isFailover(e)) throw e; // already on fallback / nothing to ladder to / not a transport fault
        latchFallback(e);
        return fn(r.fallback); // re-run the WHOLE body once (multi-phase bodies included)
      });
    });
  }
  function strict(fn) { // proxy ONLY; no latch, no fallback (fails loud → "cannot verify right now")
    return ensureReader().then(function (r) {
      if (!r.primaryIsProxy) throw codedErr('READER_DOWN', 'no trusted (proxy) reader configured — strict reads unavailable');
      return fn(r.primary);
    }).catch(function (e) {
      // PHASE TAG (code-GO opus P2-1): a transport failure HERE means "we could not READ" — nothing was sent. Pages
      // must only say "nothing was sent" for this phase; a transport error during the wallet SEND may have broadcast.
      if (e && typeof e === 'object' && isTransportCode(e)) { try { e._strictRead = true; } catch (_) {} }
      throw e;
    });
  }
  function isTransportCode(e) {
    var c = e && e.code;
    return c === 'READER_DOWN' || c === 'SERVER_ERROR' || c === 'NETWORK_ERROR' || c === 'TIMEOUT' || (!!e && !c && e instanceof TypeError);
  }
  // Contract handles are cached per (provider, contract). ABI = the generated tyb-abi.js (functions + ALL errors).
  function ctr(provider, name) {
    var abis = window.TYB_ABI; if (!abis || !abis[name]) throw new Error('tyb-chain: tyb-abi.js missing ' + name);
    var addr = CFG.addresses[METHOD_ADDR[name]];
    if (!isHexAddr(addr)) throw codedErr('INVALID_ARGUMENT', name + ' address not configured');
    var key = name + '@' + (provider === (rd && rd.primary) ? 'p' : 'f');
    var c = rd.contracts.get(key);
    if (!c) { c = new (E().Contract)(addr, abis[name], provider); rd.contracts.set(key, c); }
    return c;
  }
  function addrArg(a, what) {
    var eth = E();
    if (typeof a !== 'string' || !eth.isAddress(a)) throw codedErr('INVALID_ARGUMENT', (what || 'address') + ' must be a hex address');
    return eth.getAddress(a);
  }
  // BigInt('')===0n and BigInt(null) throws TypeError: an EMPTY/missing id must be an INVALID_ARGUMENT, never round/token 0
  // (mock guards the same way — code-GO opus P3-1; the C0/C1 lesson: the guard lives next to the conversion).
  function big(v) {
    if (typeof v === 'bigint') return v;
    if (v == null || v === '' || (typeof v === 'number' && !Number.isInteger(v))) throw codedErr('INVALID_ARGUMENT', 'empty/invalid integer argument');
    try { return BigInt(v); } catch (_) { throw codedErr('INVALID_ARGUMENT', 'not an integer: ' + String(v)); }
  }
  function bigArr(v) { return Array.prototype.map.call(v || [], big); }
  function sameAddr(a, b) { return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase(); }
  // Chunked fan-out: all sibling calls of a chunk are issued before any await (one ethers batch per chunk), chunks
  // run SEQUENTIALLY. Width follows the PROVIDER: 20 against the proxy (= one batched POST), 1 against the public RPC
  // (batchMaxCount 1 there would turn a 20-wide chunk into 20 concurrent unbatched requests → 429/abuse detection;
  // code-GO sonnet P2-2). A 429 body is one error object rejecting the whole batch.
  function chunked(p, items, fn) {
    var width = (p && p.__tybFanout) || 1; var out = [];
    function step(i) {
      if (i >= items.length) return Promise.resolve(out);
      return Promise.all(items.slice(i, i + width).map(fn)).then(function (part) { out = out.concat(part); return step(i + width); });
    }
    return step(0);
  }

  // ── the 19 Robinhood read bodies: shape-identical to tyb-mock-fixtures.js (keys, BigInt-ness, enums) ──
  var READS = {
    getPhase: function (p) { return ctr(p, 'TYB721').phase().then(big); },
    getSupply: function (p) {
      var t = ctr(p, 'TYB721');
      return Promise.all([t.totalSupply(), t.totalMintedEver()]).then(function (r) { return { totalSupply: big(r[0]), totalMintedEver: big(r[1]) }; });
    },
    getNumberMinted: function (p, a) { return ctr(p, 'TYB721').numberMinted(addrArg(a)).then(big); },
    getGtdMinted: function (p, a) { return ctr(p, 'TYB721').gtdMinted(addrArg(a)).then(big); },
    getMintPaused: function (p) { return ctr(p, 'TYB721').mintPaused().then(Boolean); },
    getRefundState: function (p) {
      var t = ctr(p, 'TYB721');
      return Promise.all([t.refundOpen(), t.refundClosed()]).then(function (r) { return { refundOpen: Boolean(r[0]), refundClosed: Boolean(r[1]) }; });
    },
    // `owned` is TRUE by construction here (tokensOfOwner already filters ownership); a sale between load and the
    // write is caught by the contract (NotOwner/OwnerQueryForNonexistentToken) and by the pre-write strict re-read.
    getMyMintedTokens: function (p, a) {
      var t = ctr(p, 'TYB721'); var who = addrArg(a);
      return t.tokensOfOwner(who).then(function (ids) {
        ids = bigArr(ids);
        return chunked(p, ids, function (id) { return t.originalMinter(id); }).then(function (minters) {
          return ids.map(function (id, i) { return { id: id, isOriginalMinter: sameAddr(minters[i], who), owned: true }; });
        });
      });
    },
    // metaUrl = TYB721.tokenURI(id): authoritative (delegates to the renderer/gateway when set, static IPFS otherwise).
    getInventory: function (p, a) {
      var t = ctr(p, 'TYB721'), ev = ctr(p, 'TYBEvolution'); var who = addrArg(a);
      return t.tokensOfOwner(who).then(function (ids) {
        ids = bigArr(ids);
        return chunked(p, ids, function (id) { return Promise.all([ev.levelsOf(id), t.tokenURI(id)]); }).then(function (rows) {
          return ids.map(function (id, i) {
            var lv = bigArr(rows[i][0]); while (lv.length < CFG.evolution.categories) lv.push(0n);
            return { id: id, levels: lv.slice(0, CFG.evolution.categories), metaUrl: String(rows[i][1]) };
          });
        });
      });
    },
    getPowerUpBalances: function (p, a) {
      var who = addrArg(a); var n = CFG.powerUps.categories; var owners = [], ids = [];
      for (var i = 0; i < n; i++) { owners.push(who); ids.push(BigInt(i)); }
      return ctr(p, 'TYBPowerUp1155').balanceOfBatch(owners, ids).then(bigArr);
    },
    getCurrentRoundId: function (p) { return ctr(p, 'TYBGacha').currentRoundId().then(big); },
    getBuysPaused: function (p) { return ctr(p, 'TYBGacha').buysPaused().then(Boolean); },
    // rounds(id) is a 22-field auto-getter, read BY NAME (never by index). rounds(0) / an unknown id is the ZERO
    // struct (state 0n = None, ticketCount 0n) — it does not revert; the UI's "no round" branch keys on state.
    getRound: function (p, rid) {
      var id = big(rid);
      return ctr(p, 'TYBGacha').rounds(id).then(function (r) {
        return { id: id, ticketPrice: big(r.ticketPrice), salesEnd: big(r.salesEnd), ticketCount: big(r.ticketCount),
          winnerFinalized: Boolean(r.winnerFinalized), hasWinner: Boolean(r.hasWinner), winningNonce: big(r.winningNonce),
          livePot: big(r.livePot), state: big(r.state) };
      });
    },
    getWinningIds: function (p, rid) { return ctr(p, 'TYBGacha').winningIdsOf(big(rid)).then(bigArr); },
    getMyPurchases: function (p, rid, a) {
      var g = ctr(p, 'TYBGacha'); var id = big(rid); var who = addrArg(a);
      return g.purchaseCount(id).then(function (n) {
        n = Number(big(n)); var idx = []; for (var i = 0; i < Math.min(n, PURCHASE_SCAN_CAP); i++) idx.push(i);
        return chunked(p, idx, function (i) { return g.purchases(id, BigInt(i)); }).then(function (rows) {
          var out = [];
          rows.forEach(function (r, i) {
            if (sameAddr(r.buyer, who)) out.push({ purchaseIndex: BigInt(i), startNonce: big(r.startNonce), qty: big(r.qty), settled: Boolean(r.settled) });
          });
          return out;
        });
      });
    },
    // Composed ON-CHAIN (rehearsal 3 S5 fix, 2026-09-08 — was a deferred "indexer" seam): mirrors TYBPowerUp1155.claimPowerUps
    // gates 1:1 — round winnerFinalized && seed != 0 · qty > 0 · startNonce <= winningNonce · !claimed[round][idx].
    // Calls the RAW READS body of getMyPurchases with the SAME provider (never REAL.* — that re-enters withReader and
    // would let a strict() call fall to the public fallback; opus P1). Scans the most recent CLAIM_ROUND_SCAN_CAP rounds.
    getClaimablePowerUps: function (p, a) {
      var g = ctr(p, 'TYBGacha'), pu = ctr(p, 'TYBPowerUp1155'), who = addrArg(a);
      return g.currentRoundId().then(function (cur) {
        var n = Number(big(cur)); var rids = []; for (var r = n; r >= 1 && rids.length < CLAIM_ROUND_SCAN_CAP; r--) rids.push(r);
        if (!rids.length) return [];
        return chunked(p, rids, function (r) { return g.rounds(BigInt(r)); }).then(function (rows) {
          var fin = [];
          rows.forEach(function (rr, k) { if (Boolean(rr.winnerFinalized) && big(rr.seed) !== 0n) fin.push({ rid: BigInt(rids[k]), w: big(rr.winningNonce) }); });
          return Promise.all(fin.map(function (f) {
            return READS.getMyPurchases(p, f.rid, who).then(function (ps) {
              var mine = ps.filter(function (x) { return x.qty > 0n && x.startNonce <= f.w; });
              if (!mine.length) return [];
              return chunked(p, mine, function (x) { return pu.claimed(f.rid, x.purchaseIndex); }).then(function (cl) {
                var out = [];
                mine.forEach(function (x, i) { if (!Boolean(cl[i])) out.push({ roundId: f.rid, purchaseIndex: x.purchaseIndex, qty: x.qty }); });
                return out;
              });
            });
          })).then(function (per) { return [].concat.apply([], per); });
        });
      });
    },
    getTicketId: function (p, rid, pi, off) { return ctr(p, 'TYBGacha').ticketId(big(rid), big(pi), big(off)).then(big); },
    getClaimable: function (p, a) { return ctr(p, 'TYBGacha').claimable(addrArg(a)).then(big); },
    // No on-chain "attempt for (token, cat)" view: ONE memoized descending scan of attempts(nextAttemptId-1 .. -CAP)
    // per refresh window feeds every inventory cell (concurrent calls share the in-flight promise). canCancel is a
    // DERIVED value (no ABI source): !settled && pinned round not Resolved && now >= commitTs + CANCEL_DEADLINE.
    getAttempts: function (p, tokenId, cat) {
      var tid = big(tokenId), c = big(cat);
      return attemptsIndex(p).then(function (ix) {
        var hit = ix.map[tid.toString() + ':' + c.toString()];
        if (!hit) return { pending: false, attemptId: 0n, roundResolved: false, canCancel: false };
        var g = ctr(p, 'TYBGacha');
        return g.rounds(hit.pinnedRound).then(function (r) {
          var resolved = big(r.state) === 3n;
          var nowS = BigInt(Math.floor(Date.now() / 1000));
          var canCancel = !resolved && nowS >= hit.commitTs + ix.cancelDeadline;
          return { pending: true, attemptId: hit.attemptId, roundResolved: resolved, canCancel: canCancel };
        });
      });
    }
  };
  var attemptsMemo = { at: 0, key: null, promise: null };
  function attemptsIndex(p) {
    var key = (p === (rd && rd.primary)) ? 'p' : 'f';
    if (attemptsMemo.promise && attemptsMemo.key === key && Date.now() - attemptsMemo.at < ATTEMPT_MEMO_MS) return attemptsMemo.promise;
    var ev = ctr(p, 'TYBEvolution');
    var pr = Promise.all([ev.nextAttemptId(), ev.CANCEL_DEADLINE()]).then(function (r) {
      var n = Number(big(r[0])); var cancelDeadline = big(r[1]);
      var idx = []; for (var i = n - 1; i >= 0 && idx.length < ATTEMPT_SCAN_CAP; i--) idx.push(i);
      return chunked(p, idx, function (i) { return ev.attempts(BigInt(i)); }).then(function (rows) {
        var map = Object.create(null);
        rows.forEach(function (at, k) { // descending → the FIRST hit per key is the latest attempt
          if (at.settled) return;
          var mk = big(at.tokenId).toString() + ':' + big(at.category).toString();
          if (!map[mk]) map[mk] = { attemptId: BigInt(idx[k]), pinnedRound: big(at.pinnedRound), commitTs: big(at.commitTs) };
        });
        return { map: map, cancelDeadline: cancelDeadline, scanned: idx.length, total: n };
      });
    });
    pr.catch(function () { if (attemptsMemo.promise === pr) attemptsMemo.promise = null; }); // a failed scan is not memoized
    attemptsMemo = { at: Date.now(), key: key, promise: pr };
    return pr;
  }
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // FRHD (Ethereum) READ bodies (chunk-c wiring 2026-09-08) — NOT through the Robinhood reader ladder. Two
  // hit the key-hiding enum Worker (CFG.frogHeads.enumWorker); getFrogApproval reads via the WALLET (Le's
  // option A); getGtdEligibility reads the swappable check-list.json snapshot (same file the connect-free
  // checker uses). Each off-chain body sets REAL._wired[name] so its LIVE_FNS gate flips to 'live' once run.
  var FROG_ENUM_MAX_PAGES = 20;   // finite pagination cap (>2000 FRHD in one wallet is unrealistic; never an unbounded client loop)
  function enumBase() {
    var u = CFG.frogHeads && CFG.frogHeads.enumWorker;
    if (typeof u !== 'string' || !/^https:\/\//.test(u)) throw codedErr('INVALID_ARGUMENT', 'FRHD enum Worker not configured');
    return u.replace(/\/+$/, '');
  }
  function frhdAddr() { var a = CFG.addresses.frhd; if (!isHexAddr(a)) throw codedErr('INVALID_ARGUMENT', 'FRHD address not configured'); return a; }
  function helperAddr() { var a = CFG.addresses.frogHeadBulkBurner; if (!isHexAddr(a)) throw codedErr('INVALID_ARGUMENT', 'FrogHeadBulkBurner address not configured'); return a; }
  var FROG = {
    // GET /enum?owner=..&pageKey=.. → { ids:[decimal-string], pageKey } — the holder's FRHD ids, paginated
    // (Worker hides the Alchemy key + PRE-SANITIZES to decimal ids). DISPLAY list for the grid (lags a burn).
    getFrogHeads: function (a) {
      var who = addrArg(a).toLowerCase();
      var base = enumBase();
      REAL._wired.getFrogHeads = true;
      var out = [];
      function page(key, n) {
        var u = base + '/enum?owner=' + encodeURIComponent(who) + (key ? '&pageKey=' + encodeURIComponent(key) : '');
        return fetch(u, { headers: { Accept: 'application/json' } }).then(function (r) {
          if (!r.ok) throw codedErr('SERVER_ERROR', 'enum ' + r.status);
          return r.json();
        }).then(function (j) {
          (j && Array.isArray(j.ids) ? j.ids : []).forEach(function (s) { if (typeof s === 'string' && /^[0-9]{1,78}$/.test(s)) out.push({ id: BigInt(s) }); });
          var nk = j && typeof j.pageKey === 'string' ? j.pageKey : null;
          if (nk && n < FROG_ENUM_MAX_PAGES) return page(nk, n + 1);
          return out;
        });
      }
      return page(null, 1);
    },
    // POST /rpc — eth_call ownerOf(id) for each SELECTED id → the subset of `ids` STILL owned by `a`, as
    // [{id:bigint}] (shape-compatible with getFrogHeads). This is the FRESH pre-burn re-read: ownerOf on the
    // live chain, never the lagging enum (audit P1-B / lesson). An id whose ownerOf REVERTS (burned) has no
    // result and is DROPPED (treated as no-longer-owned) — the on-chain NotYourToken revert is the backstop.
    getFrogOwners: function (ids, a) {
      var who = addrArg(a);
      var arr = bigArr(ids);
      REAL._wired.getFrogOwners = true;
      if (!arr.length) return Promise.resolve([]);
      var iface = new (E().Interface)(window.TYB_ABI.FRHD);
      var to = frhdAddr();
      var batch = arr.map(function (id, i) {
        return { jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: to, data: iface.encodeFunctionData('ownerOf', [id]) }, 'latest'] };
      });
      return fetch(enumBase() + '/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) }).then(function (r) {
        if (!r.ok) throw codedErr('SERVER_ERROR', 'rpc ' + r.status);
        return r.json();
      }).then(function (res) {
        var byId = {};
        (Array.isArray(res) ? res : [res]).forEach(function (o) { if (o && typeof o.id === 'number' && typeof o.result === 'string') byId[o.id] = o.result; });
        var owned = [];
        arr.forEach(function (id, i) {
          var raw = byId[i + 1];
          if (!raw) return;
          var owner; try { owner = iface.decodeFunctionResult('ownerOf', raw)[0]; } catch (_) { return; }
          if (sameAddr(owner, who)) owned.push({ id: id });
        });
        return owned;
      });
    },
    // Option A (Le 2026-09-08): isApprovedForAll(you, helper) via the WALLET provider. Readable only when the
    // wallet is on Ethereum; off-ETH (e.g. sitting on Robinhood at load) → false — the burn flow switches to ETH
    // and re-reads authoritatively before approving. NEVER rejects (would break burn.js's load Promise.all).
    getFrogApproval: function (a) {
      var who; try { who = addrArg(a); } catch (_) { return Promise.resolve(false); }
      var S = window.TYB_SESSION;
      if (!S || typeof S.isOnChain !== 'function' || !S.isOnChain('ethereum')) return Promise.resolve(false);
      var raw = typeof S.rawProvider === 'function' ? S.rawProvider() : null;
      if (!raw) return Promise.resolve(false);
      var helper; try { helper = helperAddr(); } catch (_) { return Promise.resolve(false); } // no helper deployed → approved to nothing
      return Promise.resolve().then(function () {
        var c = new (E().Contract)(frhdAddr(), window.TYB_ABI.FRHD, new (E().BrowserProvider)(raw));
        return c.isApprovedForAll(who, helper);
      }).then(Boolean).catch(function () { return false; }); // any read error at load → not-approved; the on-ETH re-read is authoritative
    },
    // GTD status banner for the CONNECTED wallet: the swappable, NON-definitive pre-burn snapshot (check-list.json,
    // same file the connect-free checker uses). Membership only (no per-wallet qty) → allowedQty = onList ? 1n : 0n
    // (placeholder; on burn day the real gtd-proofs.json with allowedQty+proof replaces this — the mint modal reads
    // the proofs, not this banner). Fail-closed: a missing/broken list → reject (burn.js shows "couldn't load"),
    // never a false onList.
    getGtdEligibility: function (a) {
      var who = String(a || '').toLowerCase();
      REAL._wired.getGtdEligibility = true;
      return fetch('check-list.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw codedErr('SERVER_ERROR', 'check-list ' + r.status);
        return r.json();
      }).then(function (j) {
        var onList = Array.isArray(j && j.gtd) && j.gtd.some(function (x) { return String(x).toLowerCase() === who; });
        // definitive:false → the banner shows "on the allowlist" (no hard count) because check-list.json is a
        // membership snapshot without per-wallet qty. On burn day the real gtd-proofs.json body returns
        // definitive:true + the real allowedQty AS A BIGINT (renderStatus compares `=== 1n`; a JS Number would
        // mis-pluralize) — the mint modal already reads those proofs.
        return { onList: onList, allowedQty: onList ? 1n : 0n, proof: [], definitive: false };
      });
    },
    // CONNECT-FREE burn counter: a single eth_call totalSupply() to FRHD via the Worker /rpc (same key-hiding
    // proxy as the ownerOf sweep; the Worker pins the totalSupply selector 0x18160ddd). Returns the live FRHD
    // totalSupply as a bigint — burn.js computes burned = baseline − this. No wallet / no account (runs on load).
    // REJECTS on any transport/shape anomaly (burn.js decouples the counter with .catch → the bar just hides; a
    // cosmetic read NEVER blocks the burn page — verification lesson). Never returns a wrong number silently.
    getFrhdTotalSupply: function () {
      REAL._wired.getFrhdTotalSupply = true;
      var iface = new (E().Interface)(window.TYB_ABI.FRHD);
      var to = frhdAddr();
      var body = { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: to, data: iface.encodeFunctionData('totalSupply', []) }, 'latest'] };
      return fetch(enumBase() + '/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
        if (!r.ok) throw codedErr('SERVER_ERROR', 'rpc ' + r.status);
        return r.json();
      }).then(function (res) {
        var o = Array.isArray(res) ? res[0] : res;                 // accept a bare object or a 1-element batch
        if (!o || typeof o.result !== 'string') throw codedErr('SERVER_ERROR', 'totalSupply: no result'); // error object / 429 → throw, never a fake 0
        return big(iface.decodeFunctionResult('totalSupply', o.result)[0]);
      });
    }
  };
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // WRITES (B3-2) — through the WALLET provider only (never the reader/proxy). Design contract #2: every write
  // rejects with the ONE seam shape. Mapping (design GO + code-GO folds):
  //   · ethers CALL_EXCEPTION with a decoded `revert` → seamRevert(name, args, reason)
  //   · CALL_EXCEPTION without decode → try the UNION of every TYB contract's error fragments (+ ERC721A library
  //     errors that live in no contract ABI): a revert that bubbles from a CALLEE (commitAttempt → PowerUp1155 burn →
  //     OZ ERC1155InsufficientBalance) is unknown to the caller's Interface (code-GO drift teeth caught it)
  //   · still undecodable → seamRevert('UnknownRevert', [], shortMessage) — a string, never null (call-sites map by name)
  //   · ACTION_REJECTED (user cancelled) → rethrown UNTOUCHED (call-sites branch on err.code, must see NO .revert)
  //   · `e.receipt` is preserved on every mapped error (pages check `e.receipt.status===0` FIRST)
  //   · wait(): ethers THROWS CALL_EXCEPTION(+receipt) on a mined revert; if it ever RESOLVES with status 0 we throw the
  //     seam shape ourselves — a `{status:0}` must never read as success. Resolved receipt → {status:Number, hash}.
  //   · msg.value is computed HERE from chain facts (PRICE×qty from config; ticketPrice×qty from a STRICT read of the
  //     round), never taken from the page (a page-supplied value would be the forgeable input).
  var LIBRARY_ERRORS = [ // errors reachable through our contracts that appear in none of their ABIs (ERC721A internals)
    'error OwnerQueryForNonexistentToken()', 'error TransferCallerNotOwnerNorApproved()', 'error TransferFromIncorrectOwner()',
    'error ApprovalCallerNotOwnerNorApproved()', 'error URIQueryForNonexistentToken()', 'error MintZeroQuantity()'
  ];
  var unionIface = null;
  function errorUnion() {
    if (unionIface) return unionIface;
    var abis = window.TYB_ABI || {}; var frags = []; var seen = {};
    Object.keys(abis).forEach(function (c) {
      abis[c].forEach(function (f) { if (f.type !== 'error') return; var sig = f.name + '(' + (f.inputs || []).map(function (i) { return i.type; }).join(',') + ')'; if (!seen[sig]) { seen[sig] = 1; frags.push(f); } });
    });
    unionIface = new (E().Interface)(frags.concat(LIBRARY_ERRORS));
    return unionIface;
  }
  // Some wallets (MetaMask mobile / embedded) wrap the user's cancel as a JSON-RPC internal error (-32603) with the 4001
  // nested in info.error / data, or only in the message — normalize so pages never show a cancel as a failure (fable P2).
  function isUserRejection(e) {
    if (!e) return false;
    if (e.code === 'ACTION_REJECTED' || e.code === 4001) return true;
    var inner = (e.info && e.info.error) || e.error || e.data;
    if (inner && (inner.code === 4001 || (inner.error && inner.error.code === 4001))) return true;
    var msg = String(e.shortMessage || e.message || (inner && inner.message) || '');
    return /user (rejected|denied|cancel)/i.test(msg);
  }
  function mapWriteErr(e) {
    if (!e || typeof e !== 'object') return e;
    if (e.code === 'ACTION_REJECTED') return e; // untouched: no .revert, code is the signal
    if (isUserRejection(e)) { var ur = codedErr('ACTION_REJECTED', 'user rejected the request in the wallet'); ur.cause = e; return ur; }
    if (e.code === 'CALL_EXCEPTION') {
      var se;
      if (e.revert && e.revert.name) se = seamRevert(e.revert.name, Array.prototype.slice.call(e.revert.args || []), e.reason || e.shortMessage);
      else {
        var parsed = null;
        try { if (e.data && e.data !== '0x') parsed = errorUnion().parseError(e.data); } catch (_) { parsed = null; }
        se = parsed ? seamRevert(parsed.name, Array.prototype.slice.call(parsed.args || []), e.shortMessage)
                    : seamRevert('UnknownRevert', [], e.shortMessage || e.message || 'execution reverted');
      }
      if (e.receipt) se.receipt = { status: Number(e.receipt.status), hash: e.receipt.hash };
      se.cause = e;
      return se;
    }
    return e; // transport / wallet / our own INVALID_ARGUMENT — surfaced as-is
  }
  function signerContract(name) {
    var S = window.TYB_SESSION; var raw = S && typeof S.rawProvider === 'function' ? S.rawProvider() : null;
    if (!raw) return Promise.reject(codedErr('NOT_CONNECTED', 'connect a wallet first'));
    var abis = window.TYB_ABI; if (!abis || !abis[name]) return Promise.reject(new Error('tyb-chain: tyb-abi.js missing ' + name));
    var addr = CFG.addresses[METHOD_ADDR[name]];
    if (!isHexAddr(addr)) return Promise.reject(codedErr('INVALID_ARGUMENT', name + ' address not configured'));
    var eth = E();
    return new eth.BrowserProvider(raw).getSigner().then(function (signer) {
      // ACCOUNT BIND (code-GO fable P2): the pre-checks ran for the SESSION account; if the wallet switched accounts
      // mid-flow the signer would be someone else → refuse rather than send from an account that was never validated.
      var snap = S.snapshot ? S.snapshot() : null;
      var want = snap && snap.account;
      return Promise.resolve(signer.getAddress ? signer.getAddress() : null).then(function (have) {
        if (want && have && !sameAddr(want, have)) throw codedErr('ACCOUNT_MISMATCH', 'the wallet switched accounts — reconnect and try again');
        return new eth.Contract(addr, abis[name], signer);
      });
    });
  }
  function seamTx(tx) {
    return {
      hash: tx.hash,
      wait: function () {
        return Promise.resolve(tx.wait()).then(function (r) {
          var status = Number(r && r.status);
          if (status !== 1) { var se = seamRevert('Reverted', [], 'transaction mined but reverted'); se.receipt = { status: status, hash: (r && r.hash) || tx.hash }; throw se; }
          return { status: 1, hash: r.hash };
        }, function (e) { throw mapWriteErr(e); });
      }
    };
  }
  function sendWrite(name, fn) { // fn(contract) → the ethers tx promise
    return signerContract(name).then(function (c) { return Promise.resolve().then(function () { return fn(c); }); }).then(seamTx, function (e) {
      var m = mapWriteErr(e);
      // A transport error DURING THE SEND is not "nothing was sent": the wallet may have broadcast and the reply was lost.
      // Mark it like the pages' wait-timeout so they say "may be pending — check your wallet/explorer before retrying"
      // (code-GO opus P2-1; lesson: no receipt ≠ proof the tx did not land). Never marked on reader/strict failures.
      if (m && typeof m === 'object' && !m._strictRead && isTransportCode(m) && m.code !== 'READER_DOWN') { try { m._pending = true; m._maybeSent = true; } catch (_) {} }
      throw m;
    });
  }
  var PRICE_WEI = BigInt(CFG.collection.priceWei);
  var WRITES = {
    mintGtd: function (qty, allowedQty, proof) { var q = big(qty); return sendWrite('TYB721', function (c) { return c.mintGtd(q, big(allowedQty), proof || [], { value: PRICE_WEI * q }); }); },
    mintFcfs: function (qty, proof) { var q = big(qty); return sendWrite('TYB721', function (c) { return c.mintFcfs(q, proof || [], { value: PRICE_WEI * q }); }); },
    mintPublic: function (qty) { var q = big(qty); return sendWrite('TYB721', function (c) { return c.mintPublic(q, { value: PRICE_WEI * q }); }); },
    refund: function (ids) { var arr = bigArr(ids); if (!arr.length) return Promise.reject(codedErr('INVALID_ARGUMENT', 'no ids')); return sendWrite('TYB721', function (c) { return c.refund(arr); }); },
    // value = ticketPrice × qty from a STRICT (proxy-only) read of THAT round — never from the page
    buyTickets: function (rid, qty) {
      var r = big(rid), q = big(qty);
      return strict(function (p) { return READS.getRound(p, r); }).then(function (round) {
        if (round.state !== 1n) throw seamRevert('WrongState', [], 'round is not open');
        return sendWrite('TYBGacha', function (c) { return c.buyTickets(r, q, { value: round.ticketPrice * q }); });
      });
    },
    withdraw: function () { return sendWrite('TYBGacha', function (c) { return c.withdraw(); }); },
    refundTicket: function (rid, pi) { return sendWrite('TYBGacha', function (c) { return c.refundTicket(big(rid), big(pi)); }); },
    claimPowerUps: function (rid, pi) { return sendWrite('TYBPowerUp1155', function (c) { return c.claimPowerUps(big(rid), big(pi)); }); },
    commitAttempt: function (tokenId, cat) { return sendWrite('TYBEvolution', function (c) { return c.commitAttempt(big(tokenId), big(cat)); }); },
    resolveAttempt: function (id) { return sendWrite('TYBEvolution', function (c) { return c.resolveAttempt(big(id)); }); },
    cancelAttempt: function (id) { return sendWrite('TYBEvolution', function (c) { return c.cancelAttempt(big(id)); }); },
    // FRHD burn (Ethereum) — burn.js gates isOnChain('ethereum') before each. approve = setApprovalForAll(helper,true)
    // (reversible); burnMany(ids) = the irreversible batch (helper reverts BadBatchSize for len 0 or >MAX_BATCH=2).
    frogApproveBurner: function () { return sendWrite('FRHD', function (c) { return c.setApprovalForAll(helperAddr(), true); }); },
    frogBurnMany: function (ids) { var arr = bigArr(ids); if (!arr.length) return Promise.reject(codedErr('INVALID_ARGUMENT', 'no Frog Heads selected')); return sendWrite('FrogHeadBulkBurner', function (c) { return c.burnMany(arr); }); }
  };
  // Pages use this to show "couldn't verify the on-chain state right now — nothing was sent" — TRUE only for a failure
  // of the STRICT pre-write read (phase-tagged above) or a reader that never came up. A transport error during the wallet
  // send is NOT a reader error (it carries `_pending` instead).
  function isReaderError(e) {
    if (!e) return false;
    if (e._strictRead) return true;
    return e.code === 'READER_DOWN' && !e._pending;
  }

  if (MODE === 'real') {
    // Kick the reader boot off at load (guests get 'live' reads + the watermark without any wallet). Failure is
    // recorded in readerStatus() and retried lazily by the next read; never thrown at load. (On a LAUNCH build the
    // reader is disabled at its choke point — ensureReader() above rejects READER_DOWN when CFG.launch.readerEnabled
    // === false — so this probe simply no-ops via its .catch; boot AND lazy reads both fail closed, no staging hit.)
    setTimeout(function () { ensureReader().catch(function () {}); }, 0);
    Object.keys(READS).forEach(function (name) {
      var body = READS[name];
      REAL[name] = function () { var args = Array.prototype.slice.call(arguments); return withReader(function (p) { return body.apply(null, [p].concat(args)); }); };
      STRICT[name] = function () { var args = Array.prototype.slice.call(arguments); return strict(function (p) { return body.apply(null, [p].concat(args)); }); };
    });
    Object.keys(WRITES).forEach(function (name) {
      REAL[name] = function () { var args = Array.prototype.slice.call(arguments); return Promise.resolve().then(function () { return WRITES[name].apply(null, args); }); };
    });
    // FRHD (Ethereum) reads: wired DIRECTLY (no Robinhood reader ladder; enum Worker fetch / wallet read). The
    // dispatcher below sets STRICT[name]=REAL[name] (no proxy ladder to strictly avoid). The FRHD writes already
    // went through the WRITES loop above (sendWrite → the wallet signer).
    Object.keys(FROG).forEach(function (name) {
      REAL[name] = function () { var args = Array.prototype.slice.call(arguments); return Promise.resolve().then(function () { return FROG[name].apply(null, args); }); };
    });
  }

  // ── dispatcher ──────────────────────────────────────────────────────────
  var API = {};
  Object.keys(SEAM_SPEC).forEach(function (name) {
    var kind = SEAM_SPEC[name].kind;
    if (MODE === 'real') {
      API[name] = REAL[name];
      if (!STRICT[name]) STRICT[name] = REAL[name]; // writes / deferred: same fail-closed body (no ladder involved)
    } else {
      API[name] = mockFor(name, kind);
      // mock mode: strict DELEGATES to TYB.call at call time (pages call TYB.strict.* in both modes; the page suites
      // monkeypatch TYB.call.getX for their re-validate fixtures and must see the patch through strict too).
      STRICT[name] = function () { return API[name].apply(null, arguments); };
    }
  });

  window.TYB = Object.freeze({
    MODE: MODE,
    SPEC: SEAM_SPEC,
    call: API,                    // TYB.call.getPhase(), TYB.call.refund(ids), ... (display reads ladder to the public RPC)
    strict: Object.freeze(STRICT),// TYB.strict.getX() — proxy-ONLY reads for the pre-write re-validation (never the fallback)
    liveStatus: liveStatus,       // { total, live, mock, misconfigured, deferred, perFn }
    fnLiveState: fnLiveState,
    setReaderChainId: setReaderChainId,
    readerStatus: readerStatus,   // { mode, chainId, degraded, primary, fallback, trustedReader, lastError } — 'tyb:reader' event on change
    isReaderError: isReaderError, // e → true when a (strict) read failed for transport reasons → "couldn't verify right now"
    seamRevert: seamRevert,       // exported so tests / the real body reuse the exact shape
    _real: REAL                   // the wiring surface (reads B3-1 + writes B3-2; deferred seams reject NotWired)
  });
})();
