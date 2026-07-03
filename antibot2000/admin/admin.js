// admin.js — Anti Bot 2000 owner panel. Master-code gate → mint single-use creator codes, revoke/
// un-revoke them, feature/hide/restore rooms, feature/delete showcase cards. ES module; imports
// ../firebase.js. Every admin op re-sends the master code (the CF is the authority on each call).
//
// SECURITY:
//   - the master code lives ONLY in a module-scoped `let` — NEVER a URL/localStorage/sessionStorage,
//     never logged. It's set ONLY after listAdminOverview() accepts it, cleared on Lock (via reload).
//   - no innerHTML with any data — every room/showcase/code value renders via mk()/txt()/textContent.
//     The only innerHTML is a compile-time-constant SVG (iconNode), same pattern as create/dashboard.
//   - all list rows use ONE delegated listener per group (no per-row/per-render listener leak).
import {
  listAdminOverview, adminMintCode, revokeScanCode, adminUnrevokeScanCode, adminDeleteCode,
  adminSetFeatured, adminDeleteRoom, adminUndeleteRoom, adminDeleteShowcase,
  watchPublicRooms, watchShowcases, txt, mk, errMsg,
} from '../firebase.js';

let _master = '';                                  // module-scoped ONLY
let _unwatchRooms = null, _unwatchShowcases = null;
let _rooms = [], _showcases = [];

const $ = (id) => document.getElementById(id);
function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

// ── theme ──
const body = document.body, tglBtn = $('tgl');
if (tglBtn) tglBtn.addEventListener('click', () => body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

// ── gate ──
const gateGo = $('gateGo'), gateCode = $('gateCode'), gateErr = $('gateErr');
async function unlock() {
  const code = (gateCode && gateCode.value || '').trim();
  if (!code) return;
  txt(gateErr, ''); gateErr.classList.remove('on');
  $('loading').style.display = ''; if (gateGo) gateGo.disabled = true;
  try {
    const ov = await listAdminOverview(code);              // throws permission-denied on a wrong code
    _master = code;                                        // set ONLY on success
    if (gateCode) gateCode.value = '';                     // don't leave the code in the DOM field
    $('gate').style.display = 'none';
    $('loading').style.display = 'none';
    $('panel').style.display = '';
    renderCodes((ov && ov.codes) || []);
    _unwatchRooms = watchPublicRooms('createdAt', 60, true, (rooms) => { _rooms = rooms || []; renderRooms(); });
    _unwatchShowcases = watchShowcases(30, (list) => { _showcases = list || []; renderShowcases(); });
  } catch (e) {
    $('loading').style.display = 'none';
    if (gateGo) gateGo.disabled = false;
    txt(gateErr, errMsg(e)); gateErr.classList.add('on');
  }
}
if (gateGo) gateGo.addEventListener('click', unlock);
if (gateCode) gateCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

// ── lock → clear code + reload (simplest, most robust teardown of watchers + state) ──
const lockBtn = $('lockBtn');
if (lockBtn) lockBtn.addEventListener('click', () => {
  if (_unwatchRooms) { try { _unwatchRooms(); } catch (_) { /* ignore */ } }
  if (_unwatchShowcases) { try { _unwatchShowcases(); } catch (_) { /* ignore */ } }
  _master = '';
  location.reload();
});

// ── mint a creator code ──
const mcGo = $('mcGo'), mcErr = $('mcErr'), mcReveal = $('mcReveal');
async function mintCode() {
  txt(mcErr, ''); mcErr.classList.remove('on');
  const maxRows = Math.min(5000, Math.max(1, Math.floor(Number($('mcRows').value) || 5000)));
  const label = ($('mcLabel').value || '').trim().slice(0, 60);
  mcGo.disabled = true; const old = mcGo.textContent; mcGo.textContent = 'Minting…';
  try {
    const r = await adminMintCode(_master, maxRows, label);
    $('mcCodeOut').value = String((r && r.scanCode) || '');
    mcReveal.classList.add('show');                        // "shown once" reveal
    $('mcLabel').value = '';
    await refreshCodes();
  } catch (e) { txt(mcErr, errMsg(e)); mcErr.classList.add('on'); }
  finally { mcGo.textContent = old; mcGo.disabled = false; }   // always re-enable → mint one code after another (a new mint just replaces the revealed code; "Done" dismisses)
}
if (mcGo) mcGo.addEventListener('click', mintCode);
const mcDone = $('mcDone');
if (mcDone) mcDone.addEventListener('click', () => { $('mcCodeOut').value = ''; mcReveal.classList.remove('show'); mcGo.disabled = false; });

async function refreshCodes() {                             // codes have no live watcher → re-pull after a mint/revoke
  try { const ov = await listAdminOverview(_master); renderCodes((ov && ov.codes) || []); }
  catch (e) { console.error('[admin] codes refresh failed', (e && (e.code || e.message)) || 'unknown'); }   // the mint/revoke already succeeded + surfaced its own error; this is a display refresh only
}

// ── render: codes ──
function renderCodes(codes) {
  codes = codes || [];
  const g = $('codesGroup'); clear(g);
  txt($('statCodes'), String(codes.filter((c) => c && c.status !== 'revoked').length));
  if (!codes.length) { g.appendChild(mk('div', { class: 'empty', text: 'No codes yet.' })); return; }
  for (const c of codes) g.appendChild(codeRow(c));
}
function codeRow(c) {
  const info = mk('div', { class: 'ainfo' });
  info.appendChild(mk('div', { class: 'aname', text: String(c.codeHash || '').slice(0, 12) + '…' }));
  // v1.2: what a spent code was used for. The room path stamps action='room'; the scan path stamps
  // jobId (not action) → derive 'scan' from jobId. null on an unspent/revoked-unspent code.
  const act = c.action === 'room' ? 'room' : (c.jobId ? 'scan' : null);
  const meta = [c.label || 'untitled', c.status || '?'];
  if (act) meta.push(act);
  if (act !== 'room') meta.push('max ' + (c.maxRows || 0));      // maxRows is meaningless once a code opened a room
  info.appendChild(mk('div', { class: 'ameta', text: meta.join(' · ') }));
  const revoked = c.status === 'revoked';
  const btn = mk('button', { class: 'btn btn-sm ' + (revoked ? 'btn-ghost' : 'btn-danger'), text: revoked ? 'Un-revoke' : 'Revoke',
    attrs: { 'data-hash': String(c.codeHash || ''), 'data-act': revoked ? 'unrevoke' : 'revoke' } });
  const acts = [btn];
  if (revoked) acts.push(mk('button', { class: 'btn btn-sm btn-danger', text: 'Delete',      // remove a revoked code from the list (soft-delete)
    attrs: { 'data-hash': String(c.codeHash || ''), 'data-act': 'delete' } }));
  return mk('div', { class: 'arow', kids: [info, mk('div', { class: 'aacts', kids: acts })] });
}
$('codesGroup').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const hash = btn.getAttribute('data-hash'), act = btn.getAttribute('data-act');
  if (act === 'delete') {                                   // two-tap confirm (reuses the shared arm state), then soft-delete a revoked code
    if (_armed !== btn) { _disarm(); _armed = btn; _armedOrig = btn.textContent; btn.textContent = 'Tap again'; _armTimer = setTimeout(_disarm, 3000); return; }
    _disarm(); btn.disabled = true;
    try { await adminDeleteCode(_master, hash); await refreshCodes(); }
    catch (e2) { btn.disabled = false; rowErr(btn, errMsg(e2)); }
    return;
  }
  btn.disabled = true;
  try {
    if (act === 'revoke') await revokeScanCode(_master, hash);
    else await adminUnrevokeScanCode(_master, hash);
    await refreshCodes();
  } catch (e2) { btn.disabled = false; rowErr(btn, errMsg(e2)); }
});

