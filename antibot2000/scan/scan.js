// scan.js — Anti Bot 2000 batch CSV whitelist scan. Redeems a single-use code, gathers the SAME
// collection + requirements form as create (client mirror; the CF re-validates + is the authority),
// parses the uploaded wallet CSV client-side into a validated 0x string[], calls redeemScanCode, then
// polls the job's live progress and offers the clean-CSV download. ES module; imports ../firebase.js.
//
// SECURITY:
//   - the scan code lives ONLY in a module-scoped `let` — NEVER a URL/localStorage/sessionStorage.
//     It MUST survive in memory until the download (downloadCleanCsv re-sends it) — the whole flow
//     (redeem → progress → download) happens on THIS one page load.
//   - no innerHTML with any data — everything via txt()/textContent (constant SVGs already in the HTML).
import { redeemScanCode, downloadCleanCsv, watchJobProgress, txt, errMsg, popAccessCode } from '../firebase.js';

// ── mirrors of the CF gates (UX only; the CF re-validates everything) ──
const RX_HANDLE  = /^[A-Za-z0-9_]{1,15}$/;
const RX_OS_SLUG = /^[a-z0-9-]{1,80}$/;
const RX_ADDR    = /^0x[0-9a-fA-F]{40}$/;
const MAX_BANNER    = 2 * 1024 * 1024;
const MAX_CSV_BYTES = 10 * 1024 * 1024;    // client file guard — a 5,000-address list is < 500 KB
const MAX_WALLETS   = 5000;

const $ = (id) => document.getElementById(id);
const val = (id) => { const e = $(id); return e ? e.value : ''; };
const int = (id) => { const n = Math.floor(Number(val(id))); return Number.isFinite(n) ? n : 0; };
const isOn = (sub) => { const cb = document.querySelector('.sw input[data-sub="' + sub + '"]'); return !!(cb && cb.checked); };

// v1.2: if arrived from the /start/ chooser, prefill the code field from the one-shot access stash.
// Single source of truth = the #scancode field (a direct /scan/ visit just leaves it empty to type).
const _stashedAccess = popAccessCode();
if (_stashedAccess) { const _sc = $('scancode'); if (_sc) _sc.value = _stashedAccess; }

