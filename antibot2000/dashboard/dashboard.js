// dashboard.js — Anti Bot 2000 creator dashboard (screen 3/3, the management surface).
// Code-gated: the creator code (popped from the one-shot sessionStorage stash, or typed
// into the gate) is the single source of truth → lookupRoom(code) resolves the roomId →
// getRoom + watchJoinState render live stats, downloadWhitelist exports the list, closeRoom
// closes it. The code lives in memory ONLY (CODE) — NEVER put in a URL or logged. Every
// user string renders via txt()/mk() (textContent); the only innerHTML is iconNode() with a
// compile-time-constant SVG. ES module; imports the foundation from ./firebase.js.
import {
  getRoom, watchJoinState, lookupRoom, closeRoom, downloadWhitelist,
  bannerUrl, txt, mk, popStashedCode, errMsg,
} from '../firebase.js';

const $ = (id) => document.getElementById(id);
let ROOM_ID = '', CODE = '', META = null, CAP = 0, curCount = 0, CLOSED = false;

// ── theme toggle ──────────────────────────────────────────────────────────────
const body = document.body, tglBtn = $('tgl');
if (tglBtn) tglBtn.addEventListener('click', () => {
  body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ── gate (no-oracle: a wrong/absent code collapses to one error via lookupRoom) ──
function showGate(msg) {
  $('gate').style.display = ''; $('loading').style.display = 'none'; $('dash').style.display = 'none';
  const e = $('gateErr');
  if (msg) { txt(e, msg); e.classList.add('on'); } else { txt(e, ''); e.classList.remove('on'); }
  const i = $('gateCode'); if (i) i.focus();
}
let entering = false;
async function tryEnter(code) {
  code = (code || '').trim();
  if (!code || entering) { if (!code) $('gateCode').focus(); return; }
  entering = true;
  $('gate').style.display = 'none'; $('loading').style.display = '';
  try {
    const { roomId } = await lookupRoom(code);            // throws permission-denied on a wrong code
    await loadRoom(roomId, code);
  } catch (e) {
    showGate(errMsg(e));                                  // 'Wrong code.' / rate / etc.
  } finally {
    entering = false;
  }
}
if ($('gateGo')) $('gateGo').addEventListener('click', () => tryEnter($('gateCode').value));
if ($('gateCode')) $('gateCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryEnter($('gateCode').value); });

// ── load + render ─────────────────────────────────────────────────────────────
async function loadRoom(roomId, code) {
  let room;
  try { room = await getRoom(roomId); }
  catch (e) { showGate(errMsg(e)); return; }
  if (!room || !room.meta) { showGate('Room not found.'); return; }

  ROOM_ID = roomId; CODE = code; META = room.meta; CAP = Number(META.capacity) || 0;
  curCount = Number(room.joinState && room.joinState.count) || 0;

  renderHead();
  renderChips(room.requirements);
  // share link (portable absolute URL) + the code (re-copyable; the creator already holds it)
  $('lnk').value = new URL('../room/?r=' + encodeURIComponent(roomId), location.href).href;
  $('code').value = code;

  CLOSED = META.status === 'closed' || Date.now() >= Number(META.closesAt);
  renderStats();
  if (CLOSED) markClosedUI();

  watchJoinState(roomId, (js) => { curCount = Number(js && js.count) || 0; renderStats(); });
  startCountdown();

  $('loading').style.display = 'none'; $('dash').style.display = '';
}

function renderHead() {
  txt($('nm'), META.title || 'Untitled room');
  const bUrl = bannerUrl(META.bannerPath);
  if (bUrl) $('banner').style.backgroundImage = 'url("' + bUrl + '")';   // else keep the CSS gradient
}

function roomState() {
  if (!META) return ['', 'Open'];
  if (META.status === 'closed' || Date.now() >= Number(META.closesAt)) return ['closed', 'Closed'];
  if (CAP > 0 && curCount >= CAP) return ['closed', 'Full'];
  if (CAP > 0 && curCount / CAP > 0.9) return ['soon', 'Filling'];
  return ['', 'Open'];
}
function renderStats() {
  txt($('joined'), String(curCount));                         // count only — the bar shows fill vs cap (tile is too narrow for "N / CAP" at ≤430px)
  const wc = $('wlcount'); if (wc) txt(wc, String(curCount));   // mirror the live count into the Whitelist label (Brief #17 P1-1)
  const pct = CAP > 0 ? Math.min(100, Math.round(curCount / CAP * 100)) : 0;
  $('joinedbar').style.width = pct + '%';
  const [cls, label] = roomState();
  $('badge').className = 'badge ' + cls;
  txt($('badgeLabel'), label);
  txt($('statusv'), label);
}

function chipsFrom(req) {
  const out = [], r = req || {}, f = r.filters || {};
  out.push('Avg hold ≥ ' + (Number(r.minAvgHoldDays) || 1) + 'd');
  if (Number(r.minWalletAgeDays) > 0) out.push('Wallet age ≥ ' + r.minWalletAgeDays + 'd');
  if (Number(r.minMints) > 0) out.push('Mints ≥ ' + r.minMints);
  if (Number(r.minTx) > 0) out.push('Transactions ≥ ' + r.minTx);
  if (Number(r.minDistinct) > 0) out.push('Distinct ≥ ' + r.minDistinct);
  if (Number(r.minActiveMonths) > 0) out.push('Active ≥ ' + r.minActiveMonths + ' mo');
  if (Number(r.minDiamondPct) > 0) out.push('Diamond ≥ ' + r.minDiamondPct + '%');
  if (r.holdCollectionAddr) out.push('Must-hold');
  if (f.paidOnly) out.push('Paid mints only');
  if (Number(f.recencyDays) > 0) out.push('Recent activity');
  out.push((Number(META && META.perWalletLimit) || 1) + ' per wallet');
  return out;
}
function renderChips(req) {
  const c = $('reqchips'); while (c.firstChild) c.removeChild(c.firstChild);
  for (const label of chipsFrom(req)) c.appendChild(mk('span', { class: 'chip', text: label }));
  txt($('reqhint'), curCount > 0 ? 'Locked — the first wallet has joined.' : 'These lock when the first wallet joins.');
}

// ── countdown ──────────────────────────────────────────────────────────────────
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor((Number(ms) - Date.now()) / 1000));
  if (s <= 0) return 'Closed';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function startCountdown() {
  const tick = () => {
    txt($('cd'), CLOSED ? 'Closed' : fmtLeft(META.closesAt));
    if (!CLOSED && Date.now() >= Number(META.closesAt)) { CLOSED = true; markClosedUI(); }
  };
  tick();
  setInterval(tick, 1000);
}
function markClosedUI() {
  CLOSED = true;
  renderStats();
  txt($('cd'), 'Closed');
  const cb = $('close'); if (cb) { cb.disabled = true; cb.textContent = 'Room closed'; }
}

// ── download (the CF re-verifies the code; output is CF-built + CSV-injection-safe) ──
function dl(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeName(ext) {
  const slug = (META && typeof META.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(META.slug)) ? META.slug : 'allowlist';
  return slug + '-allowlist.' + ext;
}
function dashMsg(msg, ok) { const e = $('dashMsg'); txt(e, msg); e.classList.add('on'); e.classList.toggle('okmsg', !!ok); }
function clearDashMsg() { const e = $('dashMsg'); txt(e, ''); e.classList.remove('on', 'okmsg'); }

async function doDownload(fmt, btn) {
  clearDashMsg();
  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    const r = await downloadWhitelist(ROOM_ID, CODE, fmt);
    if (r && r.expired) { dashMsg('The whitelist was deleted (5 days after the room closed).'); return; }
    if (fmt === 'csv') dl(safeName('csv'), String((r && r.csv) || ''), 'text/csv');
    else dl(safeName('json'), JSON.stringify((r && r.rows) || [], null, 2), 'application/json');
    if (r && typeof r.count === 'number') dashMsg(r.count + ' wallet' + (r.count === 1 ? '' : 's') + ' exported.', true);
  } catch (e) {
    dashMsg(errMsg(e));
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}
if ($('csv'))  $('csv').addEventListener('click', (e) => doDownload('csv', e.currentTarget));
if ($('json')) $('json').addEventListener('click', (e) => doDownload('json', e.currentTarget));

// ── close (two-step confirm; irreversible — stops new joins) ─────────────────────
let closeArmed = false, closeTimer = null;
const closeBtn = $('close');
if (closeBtn) closeBtn.addEventListener('click', () => {
  if (CLOSED || closeBtn.disabled) return;
  if (!closeArmed) {
    closeArmed = true; closeBtn.textContent = 'Tap again to confirm';
    closeTimer = setTimeout(() => { closeArmed = false; closeBtn.textContent = 'Close room'; }, 3500);
    return;
  }
  clearTimeout(closeTimer); closeArmed = false;
  doClose();
});
async function doClose() {
  closeBtn.disabled = true; closeBtn.textContent = 'Closing…'; clearDashMsg();
  try {
    const r = await closeRoom(ROOM_ID, CODE);
    if (META) META.status = 'closed';
    if (r && typeof r.finalCount === 'number') curCount = r.finalCount;
    markClosedUI();
  } catch (e) {
    closeBtn.disabled = false; closeBtn.textContent = 'Close room';
    dashMsg(errMsg(e));
  }
}

// ── copy buttons (constant-SVG confirm swap; no innerHTML with data) ─────────────
const OKC_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor" fill="none"><path d="M5 12l5 5 9-11"/></svg>';
function iconNode(constSvg) { const w = document.createElement('span'); w.innerHTML = constSvg; return w.firstChild; }
document.querySelectorAll('.cp[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const inp = $(btn.getAttribute('data-copy'));
    if (!inp || !inp.value) return;
    try { await navigator.clipboard.writeText(inp.value); }
    catch (_) { try { inp.select(); document.execCommand('copy'); } catch (_e) { /* ignore */ } }
    const orig = btn.firstChild; if (!orig) return;
    const chk = iconNode(OKC_SVG);
    btn.replaceChild(chk, orig);
    setTimeout(() => { if (chk.parentNode === btn) btn.replaceChild(orig, chk); }, 1200);
  });
});

// ── boot: pop the one-shot stash (from create / home re-entry) or show the gate ──
const stashed = popStashedCode();
if (stashed) tryEnter(stashed);
else showGate();
