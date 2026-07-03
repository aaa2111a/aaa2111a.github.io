// room.js — Anti Bot 2000 room page (scan + join). The MOST security-sensitive
// screen, but USERS-ONLY: it reads ONLY the 4 public RTDB paths (getRoom +
// watchJoinState) and calls ONLY the two user-facing scan callables
// (checkEligibility / joinRoom). NEVER a management affordance — no
// closeRoom/downloadWhitelist/lookupRoom, never reads members/, the creator code
// never appears here. Every user string renders via txt()/mk() (textContent);
// every href via the re-validating builders. The only innerHTML is icon() with a
// compile-time-constant SVG. ES module; imports the foundation from ./firebase.js.
import {
  getRoom, watchJoinState, checkEligibility, joinRoom,
  twitterHref, openSeaHref, bannerUrl, txt, mk, errMsg,
} from '../firebase.js';

const RX_ROOM_ID = /^[0-9a-f]{24}$/;     // _genRoomId = 12 bytes → 24 lowercase hex
const RX_ADDR    = /^0x[0-9a-fA-F]{40}$/;

// ── theme toggle ─────────────────────────────────────────────────────────────
const body = document.body, tglBtn = document.getElementById('tgl');
if (tglBtn) tglBtn.addEventListener('click', () => {
  body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ── roomId from the URL (the ONLY thing a share link carries; never the code) ──
const roomId = new URLSearchParams(location.search).get('r') || '';

// ── constant SVGs (icon() injects these — never user data) ────────────────────
const OK_SVG    = '<svg width="13" height="13" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor" fill="none"><path d="M5 12l5 5 9-11"/></svg>';
const NO_SVG    = '<svg width="13" height="13" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ARROW_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"><path d="M7 17L17 7M9 7h8v8"/></svg>';
// icon(): innerHTML with a COMPILE-TIME-CONSTANT SVG string ONLY → no XSS.
function icon(constSvg) { const s = document.createElement('span'); s.innerHTML = constSvg; return s.firstChild; }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// ── element handles ──────────────────────────────────────────────────────────
const headSec = document.getElementById('headSec');
const reqSec  = document.getElementById('reqSec');
const scanSec = document.getElementById('scanSec');
const notFnd  = document.getElementById('notfound');
const elBanner = document.getElementById('banner');
const elBadge  = document.getElementById('badge');
const elBadgeL = document.getElementById('badgeLabel');
const elNm     = document.getElementById('nm');
const elBy     = document.getElementById('by');
const elLinks  = document.getElementById('links');
const elDesc   = document.getElementById('desc');
const elChips  = document.getElementById('chips');
const elCnt    = document.getElementById('cnt');
const elCap    = document.getElementById('cap');
const elBar    = document.getElementById('bar');
const elCd     = document.getElementById('cd');
const addr     = document.getElementById('addr');
const check    = document.getElementById('check');
const scanning = document.getElementById('scanning');
const reveal   = document.getElementById('reveal');
const qhead    = document.getElementById('qhead');
const res      = document.getElementById('res');
const done     = document.getElementById('done');
const doneTxt  = document.getElementById('doneTxt');
const scanErr  = document.getElementById('scanErr');

let META = null, CAP = 0, CLOSED = false, curCount = 0;
let state = 'idle', curWallet = '';   // idle | scanning | pass | fail | joining | done
let revealTimers = [], scanSeq = 0;   // cancellable reveal-animation timers + a scan-supersede token
function clearRevealTimers() { for (const t of revealTimers) clearTimeout(t); revealTimers = []; }

// ── countdown / formatting (textContent only) ────────────────────────────────
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor((Number(ms) - Date.now()) / 1000));
  if (s <= 0) return 'closed';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm left'
              : m + 'm ' + String(x).padStart(2, '0') + 's left';
}
function roomState() {
  if (!META) return ['open', 'Open'];
  if (META.status === 'closed' || Date.now() >= Number(META.closesAt)) return ['full', 'Closed'];
  if (CAP > 0 && curCount >= CAP) return ['full', 'Full'];
  if (CAP > 0 && curCount / CAP > 0.9) return ['soon', 'Filling'];
  return ['open', 'Open'];
}

