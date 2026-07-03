// start.js — Anti Bot 2000 code chooser (v1.2). One page, three panels: Create a room / Scan a
// whitelist (both take a single-use CREATOR access code) and Manage a room (a per-room ROOM code).
// Each panel probes ONLY its own namespace — create/scan → peekCreatorCode (scanCodes), manage →
// lookupRoom (creatorCodeIndex) — so a code pasted in the wrong panel can never burn or cross-classify.
// The access code is validated (non-consuming peek) then handed off via the one-shot access stash
// (distinct key) to /create/ or /scan/, where the action-time claim burns it. Codes NEVER touch a URL.
// ES module; imports ../firebase.js.
import { peekCreatorCode, lookupRoom, stashAccessCode, stashCode, txt, errMsg } from '../firebase.js';

const $ = (id) => document.getElementById(id);
const val = (id) => { const e = $(id); return e ? e.value : ''; };
function showErr(id, msg) { const e = $(id); if (e) { txt(e, msg); e.classList.add('on'); } }
function clearErr(id) { const e = $(id); if (e) { txt(e, ''); e.classList.remove('on'); } }

// ── theme ──
const body = document.body, tglBtn = $('tgl');
if (tglBtn) tglBtn.addEventListener('click', () => body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

// ── Create / Scan: peek the ACCESS code (non-consuming), then stash + route to the action ──
async function accessGo(codeId, errId, btnId, dest) {
  clearErr(errId);
  const code = (val(codeId) || '').trim();
  if (!code) return showErr(errId, 'Enter your creator code.');
  const btn = $(btnId); if (btn) btn.disabled = true;
  try {
    const r = await peekCreatorCode(code);
    if (!r || !r.valid) { showErr(errId, 'That code is invalid or already used.'); return; }
    stashAccessCode(code);          // one-shot handoff; the destination pops it + the action-time claim burns it
    location.href = dest;
  } catch (e) {
    showErr(errId, errMsg(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Manage: resolve the ROOM code → dashboard (the existing lookupRoom flow, moved here) ──
async function manageGo() {
  clearErr('manageErr');
  const code = (val('manageCode') || '').trim();
  if (!code) return showErr('manageErr', 'Enter your room code.');
  const btn = $('manageGo'); if (btn) btn.disabled = true;
  try {
    const { roomId } = await lookupRoom(code);
    stashCode(code);                // management-code stash (distinct key from the access stash); the dashboard pops it
    location.href = '../dashboard/?r=' + encodeURIComponent(roomId);   // roomId is public; the CODE is NOT in the URL
  } catch (e) {
    showErr('manageErr', errMsg(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

$('createGo').addEventListener('click', () => accessGo('createCode', 'createErr', 'createGo', '../create/'));
$('scanGo').addEventListener('click', () => accessGo('scanCode', 'scanErr', 'scanGo', '../scan/'));
$('manageGo').addEventListener('click', manageGo);
$('createCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') accessGo('createCode', 'createErr', 'createGo', '../create/'); });
$('scanCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') accessGo('scanCode', 'scanErr', 'scanGo', '../scan/'); });
$('manageCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') manageGo(); });