// ── render: rooms ──
function renderRooms() {
  const g = $('roomsGroup'); clear(g);
  txt($('statRooms'), String(_rooms.length));
  if (!_rooms.length) { g.appendChild(mk('div', { class: 'empty', text: 'No rooms.' })); return; }
  for (const r of _rooms) g.appendChild(roomRow(r));
}
function roomRow(r) {
  const nm = mk('div', { class: 'aname' });
  nm.appendChild(document.createTextNode(r.title || 'Untitled room'));
  if (r.adminDeleted === true) nm.appendChild(mk('span', { class: 'tag hid', text: 'Hidden' }));
  else if (r.featured === true) nm.appendChild(mk('span', { class: 'tag feat', text: 'Featured' }));
  const info = mk('div', { class: 'ainfo', kids: [nm,
    mk('div', { class: 'ameta', text: (Number(r.count) || 0) + ' / ' + (Number(r.capacity) || 0) + ' · ' + (r.status || '') })] });
  const hidden = r.adminDeleted === true;
  const featBtn = mk('button', { class: 'btn btn-sm btn-ghost', text: r.featured ? 'Unfeature' : 'Feature',
    attrs: { 'data-id': r.id, 'data-act': 'feat', 'data-on': r.featured ? '0' : '1' } });
  const delBtn = mk('button', { class: 'btn btn-sm ' + (hidden ? 'btn-ghost' : 'btn-danger'), text: hidden ? 'Restore' : 'Delete',
    attrs: { 'data-id': r.id, 'data-act': hidden ? 'undelete' : 'delete' } });
  return mk('div', { class: 'arow', kids: [info, mk('div', { class: 'aacts', kids: [featBtn, delBtn] })] });
}
$('roomsGroup').addEventListener('click', (e) => onListAction(e, 'room'));

