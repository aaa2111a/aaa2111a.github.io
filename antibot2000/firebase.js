// firebase.js — Anti Bot 2000 frontend foundation.
// Config + App Check + RTDB reads + callable wrappers + render/URL helpers + the
// in-memory creator-code holder. Loaded as an ES module by each screen
// (`<script type="module">`). Firebase SDK pinned to a gstatic CDN version (no bundler).
//
// SECURITY (antibot2000-design.md §0 + the wiring brief / Brief #12):
//   - user strings render via textContent ONLY (never innerHTML) — see txt()/mk().
//   - URLs are built from a RE-VALIDATED handle/slug token with a HARDCODED https scheme
//     (the deferred audit P2-2 scheme-backstop lives here, not in the server _validText).
//   - the creator code lives in memory + a ONE-SHOT sessionStorage hand-off — NEVER a URL
//     (no history/referrer leak). Reads use only the 4 read:true RTDB paths; mutations are
//     callables (App Check token auto-attached).
//
// All config values here are PUBLIC (the Firebase web apiKey is not a secret; security is
// enforced by the RTDB/Storage rules + App Check + the CFs).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app-check.js';
import { getDatabase, ref, get, onValue, query, orderByChild, limitToLast }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';
import { getFunctions, httpsCallable }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js';

// ── config (all public) ──────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyADmI1q_-epIEOs4K-MepXyhZ9s2DUnSio', // gitleaks:allow — public Firebase web apiKey, NOT a secret (Firebase security = Rules + App Check, per the docs)
  authDomain: 'antibot2000-b6aae.firebaseapp.com',
  databaseURL: 'https://antibot2000-b6aae-default-rtdb.firebaseio.com',
  projectId: 'antibot2000-b6aae',
  storageBucket: 'antibot2000-b6aae.firebasestorage.app',
  messagingSenderId: '789771200512',
  appId: '1:789771200512:web:206db7ba6057f70d9790e5',
};
const RECAPTCHA_SITE_KEY = '6Ld9hjstAAAAAOdTBdqEZEUHv-tTQWmq3G1FH7ne';   // public site key (App Check) — gitleaks:allow (public by design; the SECRET key stays server-side)
const FN_REGION = 'us-central1';
// ⚠️ VERIFY against a real banner upload (Brief #13): new `.firebasestorage.app` buckets
// should work as the {bucket} in the download REST API, but some buckets need the GCS name
// `antibot2000-b6aae.appspot.com` instead. If banner <img> 404s, swap the bucket here (or
// switch to the Storage SDK getDownloadURL). Not a security issue — banners just won't show.
const STORAGE_DL = 'https://firebasestorage.googleapis.com/v0/b/' + firebaseConfig.storageBucket + '/o/';

const app = initializeApp(firebaseConfig);
// App Check — reCAPTCHA v3. All six callables use LIMITED-USE tokens (single-use → replay
// protection). Backend enforces consumeAppCheckToken (Batch 5 flips FN_OPTS; the 2 scans already
// consume). DEPLOYMENT PREREQUISITE (V22): set the reCAPTCHA v3 score threshold to 0.5 in the
// Firebase Console (App Check → Apps → [web app] → reCAPTCHA v3 → score threshold; default 0.0
// lets headless browsers ~0.1 through). Console-only — cannot be set in code.
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
const db = getDatabase(app);
const fns = getFunctions(app, FN_REGION);

// ── callable wrappers — all use limited-use App Check tokens (non-replayable, V21) ──────────────
const LU = { limitedUseAppCheckTokens: true };
const _createRoom        = httpsCallable(fns, 'createRoom',        LU);
const _checkEligibility  = httpsCallable(fns, 'checkEligibility',  LU);
const _joinRoom          = httpsCallable(fns, 'joinRoom',          LU);
const _closeRoom         = httpsCallable(fns, 'closeRoom',         LU);
const _downloadWhitelist = httpsCallable(fns, 'downloadWhitelist', LU);
const _lookupRoom        = httpsCallable(fns, 'lookupRoom',        LU);

export async function createRoom(data)               { return (await _createRoom(data)).data; }
export async function checkEligibility(roomId, wallet){ return (await _checkEligibility({ roomId, wallet })).data; }
export async function closeRoom(roomId, creatorCode) { return (await _closeRoom({ roomId, creatorCode })).data; }
export async function downloadWhitelist(roomId, creatorCode, format) {
  return (await _downloadWhitelist({ roomId, creatorCode, format })).data;
}
export async function lookupRoom(creatorCode)        { return (await _lookupRoom({ creatorCode })).data; }

// joinRoom auto-retries the RETRYABLE 'aborted' code (a concurrent same-wallet commit
// in flight — Brief #6b). Short backoff, ≤3 tries; any other error propagates.
export async function joinRoom(roomId, wallet, _tries = 0) {
  try { return (await _joinRoom({ roomId, wallet })).data; }
  catch (e) {
    if (e && e.code === 'functions/aborted' && _tries < 3) {
      await new Promise((r) => setTimeout(r, 400 * (_tries + 1)));
      return joinRoom(roomId, wallet, _tries + 1);
    }
    throw e;
  }
}

