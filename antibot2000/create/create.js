// create.js — Anti Bot 2000 create-a-room form. Gathers the wizard inputs, mirrors
// the Cloud Function's clamps client-side (UX only — createRoom re-validates every
// field server-side and is the authority), calls createRoom, and shows the success
// panel with the share link + the creator code (shown ONCE). The code is handed to
// the dashboard via the one-shot sessionStorage stash — NEVER put in a URL.
// ES module; imports the foundation from ./firebase.js. No innerHTML with user data
// (the only innerHTML is iconNode() with compile-time-constant SVGs).
import { createRoom, stashCode, txt, errMsg, popAccessCode } from '../firebase.js';

// v1.2: creating is invite-only. The single-use creator access code arrives from the /start/ chooser via
// the one-shot access stash. Pop it ONCE on load into a module let (held across a failed submit so a retry
// needs no re-visit). No code → this page wasn't reached through /start/ → send them there. The code is
// sent to createRoom, which does the authoritative single-use claim+burn (the peek was advisory).
const _accessCode = popAccessCode();
if (!_accessCode) location.replace('../start/');

// ── mirrors of the CF gates (UX only; the CF is the authority) ────────────────
const RX_HANDLE  = /^[A-Za-z0-9_]{1,15}$/;
const RX_OS_SLUG = /^[a-z0-9-]{1,80}$/;
const RX_ADDR    = /^0x[0-9a-fA-F]{40}$/;
// Mirror ONLY the CF's hard DENY (UX -- the CF re-validates every field and is authority).
// Quotes, apostrophes, symbols, emoji and newlines are all allowed now: the server accepts
// them and every field renders via textContent (XSS-neutral). Byte-identical to the CF DENY.
// Invisible code points are backslash-u escapes ON PURPOSE -- never paste the literal char.
const RX_TEXT_DENY = /[<>\u2028\u2029\u202A-\u202E\u2066-\u2069]/;   // < >, JS line-seps, bidi controls
function textErr(label, s) {
  if (RX_TEXT_DENY.test(s)) return label + ' can\'t contain < > or hidden control characters.';
  return '';
}
const MIN_DUR = 15 * 60 * 1000;
const MAX_DUR = 7 * 24 * 60 * 60 * 1000;
const MAX_BANNER = 2 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const val = (id) => { const e = $(id); return e ? e.value : ''; };
const int = (id) => { const n = Math.floor(Number(val(id))); return Number.isFinite(n) ? n : 0; };
const isOn = (sub) => { const cb = document.querySelector('.sw input[data-sub="' + sub + '"]'); return !!(cb && cb.checked); };

// ── theme toggle ──────────────────────────────────────────────────────────────
const body = document.body, tglBtn = $('tgl');
if (tglBtn) tglBtn.addEventListener('click', () => {
  body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ── requirement sub-reveals (toggle switches) ────────────────────────────────
document.querySelectorAll('.sw input[data-sub]').forEach((cb) => {
  cb.addEventListener('change', () => {
    const sub = cb.getAttribute('data-sub');
    const s = $(sub);
    if (s) s.classList.toggle('on', cb.checked);
    // paid-only ⇒ avg-hold/diamond need ≥2 paid collections (the eval `need2` guard);
    // with N=1 the window caps at 1 collection → avg-hold could NEVER pass. Force ≥2.
    if (sub === 's-paid') {
      const n = $('in-holdn');
      if (n) {
        n.min = cb.checked ? '2' : '1';
        if (cb.checked && Number(n.value) < 2) n.value = '2';
      }
      _showHoldnNote(cb.checked);                              // V24: disclose the >=2 floor while paidOnly is on
    }
  });
});

// V24: keep in-holdn honest with the CF clamp — with paidOnly ON a value <2 snaps to 2 on COMMIT
// (change, not input, so typing "12" isn't mangled mid-keystroke). Frontend-only; the CF re-clamps anyway.
const _holdnEl = $('in-holdn');
if (_holdnEl) _holdnEl.addEventListener('change', () => {
  if (isOn('s-paid') && Number(_holdnEl.value) < 2) _holdnEl.value = '2';
});
function _showHoldnNote(show) {
  const el = $('holdn-note');
  if (el) el.style.display = show ? 'block' : 'none';
}

// ── segmented controls ───────────────────────────────────────────────────────
document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !seg.contains(btn)) return;
    for (const x of seg.children) x.classList.remove('on');
    btn.classList.add('on');
    if (seg.id === 'seg-time') $('s-time').classList.toggle('on', btn.hasAttribute('data-custom'));
    else if (seg.id === 'seg-vis') { const h = btn.getAttribute('data-h'); if (h) txt($('vishint'), h); }
  });
});