// ── render: showcases ──
function renderShowcases() {
  const g = $('showcasesGroup'); clear(g);
  txt($('statShowcases'), String(_showcases.length));
  if (!_showcases.length) { g.appendChild(mk('div', { class: 'empty', text: 'No showcases.' })); return; }
  for (const s of _showcases) g.appendChild(showcaseRow(s));
}
function showcaseRow(s) {
  const nm = mk('div', { class: 'aname' });
  nm.appendChild(document.createTextNode(s.title || 'Scanned whitelist'));
  if (s.featured === true) nm.appendChild(mk('span', { class: 'tag feat', text: 'Featured' }));
  const info = mk('div', { class: 'ainfo', kids: [nm,
    mk('div', { class: 'ameta', text: (Number(s.passCount) || 0) + ' / ' + (Number(s.total) || 0) + ' passed' })] });
  const featBtn = mk('button', { class: 'btn btn-sm btn-ghost', text: s.featured ? 'Unfeature' : 'Feature',
    attrs: { 'data-id': s.id, 'data-act': 'feat', 'data-on': s.featured ? '0' : '1' } });
  const delBtn = mk('button', { class: 'btn btn-sm btn-danger', text: 'Delete', attrs: { 'data-id': s.id, 'data-act': 'delete' } });
  return mk('div', { class: 'arow', kids: [info, mk('div', { class: 'aacts', kids: [featBtn, delBtn] })] });
}
$('showcasesGroup').addEventListener('click', (e) => onListAction(e, 'showcase'));

// ── shared room/showcase action handler (feature toggle / undelete / two-tap-confirm delete) ──
let _armed = null, _armedOrig = '', _armTimer = null;
function _disarm() {
  if (_armTimer) { clearTimeout(_armTimer); _armTimer = null; }
  if (_armed && _armed.isConnected) { _armed.textContent = _armedOrig; }
  _armed = null; _armedOrig = '';
}
async function onListAction(e, kind) {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
  if (act === 'feat') {
    const on = btn.getAttribute('data-on') === '1';
    btn.disabled = true;
    try { await adminSetFeatured(_master, id, kind, on); } catch (e2) { btn.disabled = false; rowErr(btn, errMsg(e2)); }
    return;                                                 // the live watcher re-renders the row
  }
  if (act === 'undelete') {
    btn.disabled = true;
    try { await adminUndeleteRoom(_master, id); } catch (e2) { btn.disabled = false; rowErr(btn, errMsg(e2)); }
    return;
  }
  if (act === 'delete') {
    if (_armed !== btn) {                                   // first tap → arm (no native confirm())
      _disarm();
      _armed = btn; _armedOrig = btn.textContent; btn.textContent = 'Tap again';
      _armTimer = setTimeout(_disarm, 3000);
      return;
    }
    _disarm(); btn.disabled = true;                         // second tap → execute
    try {
      if (kind === 'showcase') await adminDeleteShowcase(_master, id);
      else await adminDeleteRoom(_master, id);
    } catch (e2) { btn.disabled = false; rowErr(btn, errMsg(e2)); }
  }
}

// per-row inline error (never window.alert; never innerHTML with the message)
function rowErr(btn, msg) {
  const row = btn.closest('.arow'); if (!row) return;
  const info = row.querySelector('.ainfo'); if (!info) return;
  let e = info.querySelector('.rowerr');
  if (!e) { e = mk('div', { class: 'ameta rowerr' }); e.style.color = 'var(--no)'; info.appendChild(e); }
  txt(e, msg);
}

// ── copy the minted code (constant-SVG confirm swap, no innerHTML with data) ──
const OKC_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor" fill="none"><path d="M5 12l5 5 9-11"/></svg>';
function iconNode(svg) { const w = document.createElement('span'); w.innerHTML = svg; return w.firstChild; }
document.querySelectorAll('.cp[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const inp = $(btn.getAttribute('data-copy')); if (!inp) return;
    try { await navigator.clipboard.writeText(inp.value); }
    catch (_) { try { inp.select(); document.execCommand('copy'); } catch (_e) { /* ignore */ } }
    const orig = btn.firstChild; if (!orig) return;
    const chk = iconNode(OKC_SVG); btn.replaceChild(chk, orig);
    setTimeout(() => { if (chk.parentNode === btn) btn.replaceChild(orig, chk); }, 1200);
  });
});
