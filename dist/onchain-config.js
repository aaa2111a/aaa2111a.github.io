/*
 * TYB — On-chain fact-sheet for the front's seam layer.
 * ---------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for the constants the mock seam (`tyb-chain.js`) serves
 * now and the real wiring will read post-deploy. Every value is a VERIFIED FACT
 * derived from the audited contracts (`Code/tyb-contracts/src/*`) or a known
 * chain param — never a design decision — so it is safe to fill ahead of wiring.
 *
 * MULTI-CHAIN by design (Le 2026-09-02): the front reads BOTH
 *   - Robinhood Chain (Arbitrum Orbit L2) — the TYB collection + gacha + evolution
 *   - Ethereum mainnet — Frog Heads (FRHD), shown ONLY on the burn/GTD page.
 * A chain SWITCH happens only when an ACTION needs it (burn→ETH, mint/refund/
 * gacha→Robinhood). Reads never force a switch.
 *
 * ⚠️ Anything `null`/TODO is NOT a fact yet (mainnet reader/proxy origin). Do NOT guess.
 *    B3-1 (2026-09-07) filled the rehearsal-3 testnet addresses + readers and flipped SEAM_MODE
 *    to 'real' (reads live; writes wired in B3-2). Mainnet = swap addresses/readers/activeEnv.
 *
 * Exposed as a frozen global `window.TYB_ONCHAIN` (classic script, file://-safe).
 */
