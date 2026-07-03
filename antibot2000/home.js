// home.js — Anti Bot 2000 frontpage. Theme toggle, the hero collection band (static
// homages), the live publicRooms grids (Featured + Recently created — rendered via
// mk()/textContent, NEVER innerHTML with user data), and the creator-code re-entry
// (lookupRoom → dashboard). ES module; imports the foundation from ./firebase.js.
import { watchPublicRooms, watchShowcases, lookupRoom, txt, mk, bannerUrl, openSeaHref, errMsg, stashCode } from './firebase.js';

// ── theme toggle ──────────────────────────────────────────────────────────────
const body = document.body, tglBtn = document.getElementById('tgl');
if (tglBtn) tglBtn.addEventListener('click', () => {
  body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ── helpers ────────────────────────────────────────────────────────────────────
function fmtLeft(closesAt) {
  const s = Math.max(0, Math.floor((Number(closesAt) - Date.now()) / 1000));
  if (s <= 0) return 'closed';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
function fmtAgo(createdAt) {
  const min = Math.max(0, Math.floor((Date.now() - Number(createdAt)) / 60000));
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
// icon(): innerHTML with a COMPILE-TIME-CONSTANT SVG string ONLY (static markup, never
// user data → no XSS). Returns a fresh detached node each call.
function icon(constSvg) { const s = document.createElement('span'); s.innerHTML = constSvg; return s.firstChild; }
const CLK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>';

// derive the display state from the live count/status/closesAt (not a stored label).
function roomState(r) {
  const count = Number(r.count) || 0, cap = Number(r.capacity) || 0;
  if (r.status === 'closed' || Date.now() >= Number(r.closesAt)) return ['full', 'Closed'];
  if (cap > 0 && count >= cap) return ['full', 'Full'];
  if (cap > 0 && count / cap > 0.9) return ['soon', 'Filling'];
  return ['open', 'Open'];
}
function reqChips(req) {
  const out = [];
  if (!req) return out;
  if (Number(req.age)   > 0) out.push(`Age ≥ ${Number(req.age)}d`);
  if (Number(req.mints) > 0) out.push(`Mints ≥ ${Number(req.mints)}`);
  if (Number(req.hold)  > 0) out.push(`Hold ≥ ${Number(req.hold)}d`);
  if (req.coll) out.push('Must-hold');
  return out;
}

// ── room card (mk/textContent only) ─────────────────────────────────────────────
function roomCard(r) {
  const [stCls, stLabel] = roomState(r);
  const count = Number(r.count) || 0, cap = Number(r.capacity) || 0;
  const pct = cap > 0 ? Math.min(100, Math.round(count / cap * 100)) : 0;
  const bUrl = bannerUrl(r.bannerPath);

  const card = mk('a', { class: 'card', attrs: { href: 'room/?r=' + encodeURIComponent(r.id) } });

  // banner (only if the room has a real, validated banner path)
  if (bUrl) {
    const banner = mk('div', { class: 'banner' });
    banner.style.backgroundImage = 'url("' + bUrl + '")';     // bUrl pre-validated by bannerUrl()
    const badge = mk('span', { class: 'badge ' + stCls + ' ovr', kids: [mk('i')] });
    badge.appendChild(document.createTextNode(stLabel));      // text node — safe
    banner.appendChild(badge);
    card.appendChild(banner);
  }

  const bodyEl = mk('div', { class: 'body' });

  // top: title (+ optional @twitter) and, when no banner, the inline badge
  const idWrap = mk('div', {});
  idWrap.appendChild(mk('div', { class: 'nm', text: r.title || 'Untitled room' }));
  if (r.twitterHandle) idWrap.appendChild(mk('div', { class: 'by', text: 'by @' + r.twitterHandle }));
  const top = mk('div', { class: 'top', kids: [idWrap] });
  if (!bUrl) {
    const badge = mk('span', { class: 'badge ' + stCls, kids: [mk('i')] });
    badge.appendChild(document.createTextNode(stLabel));
    top.appendChild(badge);
  }
  bodyEl.appendChild(top);

  // chips
  const chips = mk('div', { class: 'chips' });
  for (const c of reqChips(r.req)) chips.appendChild(mk('span', { class: 'chip', text: c }));
  bodyEl.appendChild(chips);

  // progress
  const r1 = mk('div', { class: 'r' });
  r1.appendChild(mk('span', { text: 'Spots' }));
  const r1b = mk('span', {});
  r1b.appendChild(mk('b', { text: String(count) }));
  r1b.appendChild(document.createTextNode(' / ' + cap));
  r1.appendChild(r1b);
  const barI = mk('i');
  barI.style.width = pct + '%';
  bodyEl.appendChild(mk('div', { class: 'prog', kids: [r1, mk('div', { class: 'bar', kids: [barI] })] }));

  // foot: countdown + created-ago
  const dSpan = mk('span', { class: 'd', kids: [icon(CLK_SVG)] });
  dSpan.appendChild(mk('span', { text: fmtLeft(r.closesAt) }));
  const foot = mk('div', { class: 'foot', kids: [dSpan, mk('span', { class: 'sepdot' }), mk('span', { text: fmtAgo(r.createdAt) })] });
  bodyEl.appendChild(foot);

  card.appendChild(bodyEl);
  return card;
}

function gridOf(list) {
  const g = mk('section', { class: 'grid' });
  for (const r of list) g.appendChild(roomCard(r));
  return g;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// ── showcase card (scanned whitelists) — DISPLAY-ONLY: a div, not an <a>; no join, no countdown ──
function showcaseCard(s) {
  const bUrl = bannerUrl(s.bannerPath);
  const card = mk('div', { class: 'card' });                    // div (not <a>) → not clickable into a room
  if (bUrl) {
    const banner = mk('div', { class: 'banner' });
    banner.style.backgroundImage = 'url("' + bUrl + '")';       // bUrl pre-validated by bannerUrl()
    const badge = mk('span', { class: 'badge full ovr', kids: [mk('i')] });
    badge.appendChild(document.createTextNode('Showcase'));
    banner.appendChild(badge);
    card.appendChild(banner);
  }
  const bodyEl = mk('div', { class: 'body' });
  const idWrap = mk('div', {});
  idWrap.appendChild(mk('div', { class: 'nm', text: s.title || 'Scanned whitelist' }));
  if (s.twitterHandle) idWrap.appendChild(mk('div', { class: 'by', text: 'by @' + s.twitterHandle }));
  const top = mk('div', { class: 'top', kids: [idWrap] });
  if (!bUrl) {
    const badge = mk('span', { class: 'badge full', kids: [mk('i')] });
    badge.appendChild(document.createTextNode('Showcase'));
    top.appendChild(badge);
  }
  bodyEl.appendChild(top);
  // req chips
  const chips = mk('div', { class: 'chips' });
  for (const c of reqChips(s.req)) chips.appendChild(mk('span', { class: 'chip', text: c }));
  bodyEl.appendChild(chips);
  // passed stat (reuse the progress row + bar styling)
  const total = Number(s.total) || 0, passed = Number(s.passCount) || 0;
  const pct = total > 0 ? Math.min(100, Math.round(passed / total * 100)) : 0;
  const r1 = mk('div', { class: 'r' });
  r1.appendChild(mk('span', { text: 'Passed' }));
  const r1b = mk('span', {});
  r1b.appendChild(mk('b', { text: String(passed) }));
  r1b.appendChild(document.createTextNode(' / ' + total));
  r1.appendChild(r1b);
  const barI = mk('i'); barI.style.width = pct + '%';
  bodyEl.appendChild(mk('div', { class: 'prog', kids: [r1, mk('div', { class: 'bar', kids: [barI] })] }));
  // foot: optional OpenSea link + published-ago
  const foot = mk('div', { class: 'foot' });
  const os = openSeaHref(s.openSeaSlug);
  if (os) foot.appendChild(mk('a', { class: 'd', text: 'OpenSea ↗', attrs: { href: os, target: '_blank', rel: 'noopener noreferrer' } }));
  if (os) foot.appendChild(mk('span', { class: 'sepdot' }));
  foot.appendChild(mk('span', { text: fmtAgo(s.publishedAt) }));
  bodyEl.appendChild(foot);
  card.appendChild(bodyEl);
  return card;
}

// ── live data: one subscription to the newest rooms; filters re-sort client-side ──
let ALL = [];
const recentWrap = document.getElementById('recentWrap');
const featuredGrid = document.getElementById('featuredGrid');
const featuredSec = document.getElementById('featuredSec');
let mode = 'recent';

function renderFeatured() {
  if (!featuredGrid) return;
  const feat = ALL.filter((r) => r.featured === true);
  clear(featuredGrid);
  if (feat.length) { featuredGrid.appendChild(gridOf(feat)); if (featuredSec) featuredSec.style.display = ''; }
  else if (featuredSec) featuredSec.style.display = 'none';   // hide the section when nothing is featured
}
function renderRecent() {
  if (!recentWrap) return;
  clear(recentWrap);
  let list = ALL.slice();
  if (mode === 'ending') {
    list = list.filter((r) => roomState(r)[1] !== 'Closed').sort((a, b) => Number(a.closesAt) - Number(b.closesAt));
    recentWrap.appendChild(gridOf(list));
  } else if (mode === 'popular') {
    list.sort((a, b) => (Number(b.count) / Number(b.capacity || 1)) - (Number(a.count) / Number(a.capacity || 1)));
    recentWrap.appendChild(gridOf(list));
  } else {
    // Newest — grouped by creation recency (the mockup's buckets).
    list.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    const buckets = [['Just now', 0, 15], ['Earlier today', 15, 1440], ['This week', 1440, Infinity]];
    for (const [label, lo, hi] of buckets) {
      const items = list.filter((r) => {
        const min = (Date.now() - Number(r.createdAt)) / 60000;
        return min >= lo && min < hi;
      });
      if (items.length) {
        recentWrap.appendChild(mk('div', { class: 'ghead', text: label }));
        recentWrap.appendChild(gridOf(items));
      }
    }
  }
}

watchPublicRooms('createdAt', 60, true, (rooms) => {
  ALL = (rooms || []).filter((r) => r.adminDeleted !== true);   // hide admin-soft-deleted rooms (load-bearing for the delete feature)
  renderFeatured();
  renderRecent();
});

// ── showcases (scanned whitelists) — own section, newest first, display-only ──
const showcaseGrid = document.getElementById('showcaseGrid');
const showcaseSec = document.getElementById('showcaseSec');
function renderShowcases(list) {
  if (!showcaseGrid) return;
  clear(showcaseGrid);
  if (list && list.length) {
    const g = mk('section', { class: 'grid' });
    for (const s of list) g.appendChild(showcaseCard(s));
    showcaseGrid.appendChild(g);
    if (showcaseSec) showcaseSec.style.display = '';
  } else if (showcaseSec) showcaseSec.style.display = 'none';   // hide the section when there are none
}
watchShowcases(30, (list) => renderShowcases(list));

// filter buttons
const rf = document.getElementById('rfilters');
if (rf) rf.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  for (const x of rf.children) x.classList.remove('on');
  btn.classList.add('on');
  mode = btn.getAttribute('data-mode') || 'recent';
  renderRecent();
});

// re-tick the live countdowns once a minute (cards are re-rendered cheaply).
setInterval(() => { renderFeatured(); renderRecent(); }, 60000);

// ── creator-code re-entry (lookupRoom → stash code → dashboard) ──────────────────
const codeInput = document.getElementById('creatorCodeIn');
const codeGo = document.getElementById('creatorCodeGo');
const codeMsg = document.getElementById('creatorCodeMsg');
async function reenter() {
  const code = (codeInput && codeInput.value || '').trim();
  if (!code) return;
  if (codeMsg) txt(codeMsg, '');
  if (codeGo) codeGo.disabled = true;
  try {
    const { roomId } = await lookupRoom(code);
    stashCode(code);                          // one-shot hand-off; the dashboard pops+clears it
    location.href = 'dashboard/?r=' + encodeURIComponent(roomId);   // roomId is public; the CODE is NOT in the URL
  } catch (e) {
    if (codeMsg) txt(codeMsg, errMsg(e));     // 'Wrong code.' etc.
  } finally {
    if (codeGo) codeGo.disabled = false;
  }
}
if (codeGo) codeGo.addEventListener('click', reenter);
if (codeInput) codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') reenter(); });

// ── hero collection band — static pixel homages (no user data), hand-authored sprites ──
const TRACK = document.getElementById('bandtrack');
if (TRACK) {
  const bg = (x, c) => { x.fillStyle = c; x.fillRect(0, 0, 24, 24); };
  const R = (x, a, b2, w, h, c) => { x.fillStyle = c; x.fillRect(a, b2, w, h); };
  const COLL = [
    (x) => { bg(x, '#ffffff'); R(x, 8, 6, 9, 13, '#b3dede'); R(x, 10, 18, 4, 4, '#b3dede'); R(x, 11, 2, 2, 4, '#d63a2a'); R(x, 9, 5, 6, 1, '#d63a2a'); R(x, 9, 11, 2, 1, '#2c3a3a'); R(x, 13, 11, 2, 1, '#2c3a3a'); R(x, 8, 15, 1, 1, '#f0c020'); R(x, 11, 15, 3, 1, '#33403f'); },
    (x) => { bg(x, '#ffffff'); R(x, 5, 7, 14, 11, '#6b4f36'); R(x, 4, 9, 2, 3, '#6b4f36'); R(x, 18, 9, 2, 3, '#6b4f36'); R(x, 5, 4, 14, 3, '#f0f0f0'); R(x, 5, 7, 14, 1, '#1a1a22'); R(x, 11, 5, 2, 1, '#e8c14a'); R(x, 6, 12, 12, 7, '#b58f5e'); R(x, 7, 10, 4, 1, '#4a3622'); R(x, 13, 10, 4, 1, '#4a3622'); R(x, 8, 11, 1, 1, '#1a1206'); R(x, 15, 11, 1, 1, '#1a1206'); R(x, 7, 16, 10, 1, '#3a2a1a'); },
    (x) => { bg(x, '#ffffff'); R(x, 7, 4, 11, 5, '#1c1830'); R(x, 9, 8, 7, 7, '#f2cfa6'); R(x, 10, 11, 2, 2, '#1c1830'); R(x, 7, 17, 11, 3, '#cf3b35'); R(x, 11, 14, 2, 1, '#b06a5a'); },
    (x) => { bg(x, '#ffffff'); R(x, 6, 8, 12, 8, '#5a7fb0'); R(x, 9, 7, 6, 8, '#f4f4f8'); R(x, 10, 9, 1, 2, '#1a1a22'); R(x, 13, 9, 1, 2, '#1a1a22'); R(x, 11, 10, 2, 2, '#f0962e'); R(x, 8, 20, 3, 1, '#f0962e'); R(x, 13, 20, 3, 1, '#f0962e'); },
    (x) => { bg(x, '#ffffff'); R(x, 7, 7, 10, 11, '#f1d3a8'); R(x, 7, 4, 10, 4, '#9b6ef0'); R(x, 9, 11, 2, 2, '#2a2730'); R(x, 13, 11, 2, 2, '#2a2730'); R(x, 6, 19, 12, 3, '#ef8fb0'); },
    (x) => { bg(x, '#ffffff'); R(x, 6, 6, 12, 13, '#5b4e9e'); R(x, 9, 14, 6, 4, '#7a6dc0'); R(x, 7, 8, 4, 4, '#f4f4f8'); R(x, 13, 8, 4, 4, '#f4f4f8'); R(x, 8, 9, 2, 2, '#1c1c28'); R(x, 14, 9, 2, 2, '#1c1c28'); R(x, 11, 11, 2, 2, '#f0962e'); },
    (x) => { bg(x, '#ffffff'); R(x, 6, 6, 12, 8, '#e8d0b0'); R(x, 3, 8, 8, 5, '#d63a3a'); R(x, 12, 8, 9, 5, '#d63a3a'); R(x, 5, 9, 4, 3, '#f4f4f8'); R(x, 14, 9, 4, 3, '#f4f4f8'); R(x, 7, 9, 2, 3, '#1a1a1a'); R(x, 16, 9, 2, 3, '#1a1a1a'); R(x, 7, 16, 10, 4, '#d63a3a'); },
    (x) => { bg(x, '#ffffff'); R(x, 5, 7, 14, 9, '#5f9e3f'); R(x, 6, 8, 4, 2, '#e8a020'); R(x, 14, 8, 4, 2, '#e8a020'); R(x, 7, 9, 2, 1, '#2a3a18'); R(x, 15, 9, 2, 1, '#2a3a18'); R(x, 7, 15, 10, 3, '#c9b58a'); },
    (x) => { bg(x, '#ffffff'); R(x, 7, 6, 10, 9, '#7ab8e8'); R(x, 9, 9, 2, 2, '#1a2a3a'); R(x, 13, 9, 2, 2, '#1a2a3a'); R(x, 10, 13, 4, 1, '#ef6f9a'); R(x, 7, 17, 10, 2, '#f0c020'); },
    (x) => { bg(x, '#ffffff'); const cols = ['#e23b3b', '#f0892e', '#f0d23b', '#36b37e', '#2f80d0', '#7a4fe0', '#d24fd2']; for (let i = 2; i < 22; i++) { const y = 11 + Math.round(5 * Math.sin(i * 0.62)); R(x, i, y, 1, 3, cols[(i - 2) % 7]); } },
  ];
  for (let pass = 0; pass < 4; pass++) for (const draw of COLL) {
    const w = document.createElement('div'); w.className = 'tilewrap';
    const cv = document.createElement('canvas'); cv.width = 24; cv.height = 24; draw(cv.getContext('2d'));
    w.appendChild(cv); TRACK.appendChild(w);
  }
}