// ── error banner ─────────────────────────────────────────────────────────────
function flagErr(msg) { if (scanErr) { txt(scanErr, msg); scanErr.classList.add('on'); } }
function clearErr() { if (scanErr) { txt(scanErr, ''); scanErr.classList.remove('on'); } }

// ── requirement chips (pre-scan, from requirements + meta) ───────────────────
function chip(label, tip) {
  const c = mk('span', { class: 'chip', attrs: { tabindex: '0' } });
  c.appendChild(document.createTextNode(label));
  if (tip) c.appendChild(mk('span', { class: 'tip', text: tip }));
  return c;
}
function renderChips(req, meta) {
  clear(elChips);
  const r = req || {}, f = r.filters || {};
  const ah = Number(r.minAvgHoldDays) || 1;
  elChips.appendChild(chip('Avg hold ≥ ' + ah + 'd',
    'Keeps its mints ~' + ah + ' days on average — not a quick flipper.'));
  if (Number(r.minWalletAgeDays) > 0)
    elChips.appendChild(chip('Wallet age ≥ ' + r.minWalletAgeDays + 'd',
      'The wallet must be at least ' + r.minWalletAgeDays + ' days old — filters fresh burners.'));
  if (Number(r.minMints) > 0)
    elChips.appendChild(chip('Mints ≥ ' + r.minMints, 'Has minted at least ' + r.minMints + ' NFTs.'));
  if (Number(r.minTx) > 0)
    elChips.appendChild(chip('Transactions ≥ ' + r.minTx, 'Has sent at least ' + r.minTx + ' transactions.'));
  if (Number(r.minDistinct) > 0)
    elChips.appendChild(chip('Distinct ≥ ' + r.minDistinct,
      'Has minted from at least ' + r.minDistinct + ' different collections.'));
  if (Number(r.minActiveMonths) > 0)
    elChips.appendChild(chip('Active ≥ ' + r.minActiveMonths + ' mo',
      'Has on-chain activity across at least ' + r.minActiveMonths + ' different months.'));
  if (Number(r.minDiamondPct) > 0)
    elChips.appendChild(chip('Diamond ≥ ' + r.minDiamondPct + '%',
      'Still holds at least ' + r.minDiamondPct + '% of what it minted.'));
  if (r.holdCollectionAddr)
    elChips.appendChild(chip('Must-hold', 'Must currently hold a specific collection.'));
  if (f.paidOnly)
    elChips.appendChild(chip('Paid mints only', 'Only paid mints count toward the requirements — free mints are ignored.'));
  if (Number(f.recencyDays) > 0)
    elChips.appendChild(chip('Ignore fresh activity', 'Only on-chain activity older than ' + f.recencyDays + ' days counts — mints or collections first seen in the last ' + f.recencyDays + ' days are ignored.'));
  const alloc = Number(meta && meta.perWalletLimit) || 1;
  elChips.appendChild(chip(alloc + ' per wallet', alloc + ' whitelist spot' + (alloc === 1 ? '' : 's') + ' per wallet.'));
}

// ── verdict rows (post-scan, from the checkEligibility/joinRoom verdicts) ──────
const LABELS = {
  avgHold: 'Average hold', age: 'Wallet age', mints: 'Mints', tx: 'Transactions',
  distinct: 'Distinct collections', activeMonths: 'Active months',
  diamond: 'Diamond hands', mustHold: 'Holds collection',
};
function unitWord(u, n) {
  if (u === 'd') return n === 1 ? ' day' : ' days';
  if (u === 'mo') return ' mo';
  if (u === '%') return '%';
  return u ? ' ' + u : '';
}
function fmtVal(v) {
  if (v.value == null) return v.note || '—';
  if (typeof v.value === 'string') return v.value;            // e.g. 'contract'
  return String(v.value) + unitWord(v.unit, v.value);
}
function needTxt(v) {
  const u = v.unit === 'd' ? ' days' : v.unit === 'mo' ? ' months' : v.unit === '%' ? '%' : '';
  return 'needs ≥ ' + v.threshold + u;
}
function verdictRow(v) {
  const ql = mk('div', { class: 'ql' });
  ql.appendChild(mk('b', { text: LABELS[v.key] || String(v.key) }));
  ql.appendChild(mk('span', { text: needTxt(v) }));
  const qv = mk('span', { class: 'qv', text: fmtVal(v) });
  const qs = mk('span', { class: 'qs ' + (v.pass ? 'ok' : 'no'), kids: [icon(v.pass ? OK_SVG : NO_SVG)] });
  const qright = mk('div', { class: 'qright', kids: [qv, qs] });
  const row = mk('div', { class: 'qrow', kids: [ql, qright] });
  return row;
}
// render the rows, stagger their reveal; return the ms after which the last row shows.
function renderVerdicts(list) {
  clear(res);
  const arr = Array.isArray(list) ? list : [];
  arr.forEach((v, i) => {
    const row = verdictRow(v);
    if (i === arr.length - 1) row.style.borderBottom = 'none';
    res.appendChild(row);
    revealTimers.push(setTimeout(() => row.classList.add('show'), 120 + i * 200));
  });
  return 120 + arr.length * 200;
}