// ── theme toggle ──
const body = document.body, tglBtn = $('tgl');
if (tglBtn) tglBtn.addEventListener('click', () => body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

// ── requirement sub-reveals + the s-paid ↔ in-holdn coupling (mirrors create.js) ──
document.querySelectorAll('.sw input[data-sub]').forEach((cb) => {
  cb.addEventListener('change', () => {
    const sub = cb.getAttribute('data-sub');
    const s = $(sub);
    if (s) s.classList.toggle('on', cb.checked);
    if (sub === 's-paid') {
      const n = $('in-holdn');
      if (n) { n.min = cb.checked ? '2' : '1'; if (cb.checked && Number(n.value) < 2) n.value = '2'; }
      const note = $('holdn-note'); if (note) note.style.display = cb.checked ? 'block' : 'none';
    }
  });
});
const _holdnEl = $('in-holdn');
if (_holdnEl) _holdnEl.addEventListener('change', () => { if (isOn('s-paid') && Number(_holdnEl.value) < 2) _holdnEl.value = '2'; });

// ── banner upload (FileReader → data URL preview; the CF re-sniffs the bytes) ──
let bannerDataUrl = '';
const uplinput = $('uplinput'), upl = $('upl');
if (uplinput) uplinput.addEventListener('change', () => {
  const f = uplinput.files && uplinput.files[0];
  if (!f) return;
  if (!/^image\/(png|jpeg)$/.test(f.type)) { uplinput.value = ''; bannerDataUrl = ''; return showErr('Banner must be a PNG or JPG.'); }
  if (f.size > MAX_BANNER) { uplinput.value = ''; bannerDataUrl = ''; return showErr('Banner is too large (max 2 MB).'); }
  const r = new FileReader();
  r.onload = () => { bannerDataUrl = String(r.result || ''); upl.style.backgroundImage = 'url("' + bannerDataUrl + '")'; upl.classList.add('has'); clearErr(); };
  r.onerror = () => { bannerDataUrl = ''; showErr('Could not read that image.'); };
  r.readAsDataURL(f);
});

// ── CSV upload → parse → DEDUP (before the cap) → count preview ──
// dedup-before-cap so a file with many duplicates up top doesn't waste the 5,000 budget and silently
// drop unique addresses further down; the warning is honest about how many were capped.
let wallets = [];
const csvinput = $('csvinput'), csvcount = $('csvcount');
if (csvinput) csvinput.addEventListener('change', () => {
  const f = csvinput.files && csvinput.files[0];
  if (!f) return;
  if (f.size > MAX_CSV_BYTES) { csvinput.value = ''; wallets = []; return showErr('That file is too large (max 10 MB).'); }
  const r = new FileReader();
  r.onload = () => {
    const seen = new Set();
    for (const t of String(r.result || '').split(/[\s,;]+/)) {
      const a = t.trim().toLowerCase();
      if (RX_ADDR.test(a)) seen.add(a);
    }
    const all = Array.from(seen);
    const hadMore = all.length > MAX_WALLETS;
    wallets = all.slice(0, MAX_WALLETS);
    if (csvcount) {
      csvcount.style.display = '';
      txt(csvcount, wallets.length + ' valid wallet' + (wallets.length === 1 ? '' : 's') + ' detected'
        + (hadMore ? ' (capped from ' + all.length + ' unique — only the first 5,000 are scanned)' : ''));
    }
    clearErr();
  };
  r.onerror = () => { wallets = []; showErr('Could not read that file.'); };
  r.readAsText(f);
});

// ── error banner ──
const scanErr = $('scanErr');
function showErr(m) { if (scanErr) { txt(scanErr, m); scanErr.classList.add('on'); } }
function clearErr() { if (scanErr) { txt(scanErr, ''); scanErr.classList.remove('on'); } }

// ── submit → redeem → progress → download ──
let _scanCode = '', _jobId = '', _unwatch = null, submitted = false;
const scanBtn = $('scan');
if (scanBtn) scanBtn.addEventListener('click', onScan);

async function onScan() {
  if (submitted) return;                     // double-submit guard: a single-use code must not be redeemed twice
  clearErr();
  const scanCode = val('scancode').trim();
  if (!scanCode) return showErr('Enter your scan code.');
  const title = val('rname').trim();
  if (!title) return showErr('Add a collection name.');
  if (title.length > 60) return showErr('Collection name is too long (max 60 characters).');
  const description = val('rdesc').trim();
  if (description.length > 500) return showErr('Description is too long (max 500 characters).');
  const twitterHandle = val('tw').trim();
  if (twitterHandle && !RX_HANDLE.test(twitterHandle)) return showErr('Twitter handle: letters, numbers and underscore only (max 15).');
  const openSeaSlug = val('os').trim();
  if (openSeaSlug && !RX_OS_SLUG.test(openSeaSlug)) return showErr('OpenSea slug: lowercase letters, numbers and hyphens only.');
  if (!wallets.length) return showErr('Upload a CSV with at least one valid wallet address.');

  const paidOnly = isOn('s-paid');
  let minAvgHoldN = int('in-holdn');
  if (paidOnly && minAvgHoldN < 2) minAvgHoldN = 2;          // need2 guard (mirrors create.js + the CF clamp)
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
    minPaymentEth: paidOnly ? Math.max(0.001, Math.min(10, Number(val('in-paideth')) || 0.001)) : 0,
    recencyDays:   isOn('s-recency') ? int('in-recency') : 0,
  };

  submitted = true;
  scanBtn.disabled = true; scanBtn.textContent = 'Scanning…';
  try {
    const r = await redeemScanCode({ scanCode, title, description, twitterHandle, openSeaSlug, requirements, filters, wallets, banner: bannerDataUrl });
    _scanCode = scanCode;                     // held in memory for downloadCleanCsv (same page, whole job)
    _jobId = String(r && r.jobId || '');
    $('form').style.display = 'none';
    const p = $('progress'); p.classList.add('show'); p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    _unwatch = watchJobProgress(_jobId, onProgress);
  } catch (e) {
    submitted = false;
    scanBtn.disabled = false; scanBtn.textContent = 'Scan whitelist';
    showErr(errMsg(e));
  }
}

function onProgress(p) {
  if (!p) return;
  const total = Number(p.total) || 0, scanned = Number(p.scanned) || 0, passed = Number(p.passed) || 0;
  txt($('progstat'), scanned + ' / ' + total + ' scanned');
  txt($('progpass'), passed + ' passed');
  const fill = $('progfill'); if (fill) fill.style.width = (total ? Math.round(scanned / total * 100) : 0) + '%';
  if (p.status === 'done') onDone(total, passed);
  else if (p.status === 'failed') onFailed();
}
function _teardown() { if (_unwatch) { try { _unwatch(); } catch (_) { /* ignore */ } _unwatch = null; } }   // stop the RTDB listener at a terminal state
function onDone(total, passed) {
  _teardown();
  const ic = $('progic'); if (ic) ic.className = 'ic done';
  txt($('progtitle'), 'Done — ' + passed + ' of ' + total + ' passed');
  txt($('progsub'), 'Your clean whitelist is ready to download.');
  $('progresult').style.display = '';
}
function onFailed() {
  _teardown();
  const ic = $('progic'); if (ic) ic.className = 'ic fail';
  txt($('progtitle'), 'Scan failed');
  txt($('progsub'), 'Something went wrong. Contact the admin for a new code.');
}

// ── download the clean CSV (code re-sent from the module let; expired handled before the Blob) ──
const dlbtn = $('dlbtn');
if (dlbtn) dlbtn.addEventListener('click', async () => {
  dlbtn.disabled = true; const old = dlbtn.textContent; dlbtn.textContent = 'Preparing…';
  try {
    const r = await downloadCleanCsv(_scanCode, _jobId, 'csv');
    if (r && r.expired) { txt($('progsub'), 'This scan has expired — the list is no longer available.'); return; }
    const blob = new Blob([String((r && r.csv) || '')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'clean-whitelist.csv'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { txt($('progsub'), errMsg(e)); }
  finally { dlbtn.disabled = false; dlbtn.textContent = old; }
});