(function () {
  'use strict';

  var TYB_ONCHAIN = Object.freeze({
    // ── seam mode ──────────────────────────────────────────────────────────
    // 'mock'  → tyb-chain.js serves fixtures; '?scenario=' is honoured.
    // 'real'  → tyb-chain.js calls the chain; '?scenario=' is INERT; an un-wired
    //           write THROWS (never simulates success). Flip this at wiring.
    SEAM_MODE: 'real', // B3-1 (2026-09-07): reads LIVE against the rehearsal-3 stack via the rpc-proxy; writes land in B3-2.

    // Which Robinhood environment the READER targets and the WRITE actions lazy-switch the wallet to.
    // 'mainnet' (4663) for launch · 'testnet' (46630) for the rehearsal. LIVE_FNS accepts EITHER id for
    // reads; this steers the reader URLs (readers[env]) + wallet_switch/addEthereumChain.
    activeEnv: 'testnet',

    // ── LAUNCH PHASE (public pre-mint upload) ────────────────────────────────
    // Ships the page with ONLY the FRHD burn (GTD) + the connect-free checker live; every other flow
    // is greyed/disabled. Le flips these to light phases up later (one config edit, no code change).
    //  - enabledActions: the ONLY data-actions the shared router + app-bar honour; anything NOT listed
    //    renders greyed (.is-gated + native `disabled`) and the router no-ops it. gtd → burn.html.
    //  - readerEnabled:false → tyb-chain refuses to boot the Robinhood/TYB reader at ALL (the boot probe AND
    //    every lazy read reject READER_DOWN) so a PUBLIC origin never touches the staging Worker — even a
    //    direct-URL visit to a gated page fails closed instead of leaking. FRHD reads (enum Worker + wallet)
    //    dispatch directly, never through this reader, so the burn/GTD path is unaffected.
    //    showLiveWatermark:false hides the internal "N/M live" app-bar chip.
    //  - docsVersion: the visible, hand-bumped docs version stamp (NEVER a date — the launch is date-free).
    launch: Object.freeze({
      enabledActions: Object.freeze(['gtd', 'connect', 'disconnect']),
      readerEnabled: false,
      showLiveWatermark: false,
      docsVersion: 'v1.0',
      // Evolution is deferred (post-reveal). While false, the docs Evolution section shows a blurred
      // "To be announced" teaser AND the evolution-only FAQ ("Can I max out a trait?") stays hidden.
      // Flip to true to ANNOUNCE — docs.js un-blurs Evolution + reveals that FAQ in one place, no other edit.
      evolutionAnnounced: false,
      // ── Burn counter (burn.html, CONNECT-FREE, NO bot): a progress bar "<burned> / burnGoal burned". burn.js
      //    reads FRHD.totalSupply() live via the enum Worker /rpc and computes burned = burnBaselineSupply −
      //    live, clamped ≥ 0 (the bar caps at 100%). It is a COSMETIC read — a Worker hiccup just hides the bar.
      //    burnBaselineSupply = FRHD totalSupply AT CAMPAIGN START. Le's 2 burns (2026-09-08) already dropped
      //    it 6056 → 6054, so 6054 = the LAUNCH baseline (counter starts at 0 — "his 2 not counted", Le). ⚠️
      //    RE-SNAPSHOT this on go-live day to the real supply at open. FOR THE LIVE TEST set it to 6056 so the
      //    counter shows Le's 2 existing burns ("2 / 1000") + a 3rd wallet burn → "3 / 1000", then reset.
      burnBaselineSupply: 6058, // = FRHD totalSupply BEFORE the campaign burns. live=6052 on 2026-09-11 + Le's 6 burns (3 wallets × 2, per the from-0 GTD dry-run) = 6058 → counter reads 6 and counts UP as the public burns. ⚠️ Le 2026-09-11: the bar COUNTS his burns (should show 6, not 0) — do NOT re-snapshot to go-live-day supply (that would bake the 6 into the baseline and zero the bar). This baseline is FIXED at pre-campaign supply so ALL campaign burns (Le's + public) count toward burnGoal. Verify live via the enum Worker /rpc totalSupply (0x18160ddd → to FRHD).
      burnGoal: 1000,
      // ── ANNOUNCED mint plan (DOCS ONLY — Le 2026-09-10). This is the PLANNED phase model shown in docs.html;
      //    it is NOT yet on-chain. The deployed/rehearsal TYB721 still has phases [GTD,FCFS,Public] and caps at
      //    collection.maxPerWallet (2) across ALL phases. Adding the Frenzy phase + raising the cap to 6 is a
      //    LATER contract change (Le: "no cambiar el contrato ahora, sólo el doc"). Keep collection.maxPerWallet
      //    at the on-chain 2; the docs read the raised cap from here. When the contract is updated, reconcile.
      //    Model: GTD + FCFS share a 2/wallet cap; Frenzy (new, between FCFS and Public) raises it to 6 (4 more
      //    if you already minted 2); Public is up to 6.
      mintPlan: Object.freeze({
        phases: Object.freeze(['GTD', 'FCFS', 'Frenzy', 'Public']),
        walletCapMax: 6   // per-wallet total once Frenzy opens (GTD+FCFS stay at collection.maxPerWallet=2)
      })
    }),

    // ── READERS (B3): wallet-INDEPENDENT read endpoints per env. primary = the key-hiding rpc-proxy Worker
    //    (POST-only, methods allowlisted, eth_call.to pinned to our addresses, batch ≤20, 503 on rate-limit trip);
    //    fallback = the chain's public RPC (rate-limited, CORS *). tyb-chain.js ladders primary→fallback ONCE on a
    //    TRANSPORT failure (5xx/network/timeout) — never on a revert (CALL_EXCEPTION) nor on a 403/400 from the
    //    proxy (that means OUR pin is wrong → surface loudly). `TYB.strict.*` reads use primary ONLY (pre-write
    //    re-validation must never trust the un-pinned public RPC). Ethereum has no reader yet (burn page deferred).
    readers: Object.freeze({
      robinhood: Object.freeze({
        testnet: Object.freeze({
          primary: 'https://tyb-rpc-proxy-staging.prodninobestia.workers.dev',
          fallback: 'https://rpc.testnet.chain.robinhood.com'
        }),
        mainnet: Object.freeze({
          primary: null,   // TODO at launch: the prod rpc-proxy Worker origin (Code/tyb-rpc-proxy/wrangler.toml)
          fallback: 'https://rpc.mainnet.chain.robinhood.com' // CORS for browsers UNVERIFIED — probe before flipping activeEnv
        })
      })
    }),

    // ── DEFERRED seams: these SEAM_SPEC fns are reported in liveStatus().deferred (not as an alarming
    //    'misconfigured'). Two kinds live here: (1) genuinely not-yet-wired seams whose real body rejects
    //    NotWired (getInstantIds, getFcfsEligibility); (2) OFF-CHAIN seams that ARE wired but light up at
    //    RUNTIME (their body sets _wired on first call) — so on a page that never calls them they stay
    //    'deferred' rather than alarming as a config gap. The FRHD burn reads (getFrogHeads via the enum
    //    Worker, getFrogOwners via the ownerOf /rpc, getGtdEligibility via check-list.json) are wired here as
    //    (2) — they go 'live' on burn.html after the first read. The FRHD WRITES + getFrogApproval are
    //    address-gated (not here): 'live' once frhd + frogHeadBulkBurner are set. Anything ELSE that computes
    //    'misconfigured' is a real wiring gap and stays alarming.
    deferredFns: Object.freeze({
      getInstantIds:        'instant ticket ids need the bot ticketIds fn + App Check + Firebase SDK (post-rehearsal chunk)',
      getFcfsEligibility:   'FCFS proofs come from Le\'s list (post-rehearsal); the connect-free checker covers FCFS via check-list.json',
      getFrogHeads:         'off-chain (enum Worker): wired — goes live once burn.html calls it',
      getFrogOwners:        'off-chain (ownerOf /rpc): wired — goes live during a burn (pre-write re-validation of the selected ids)',
      getGtdEligibility:    'off-chain (check-list.json snapshot): wired — goes live once burn.html calls it; swap the list on burn day',
      getFrhdTotalSupply:   'off-chain (FRHD totalSupply via the enum Worker /rpc): wired — goes live once burn.html renders the connect-free burn counter'
    }),

    // ── chains ─────────────────────────────────────────────────────────────
    chains: Object.freeze({
      robinhood: Object.freeze({
        name: 'Robinhood Chain',
        chainId: 4663,
        chainIdHex: '0x1237',
        rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
        explorer: 'https://robinhoodchain.blockscout.com',
        nativeCurrency: Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 }),
        testnet: Object.freeze({
          name: 'Robinhood Chain Testnet',
          chainId: 46630,
          chainIdHex: '0xB626',
          rpcUrl: 'https://rpc.testnet.chain.robinhood.com', // read-only reader; verify reachability at chunk 2
          explorer: null
        })
      }),
      ethereum: Object.freeze({
        name: 'Ethereum',
        chainId: 1,
        chainIdHex: '0x1',
        rpcUrl: null, // TODO: read-only RPC for Frog Heads reads (Alchemy/public). Fill at the burn-page chunk.
        explorer: 'https://etherscan.io',
        nativeCurrency: Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 })
      })
    }),

    // ── deployed addresses (TYB = NOT deployed; FRHD = live) ────────────────
    addresses: Object.freeze({
      // Robinhood (TYB) — REHEARSAL-3 stack on testnet 46630 (S1, 2026-09-07; design §0.13). MAINNET: replace all 5 in
      // ONE pass together with the rpc-proxy ALLOWED_ADDRESSES, the bot .env and the gateway TYB_EVOLUTION (RUNBOOK §10).
      tyb721: '0xEe48F3d4c120A62df34785e94e82983a653808E5',         // TYB721.sol (session-2 instance, kept; cap 4 there — mainnet cap 2)
      tybGacha: '0x6cbD156E82448751203598B1A7b226B1013D717d',       // TYBGacha.sol (fast-path build)
      tybPowerUp1155: '0xc670DC132196Da3A0d928124d403C9C3eDF508e0', // TYBPowerUp1155.sol
      tybEvolution: '0xB2deF970b0C6CbFAb6791407e23275Ba08c30437',   // TYBEvolution.sol
      tybRenderer: '0x4988c97ec1824Fc2Ca1CBCdb0C3a62CE225D5Ac4',    // TYBRenderer.sol (session-2 instance, kept; gwBase = staging gateway)
      // Ethereum (Frog Heads / GTD burn)
      frhd: '0x95A57EFF2bd0afaAa3898273c7a3213855541710', // FRHD token (ERC721A), LIVE on ETH mainnet
      frogHeadBulkBurner: '0x404d5B637F96Ff6F707F372b73224606E0B16D73' // FrogHeadBulkBurner.sol helper — DEPLOYED to ETH mainnet + Etherscan-verified 2026-09-08 (ownerless, hash-diff MATCH). burnMany(ids<=2).
    }),

    // ── TYB721 collection (verified: TYB721.sol) ────────────────────────────
    collection: Object.freeze({
      chain: 'robinhood',
      maxSupply: 4444,             // MAX_SUPPLY — ids are 1..4444
      firstTokenId: 1,             // _startTokenId()
      price: '0.002',              // PRICE (ether)
      priceWei: '2000000000000000',
      maxPerWallet: 2,             // MAX_PER_WALLET — total across ALL phases AND per-tx cap (Le 2026-09-07: 4 → 2; mainnet bytecode.
                                   // ⚠ the testnet TYB721 above still has 4 — its mint is Closed, so the front never exercises it)
      refundBps: 8500,             // 85% blind refund
      refundPerToken: '0.0017',    // REFUND_PER_TOKEN (ether)
      refundPerTokenWei: '1700000000000000',
      refundWindowSecs: 259200,    // ANNOUNCED refund window for docs display ONLY (Le's launch plan) — NOT an
                                   // on-chain constant: refund is function-controlled (openRefund/closeRefund),
                                   // duration is whatever Le sets between the two calls. Set to match the tweet.
      royaltyBps: 500,             // ERC-2981 default royalty = 5%
      // Phase enum is on-chain-significant (advancePhase is one-way). Index = value.
      phases: Object.freeze(['Setup', 'GTD', 'FCFS', 'Public', 'Closed']),
      // BOTH GTD and FCFS are Merkle-gated (verified: mintGtd L213 / mintFcfs L222).
      //   mintGtd(qty, allowedQty, proof) — leaf keccak(abi.encode(addr, allowedQty)), OZ double-hash
      //   mintFcfs(qty, proof)            — leaf keccak(abi.encode(addr)),           OZ double-hash
      //   mintPublic(qty)                 — no proof
      gtdLeaf: 'keccak256(abi.encode(address, allowedQty))',
      fcfsLeaf: 'keccak256(abi.encode(address))',
      tokenUriShape: 'renderer.gwBase + "/meta/" + id (revealed+renderer); else unrevealedURI'
    }),

    // ── TYBGacha (REGENERATED from TYBGacha.sol — replaces the old TYBRaffle) ─
    gacha: Object.freeze({
      chain: 'robinhood',
      ticketUsd: '0.50',               // each ticket = $0.50-in-ETH; ticketPrice is per-round (wei)
      maxTicketsPerTx: 20,             // MAX_TICKETS_PER_TX
      maxWinners: 256,                 // MAX_WINNERS
      maxSalesWindowSecs: 2592000,     // MAX_SALES_WINDOW = 30 days
      revealWindowSecs: 86400,         // REVEAL_WINDOW = 1 day (operator must reveal after close)
      winnerClaimWindowSecs: 86400,    // WINNER_CLAIM_WINDOW = 24 hours — permissionless BACKSTOP settle window after reveal
      // Operator FAST-PATH (TYBGacha 2026-09-05, live in the rehearsal-3 gacha): the bot's submit/attest arms a shorter
      // finalize window; a valid lower-nonce submit by anyone disarms it back to the 24 h backstop. MIN_SETTLE_BLOCKS always.
      operatorFastWindowSecs: 900,     // OPERATOR_FAST_WINDOW = 15 min after the operator registered a winner
      noWinnerFastWindowSecs: 3600,    // NO_WINNER_FAST_WINDOW = 1 h after the operator attested "no winner"
      minSettleBlocks: 1000,           // MIN_SETTLE_BLOCKS (L2-block floor)
      dustGraceSecs: 31536000,         // DUST_GRACE = 365 days
      sweepGraceSecs: 7776000,         // SWEEP_GRACE = 90 days
      // Round.state enum, on-chain-significant. Index = value.
      states: Object.freeze(['None', 'Open', 'SalesClosed', 'Resolved', 'Refunded']),
      arbSysAddress: '0x0000000000000000000000000000000000000064',
      // The house shows each ticket's drawn id INSTANTLY off-chain during Open; the seedCommit binds
      // them (verifiable at reveal). The front NEVER reimplements the Feistel `ticketId` in JS — it is
      // read via the `ticketId(roundId,purchaseIndex,nonceOffset)` view, and only post-Resolved.
      instantIdDisplay: true,          // Le: include the off-chain instant-id display seam
      exposeSelfServeSettle: false,    // Le: do NOT expose submitWinningTicket/finalizeWinner in the UI
      // winning ids are read via winningIdsOf(roundId); rounds(id) auto-getter EXCLUDES the winningIds[].
      note: 'a ticket pays the CURRENT holder of the id it draws; withdraw() is a unified pull'
    }),

    // ── TYBPowerUp1155 (verified: TYBPowerUp1155.sol) ───────────────────────
    powerUps: Object.freeze({
      chain: 'robinhood',
      categories: 5,                   // N
      // claimPowerUps(roundId, purchaseIndex) — a MINT (ERC-1155), gated winnerFinalized AND in-play
      // (startNonce <= winningNonce). Errors: RoundNotFinalized / NotInPlay / AlreadyClaimed / EmptyPurchase.
      claimNote: 'gacha purchases mint power-ups; power-ups are burned to fuel evolution'
    }),

    // ── TYBEvolution (★ re-verified byte-for-byte vs TYBEvolution.sol at chunk 8, 2026-09-02) ─
    evolution: Object.freeze({
      chain: 'robinhood',
      categories: 5,                   // N=5 (TYBEvolution.sol:49); levelsOf(tokenId) → uint8[5]
      levels: Object.freeze([0, 1, 2]),// on-chain level; UI Tier = level + 1
      maxLevel: 2,                     // MaxLevel: `if (lvl >= 2) revert MaxLevel()` (:125) — level 2 = Tier 3 = top
      cancelDeadlineSecs: 7776000,     // CANCEL_DEADLINE = 90 days (:50); cancel only if pinned round !Resolved AND elapsed
      // commit→resolve odds (verified @ TYBEvolution.sol:162 — divisor = targetLvl==1 ? 10 : 20):
      //   targetLvl 1 = reach level 1 (Tier 2) = 1/10 · targetLvl 2 = reach level 2 (Tier 3) = 1/20
      odds: Object.freeze({ toLevel1: '1/10', toLevel2: '1/20' }),
      note: 'commitAttempt(tokenId,category)->attemptId · resolveAttempt(id) · cancelAttempt(id); ' +
            'burns power-ups; discover attempts via nextAttemptId + attempts(i) filtered !settled'
    }),

    // ── TYBRenderer (verified: TYBRenderer.sol) ─────────────────────────────
    renderer: Object.freeze({
      chain: 'robinhood',
      gwBase: 'https://tyb-gateway-staging.prodninobestia.workers.dev', // owner-set ORIGIN (setGwBase), no trailing slash. INFORMATIONAL for
                                       // the front: metaUrl comes from TYB721.tokenURI(id) (authoritative; renderer may be rotated/off).
      metaPath: '/meta/',              // tokenURI = gwBase + "/meta/" + id
      categoryLabels: Object.freeze(['Category 1', 'Category 2', 'Category 3', 'Category 4', 'Category 5']),
      tierFormula: 'attribute "<label> Tier" = on-chain level + 1',
      // ⚠️ gwBase JSON (name/description/attributes) is fetched + rendered by the FRONT → render it with
      //    the XSS-safe builder (tyb-render.js), NEVER innerHTML. "cosmetic on-chain" != safe in the DOM.
      xssNote: 'render all gateway JSON via tyb-render.txt/el only'
    }),

    // ── Frog Heads / FRHD (Ethereum; burn/GTD page ONLY — never in TYB inventory) ─
    frogHeads: Object.freeze({
      chain: 'ethereum',
      token: '0x95A57EFF2bd0afaAa3898273c7a3213855541710', // FRHD, ERC721A, burn(uint256)=0x42966c68
      // Key-hiding enum proxy Worker (Code/frhd-enum-proxy/): GET /enum?owner=..&pageKey=.. (holder's FRHD ids,
      // paginated, Alchemy key hidden) + POST /rpc (eth_call PINNED to FRHD ownerOf — the fresh pre-burn re-read).
      // CORS echoes the burn page origin (denpaclub.app + localhost:8844). NO frontend redeploy on key rotation.
      enumWorker: 'https://frhd-enum.prodninobestia.workers.dev',
      // Burn flow (via the helper): FRHD.setApprovalForAll(helper, true) once, then helper.burnMany(ids).
      burnHelperFn: 'burnMany(uint256[] ids)',
      maxBatch: 2, // FrogHeadBulkBurner.MAX_BATCH — chunk the burn ≤2/tx; >2 or 0 reverts BadBatchSize (Le 2026-09-07: 4 → 2 = GTD cap)
      // FRHD is base ERC721A (NO tokensOfOwner): enumerate off-chain (baked owner snapshot / ownerOf sweep).
      // Burning FRHD → snapshot (Transfer→0x0) → Merkle root → the GTD allowlist the mint modal reads.
      separation: 'Frog Heads appear ONLY on the burn/GTD page; NEVER in the TYB inventory grid.'
    })
  });

  if (typeof window !== 'undefined') window.TYB_ONCHAIN = TYB_ONCHAIN;
  if (typeof module !== 'undefined' && module.exports) module.exports = TYB_ONCHAIN;
})();