// ── head / links / stats ──────────────────────────────────────────────────────
function linkPill(label, href) {
  const a = mk('a', { class: 'lk', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
  a.appendChild(document.createTextNode(label + ' '));
  a.appendChild(icon(ARROW_SVG));
  return a;
}
function renderHead() {
  txt(elNm, META.title || 'Untitled room');
  if (META.twitterHandle) { txt(elBy, 'by @' + META.twitterHandle); elBy.style.display = ''; }
  else elBy.style.display = 'none';

  const bUrl = bannerUrl(META.bannerPath);                    // null unless a valid server path
  if (bUrl) elBanner.style.backgroundImage = 'url("' + bUrl + '")';   // else keep the CSS gradient

  clear(elLinks);
  const tw = twitterHref(META.twitterHandle);
  if (tw) elLinks.appendChild(linkPill('Twitter', tw));
  const os = openSeaHref(META.openSeaSlug);
  if (os) elLinks.appendChild(linkPill('OpenSea', os));
  elLinks.style.display = (tw || os) ? '' : 'none';

  if (META.description) { txt(elDesc, META.description); elDesc.style.display = ''; }
  else elDesc.style.display = 'none';
}
function renderStats() {
  const [stCls, stLabel] = roomState();
  txt(elCnt, String(curCount));
  txt(elCap, ' / ' + CAP + ' spots');
  const pct = CAP > 0 ? Math.min(100, Math.round(curCount / CAP * 100)) : 0;
  elBar.style.width = pct + '%';
  elBadge.className = 'badge ovr ' + stCls;
  txt(elBadgeL, stLabel);
}

// ── scan flow ─────────────────────────────────────────────────────────────────
function resetBtn() { check.className = 'btn btn-primary'; check.textContent = 'Check'; check.disabled = false; }
function clearOut() {
  clearRevealTimers();
  scanning.classList.remove('on');                 // clearOut owns the full scan-output teardown (Brief #15b P3)
  reveal.classList.remove('open');
  qhead.className = 'qhead'; txt(qhead, '');
  done.classList.remove('show');
  clear(res);
}
function resetAll() { state = 'idle'; scanSeq++; resetBtn(); clearOut(); clearErr(); }   // scanSeq++ invalidates any in-flight scan

async function runScan() {
  const w = (addr.value || '').trim();
  if (!RX_ADDR.test(w)) { addr.focus(); flagErr('Enter a valid wallet address (0x…).'); return; }
  clearErr();
  state = 'scanning'; curWallet = w;
  const mySeq = ++scanSeq;                                    // this scan's token; a newer scan/reset supersedes it
  check.className = 'btn btn-primary'; check.disabled = true; check.textContent = 'Scanning…';
  clearOut(); scanning.classList.add('on');
  try {
    const r = await checkEligibility(roomId, w);
    if (mySeq !== scanSeq) return;                            // superseded — the newer scan/reset owns the UI
    scanning.classList.remove('on');
    const eligible = !!(r && r.eligible);
    txt(qhead, eligible ? 'You are qualified' : 'This wallet doesn’t qualify');
    qhead.className = 'qhead ' + (eligible ? 'ok' : 'no');
    reveal.classList.add('open');
    const after = renderVerdicts(r && r.requirements);
    revealTimers.push(setTimeout(() => {
      check.disabled = false;
      if (eligible) { state = 'pass'; check.className = 'btn btn-ok'; check.textContent = 'Join'; }
      else { state = 'fail'; check.className = 'btn btn-no'; check.textContent = 'Go away bot'; }
    }, after + 120));
  } catch (e) {
    if (mySeq !== scanSeq) return;                            // superseded — don't clobber the newer scan
    scanning.classList.remove('on');
    state = 'idle'; resetBtn(); flagErr(errMsg(e));
  }
}

async function doJoin() {
  state = 'joining'; check.disabled = true; check.textContent = 'Joining…'; clearErr();
  try {
    const r = await joinRoom(roomId, curWallet);
    if (r && r.joined) {
      state = 'done'; check.className = 'btn btn-ok'; check.textContent = 'Joined'; check.disabled = true;
      const cap = Number(r.capacity) || CAP;
      txt(doneTxt, (r.already ? 'You’re already in' : 'You’re in') + ' — spot #' + r.spot + (cap ? ' / ' + cap : ''));
      done.classList.add('show');
    } else {
      // joined:false, eligible:false — wallet state / locked requirements changed
      // between the check and the join. Re-render the (authoritative) verdicts.
      state = 'fail'; check.className = 'btn btn-no'; check.textContent = 'Go away bot'; check.disabled = false;
      txt(qhead, 'This wallet doesn’t qualify'); qhead.className = 'qhead no';
      renderVerdicts(r && r.requirements);
      flagErr('This wallet no longer qualifies.');
    }
  } catch (e) {
    // room precondition (full / closed / rate / budget) — stay on Join so a retry is possible.
    state = 'pass'; check.className = 'btn btn-ok'; check.textContent = 'Join'; check.disabled = false;
    flagErr(errMsg(e));
  }
}

if (check) check.addEventListener('click', () => {
  if (CLOSED) return;
  if (state === 'idle') runScan();
  else if (state === 'pass') doJoin();
  else if (state === 'fail') { check.classList.remove('shake'); void check.offsetWidth; check.classList.add('shake'); }
});
if (addr) {
  addr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && state === 'idle') runScan(); });
  addr.addEventListener('input', () => { if (state === 'pass' || state === 'fail') resetAll(); });
}