// ── banner upload (FileReader → data URL preview; the CF re-sniffs the bytes) ──
let bannerDataUrl = '';
const uplinput = $('uplinput'), upl = $('upl');
if (uplinput) uplinput.addEventListener('change', () => {
  const f = uplinput.files && uplinput.files[0];
  if (!f) return;
  if (!/^image\/(png|jpeg)$/.test(f.type)) { uplinput.value = ''; bannerDataUrl = ''; return showErr('Banner must be a PNG or JPG.'); }
  if (f.size > MAX_BANNER) { uplinput.value = ''; bannerDataUrl = ''; return showErr('Banner is too large (max 2 MB).'); }
  const r = new FileReader();
  r.onload = () => {
    bannerDataUrl = String(r.result || '');                 // data:image/...;base64,… (base64 charset — no CSS breakout)
    upl.style.backgroundImage = 'url("' + bannerDataUrl + '")';
    upl.classList.add('has');
    clearErr();
  };
  r.onerror = () => { bannerDataUrl = ''; showErr('Could not read that image.'); };
  r.readAsDataURL(f);
});

// ── duration / visibility readers ─────────────────────────────────────────────
function computeDuration() {
  const onBtn = document.querySelector('#seg-time button.on');
  if (onBtn && onBtn.hasAttribute('data-custom')) {
    const unit = document.querySelector('#seg-unit button.on');
    const mult = unit ? Number(unit.getAttribute('data-mult')) : 3600000;
    return Math.round(Number(val('in-timeamt')) * mult);
  }
  return onBtn ? Number(onBtn.getAttribute('data-ms')) : 86400000;
}
function pickVisibility() {
  const b = document.querySelector('#seg-vis button.on');
  return (b && b.getAttribute('data-vis') === 'unlisted') ? 'unlisted' : 'public';
}

// ── error banner ─────────────────────────────────────────────────────────────
const createErr = $('createErr');
function showErr(msg) { if (createErr) { txt(createErr, msg); createErr.classList.add('on'); } }
function clearErr() { if (createErr) { txt(createErr, ''); createErr.classList.remove('on'); } }

// ── submit ────────────────────────────────────────────────────────────────────
let lastRoomId = '', lastCode = '';
const createBtn = $('create');
if (createBtn) createBtn.addEventListener('click', onCreate);