// ── RTDB reads — ONLY the 4 read:true paths (rooms/$id/meta·requirements·joinState,
// publicRooms). members/ etc. are read:false and never touched client-side. ───────
export async function getRoom(roomId) {
  const [m, q, j] = await Promise.all([
    get(ref(db, `rooms/${roomId}/meta`)),
    get(ref(db, `rooms/${roomId}/requirements`)),
    get(ref(db, `rooms/${roomId}/joinState`)),
  ]);
  if (!m.exists()) return null;
  return { meta: m.val(), requirements: q.val() || {}, joinState: j.val() || { count: 0 } };
}
export function watchJoinState(roomId, cb) {
  return onValue(ref(db, `rooms/${roomId}/joinState`), (s) => cb(s.val() || { count: 0 }));
}
// publicRooms grid. `field` ∈ {createdAt, closesAt, count} (the .indexOn). Returns an
// array of { id, ...projection }. `desc` = newest/most first (createdAt/count); for
// closesAt the screen wants soonest-first (ascending) → pass desc=false.
export function watchPublicRooms(field, n, desc, cb) {
  const q = query(ref(db, 'publicRooms'), orderByChild(field || 'createdAt'), limitToLast(n || 60));
  return onValue(q, (s) => {
    const arr = [];
    s.forEach((c) => { arr.push({ id: c.key, ...c.val() }); });   // ascending by `field`
    if (desc !== false) arr.reverse();                            // newest/most first
    cb(arr);
  });
}

// ── render helpers — textContent only (never innerHTML for user data) ──────────
export function txt(elm, s) { elm.textContent = (s == null ? '' : String(s)); return elm; }
// Contract: `attrs` values must be PRE-VALIDATED (href/src only via the URL builders
// below). mk is bulletproofed anyway (Brief #13): it DROPS any `on*` (inline event
// handler — use addEventListener) and any url-bearing attr whose value isn't https/
// relative/anchor (blocks javascript:/data:). textContent-only, never innerHTML.
const RX_URL_ATTR = /^(href|src|xlink:href|formaction|action|poster|background|ping)$/i;
// safe url schemes for href/src: absolute https, root/relative, anchor, mailto, document-
// relative *.html pages, AND clean folder URLs (room/?r=…, ../dashboard/?r=… — the reorg to
// folder/index.html). A dangerous scheme (javascript:/data:/vbscript:) has ':' before any
// '/?#', so it never matches the relative branches → still blocked. Brief #14/#21.
const RX_SAFE_URL = /^(https:\/\/|\/|#|mailto:|[\w.-]+\.html([?#]|$)|[\w.-]+\/)/;
export function mk(tag, opts) {
  const e = document.createElement(tag);
  if (opts) {
    if (opts.class != null) e.className = opts.class;
    if (opts.text != null) e.textContent = String(opts.text);
    if (opts.attrs) for (const k in opts.attrs) {
      if (/^on/i.test(k)) continue;                                   // never inline handlers
      const v = String(opts.attrs[k]);
      if (RX_URL_ATTR.test(k) && !RX_SAFE_URL.test(v)) continue;      // url attrs: safe schemes only
      e.setAttribute(k, v);
    }
    if (opts.kids) for (const c of opts.kids) if (c) e.appendChild(c);
  }
  return e;
}

// ── URL builders — re-validate the token client-side + hardcoded https scheme (P2-2).
// Return null on a bad token so the caller renders NO link (never a javascript:/data: URL).
const RX_HANDLE  = /^[A-Za-z0-9_]{1,15}$/;
const RX_OS_SLUG = /^[a-z0-9-]{1,80}$/;
const RX_BANNER  = /^banners\/[0-9a-f]{24}\/banner\.(png|jpg)$/;
export function twitterHref(handle) {
  return RX_HANDLE.test(handle) ? 'https://twitter.com/' + encodeURIComponent(handle) : null;
}
export function openSeaHref(slug) {
  return RX_OS_SLUG.test(slug) ? 'https://opensea.io/collection/' + encodeURIComponent(slug) : null;
}
// banner: a SERVER-derived Storage path → public download URL (storage.rules read:true).
export function bannerUrl(bannerPath) {
  return (typeof bannerPath === 'string' && RX_BANNER.test(bannerPath))
    ? STORAGE_DL + encodeURIComponent(bannerPath) + '?alt=media' : null;
}

// ── callable error → human message ─────────────────────────────────────────────
export function errMsg(e) {
  const code = (e && e.code) || '';
  const msg = (e && e.message) || '';
  switch (code) {
    case 'functions/permission-denied':  return 'Wrong code.';
    case 'functions/not-found':          return 'Room not found.';
    case 'functions/failed-precondition':return /full/i.test(msg) ? 'This room is full.' : 'This room has closed.';
    case 'functions/resource-exhausted': return 'Too many requests right now — try again in a moment.';
    case 'functions/unavailable':        return 'The wallet scan is temporarily unavailable — try again shortly.';
    case 'functions/invalid-argument':   return 'Something looks invalid — please review and retry.';
    case 'functions/aborted':            return 'A join is in progress — please retry.';
    default:                             return 'Something went wrong — please try again.';
  }
}

// ── creator code — in-memory + a ONE-SHOT sessionStorage hand-off; NEVER in a URL ──
let _code = null;
export function setCreatorCode(c) { _code = c || null; }
export function getCreatorCode()  { return _code; }
const STASH = 'abc_stash';
// stash on navigation to the dashboard; pop+delete immediately on arrival (minimize the
// window where it's in same-origin-readable storage). The dashboard then holds it in _code.
export function stashCode(c) { try { sessionStorage.setItem(STASH, c); } catch (_) { /* ignore */ } }
export function popStashedCode() {
  try {
    const c = sessionStorage.getItem(STASH);
    if (c != null) sessionStorage.removeItem(STASH);
    return c;
  } catch (_) { return null; }
}

export { app, db };