// ── chip tooltips on touch (desktop = :hover/:focus; mobile = tap toggles .show) ──
// Attached ONCE here (NOT inside renderChips → no per-render listener stacking, Brief #18).
if (elChips) elChips.addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  e.stopPropagation();                                       // so the document click-away doesn't immediately re-hide it
  const shown = c.classList.contains('show');
  for (const x of elChips.querySelectorAll('.chip.show')) x.classList.remove('show');
  if (!shown) c.classList.add('show');                       // tap a shown chip → hide; tap a new one → switch
});
document.addEventListener('click', () => {                   // tap anywhere else → dismiss
  if (elChips) for (const x of elChips.querySelectorAll('.chip.show')) x.classList.remove('show');
});

// ── not-found ──────────────────────────────────────────────────────────────────
function showNotFound() {
  for (const s of [headSec, reqSec, scanSec]) if (s) s.style.display = 'none';
  if (notFnd) notFnd.style.display = '';
}

// ── countdown loop ──────────────────────────────────────────────────────────────
function startCountdown() {
  const tick = () => {
    txt(elCd, fmtLeft(META.closesAt));
    if (!CLOSED && Date.now() >= Number(META.closesAt)) {
      CLOSED = true; renderStats();
      if (state === 'idle') { check.disabled = true; check.textContent = 'Room closed'; addr.disabled = true; }
    }
  };
  tick();
  setInterval(tick, 1000);
}

// ── load ─────────────────────────────────────────────────────────────────────
async function load() {
  if (!RX_ROOM_ID.test(roomId)) { showNotFound(); return; }
  let room;
  try { room = await getRoom(roomId); }
  catch (e) { flagErr(errMsg(e)); return; }
  if (!room || !room.meta) { showNotFound(); return; }

  META = room.meta; CAP = Number(META.capacity) || 0;
  curCount = Number(room.joinState && room.joinState.count) || 0;
  renderHead();
  renderChips(room.requirements, META);
  renderStats();

  CLOSED = META.status === 'closed' || Date.now() >= Number(META.closesAt);
  if (CLOSED) { check.disabled = true; check.textContent = 'Room closed'; addr.disabled = true; }

  // live count (the only live subscription — joinState is a read:true public path).
  watchJoinState(roomId, (js) => { curCount = Number(js && js.count) || 0; renderStats(); });
  startCountdown();
}

load();