async function onCreate() {
  clearErr();
  const title = val('rname').trim();
  if (!title) return showErr('Add a room name.');
  if (title.length > 60) return showErr('Room name is too long (max 60 characters).');
  const teName = textErr('Room name', title); if (teName) return showErr(teName);
  const description = val('rdesc').trim();
  if (description.length > 500) return showErr('Description is too long (max 500 characters).');
  const teDesc = textErr('Description', description); if (teDesc) return showErr(teDesc);

  const twitterHandle = val('tw').trim();
  if (twitterHandle && !RX_HANDLE.test(twitterHandle)) return showErr('Twitter handle: letters, numbers and underscore only (max 15).');
  const openSeaSlug = val('os').trim();
  if (openSeaSlug && !RX_OS_SLUG.test(openSeaSlug)) return showErr('OpenSea slug: lowercase letters, numbers and hyphens only.');

  const durationMs = computeDuration();
  if (!(durationMs >= MIN_DUR && durationMs <= MAX_DUR)) return showErr('Time limit must be between 15 minutes and 7 days.');

  const capacity = int('spots');
  if (!(capacity >= 1 && capacity <= 30000)) return showErr('Max spots must be between 1 and 30,000.');
  const perWalletLimit = int('perw');
  if (!(perWalletLimit >= 1 && perWalletLimit <= 10)) return showErr('Spots per wallet must be between 1 and 10.');

  const paidOnly = isOn('s-paid');
  let minAvgHoldN = int('in-holdn');
  if (paidOnly && minAvgHoldN < 2) minAvgHoldN = 2;          // need2 guard (a single paid collection can never pass avg-hold)

  const requirements = {
    minAvgHoldDays:   int('in-holddays'),
    minAvgHoldN,
    minWalletAgeDays: isOn('s-age')      ? int('in-age')      : 0,
    minMints:         isOn('s-mints')    ? int('in-mints')    : 0,
    minTx:            isOn('s-tx')       ? int('in-tx')       : 0,
    minDistinct:      isOn('s-distinct') ? int('in-distinct') : 0,
    minActiveMonths:  isOn('s-spread')   ? int('in-spread')   : 0,
    minDiamondPct:    isOn('s-dh')       ? int('in-diamond')  : 0,
  };
  if (isOn('s-coll')) {
    const addr = val('in-colladdr').trim();
    if (!RX_ADDR.test(addr)) return showErr('Must-hold: enter a valid collection contract address (0x…).');
    requirements.holdCollectionAddr = addr;
    requirements.holdCollectionMin  = int('in-collmin');
    requirements.holdCollectionDays = int('in-colldays');
  }
  const filters = {
    paidOnly,
    minPaymentEth: paidOnly ? Math.max(0.001, Math.min(10, Number(val('in-paideth')) || 0.001)) : 0,   // B3/F039: mirror the CF clamp — paidOnly floor is 0.001 ETH (blank/0/neg → 0.001), never 0 (kills the 1-wei bypass)
    recencyDays:   isOn('s-recency') ? int('in-recency') : 0,
  };

  if (!_accessCode) { showErr('Your session expired — start again from the code page.'); return; }
  const payload = {
    creatorAccessCode: _accessCode,               // v1.2 invite gate — createRoom claims+burns it (single-use)
    title, description, twitterHandle, openSeaSlug,
    visibility: pickVisibility(),
    requestFeatured: !!($('chk-featured') && $('chk-featured').checked),
    durationMs, capacity, perWalletLimit,
    requirements, filters,
    banner: bannerDataUrl,
  };

  createBtn.disabled = true; createBtn.textContent = 'Creating…';
  try {
    const r = await createRoom(payload);
    showSuccess(r);
  } catch (e) {
    createBtn.disabled = false; createBtn.textContent = 'Create room';
    showErr(errMsg(e));
  }
}

function showSuccess(r) {
  lastRoomId = String(r && r.roomId || '');
  lastCode = String(r && r.creatorCode || '');
  // share link = absolute URL derived from where this page is served (portable: localhost ↔ ubk.art).
  const link = new URL('../room/?r=' + encodeURIComponent(lastRoomId), location.href).href;
  $('lnk').value = link;                                     // input .value (not innerHTML) — safe
  $('code').value = lastCode;
  $('form').style.display = 'none';
  const s = $('success'); s.classList.add('show');
  s.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── open dashboard (stash the code one-shot; roomId in the URL, code is NOT) ──
const goDash = $('goDash');
if (goDash) goDash.addEventListener('click', () => {
  if (!lastRoomId) return;
  if (lastCode) stashCode(lastCode);
  location.href = '../dashboard/?r=' + encodeURIComponent(lastRoomId);
});

// ── copy buttons (clipboard; visual confirm via a constant-SVG swap, no innerHTML w/ data) ──
const OKC_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor" fill="none"><path d="M5 12l5 5 9-11"/></svg>';
function iconNode(constSvg) { const w = document.createElement('span'); w.innerHTML = constSvg; return w.firstChild; }
document.querySelectorAll('.cp[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const inp = $(btn.getAttribute('data-copy'));
    if (!inp) return;
    try { await navigator.clipboard.writeText(inp.value); }
    catch (_) { try { inp.select(); document.execCommand('copy'); } catch (_e) { /* ignore */ } }
    const orig = btn.firstChild;
    if (!orig) return;
    const chk = iconNode(OKC_SVG);
    btn.replaceChild(chk, orig);
    setTimeout(() => { if (chk.parentNode === btn) btn.replaceChild(orig, chk); }, 1200);
  });
});
