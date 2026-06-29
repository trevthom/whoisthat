// ============================================================================
// ui.js  —  Everything you see on screen.
// ============================================================================
// This file builds the HTML for panels, cards, forms, chat, and pop-ups, and
// keeps them in sync with the data. It does NOT decide what happens when you
// click things — for that it calls "actions" that app.js hands it on startup
// (the `A` object). That split keeps "how it looks" (here) separate from "what
// it does" (app.js), so either can be changed without breaking the other.
// ----------------------------------------------------------------------------

import { getState } from './state.js';
import { RELATIVE_TYPES, emptyCard, emptyRelative, getPerson, getPendingMerge } from './cards.js';
import { hexToNpub, isValidNpub, getNsec } from './nostr.js';
import * as map from './map.js';
import { totalUnread } from './chat.js';
import { FOOTER_LINKS, ISSUES_GITHUB_URL, ISSUES_CONTACT_NPUB, DONATE_SPARK, DONATE_STRIKE } from './config.js';
import { searchAddress, reverseGeocode } from './geocode.js';

let A = {};                 // actions, injected by app.js
let editorDraft = null;     // the card currently being edited (survives pin-picking)
let editorIsSelf = false;
let editorId = null;

export function init(actions) { A = actions; renderFooters(); }

// --------------------------------------------------------------------------
// Icons (inline SVG so they inherit colour and need no external files)
// --------------------------------------------------------------------------
const SUN_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"/></svg>';

// In dark mode we show a SUN (tap → go light); in light mode a MOON (tap → dark).
function updateThemeButton(theme) {
  const btn = $('btn-theme');
  if (!btn) return;
  const dark = theme === 'dark';
  btn.innerHTML = dark ? SUN_ICON : MOON_ICON;
  btn.title = dark ? 'Light Mode' : 'Dark Mode';
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

// Build the footer link bars (login + app) from the editable list in config.js.
function renderFooters() {
  for (const id of ['footer-login', 'footer-app']) {
    const el = $(id);
    if (!el) continue;
    el.innerHTML = '';

    // The app footer also carries the required OpenStreetMap credit (the map's
    // own on-tile label is turned off so it doesn't clutter the corner).
    if (id === 'footer-app') {
      const osm = h('<div class="footer-osm"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></div>');
      el.appendChild(osm);
    }

    const nav = h('<nav class="footer-links"></nav>');
    for (const link of FOOTER_LINKS) {
      const a = h(`<a href="${escapeHtml(link.url || '#')}">${escapeHtml(link.label)}</a>`);
      if (link.action === 'whatIsNostr') {
        a.href = '#';
        a.addEventListener('click', (e) => { e.preventDefault(); openWhatIsNostr(); });
      } else if (link.action === 'issues') {
        a.href = '#';
        a.addEventListener('click', (e) => { e.preventDefault(); openIssuesModal(); });
      } else if (link.action === 'donate') {
        a.href = '#';
        a.addEventListener('click', (e) => { e.preventDefault(); openDonateModal(); });
      } else if (!link.url || link.url === '#') {
        a.addEventListener('click', (e) => { e.preventDefault(); toast(`${link.label} — coming soon`); });
      } else {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      nav.appendChild(a);
    }
    el.appendChild(nav);
  }
}

// "What is Nostr?" popup.
function openWhatIsNostr() {
  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>What is Nostr?</h2><button class="x-btn" data-x>×</button></div>
    <div class="modal-body info-modal">
      <p><b>Nostr is a decentralized network and social protocol for apps, messaging, communities, and more.</b></p>
      <p>Unlike traditional platforms, your account isn't tied to a single company. Your identity, followers, and content can be used across many Nostr-compatible applications.</p>
      <p><b>One login. One identity. Everywhere.</b></p>
      <p>With Nostr, you own your account through a cryptographic key pair, and multiple independent servers (called relays) can distribute your content. The public key (starting with "npub") is similar to a username, the private key (starting with "nsec") is similar to a password. <b>You only ever need the private key when logging into Nostr applications.</b></p>
      <p>Nostr is built on open standards, allowing developers to create different experiences while remaining connected to the same global network.</p>
      <p>Think of Nostr as a shared network that many different applications can connect to — similar to how email works across different providers.</p>
    </div>
  </div>`);
  node.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  openModal(node);
}

// "Issues / Feature Request" popup.
function openIssuesModal() {
  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>Issues / Feature Request</h2><button class="x-btn" data-x>×</button></div>
    <div class="modal-body">
      <p>Found a bug or have an idea? Reach out either way:</p>
      <div class="issues-actions">
        <button id="issue-msg" class="btn btn-pin block">Message us on Nostr</button>
        <a id="issue-gh" class="btn btn-ghost block" href="${escapeHtml(ISSUES_GITHUB_URL)}" target="_blank" rel="noopener noreferrer">Open the GitHub page</a>
      </div>
    </div>
  </div>`);
  node.querySelector('#issue-msg').onclick = () => {
    if (isValidNpub(ISSUES_CONTACT_NPUB)) { closeModal(); A.openChatWith(ISSUES_CONTACT_NPUB); }
    else { toast('Contact npub not set yet — try the GitHub page'); }
  };
  node.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  openModal(node);
}

function openDonateModal() {
  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>Donate</h2><button class="x-btn" data-x>×</button></div>
    <div class="modal-body donate-body">
      <p class="donate-title">Donations appreciated!</p>
      <p class="donate-addr mono" id="donate-spark" title="Tap to copy">${escapeHtml(DONATE_SPARK)}</p>
      <p class="donate-strike" id="donate-strike" title="Tap to copy">${escapeHtml(DONATE_STRIKE)}</p>
    </div>
  </div>`);
  node.querySelector('#donate-spark').onclick = () => { navigator.clipboard?.writeText(DONATE_SPARK); toast('Address copied'); };
  node.querySelector('#donate-strike').onclick = () => { navigator.clipboard?.writeText(DONATE_STRIKE); toast('Copied'); };
  node.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  openModal(node);
}

// Tapping a "N pins" cluster lists the people at that address to choose from.
export function openClusterList(people) {
  const body = h('<div class="people-list"></div>');
  for (const p of people) {
    const row = h(`<div class="person-row">
      <div class="person-avatar">${escapeHtml(initials(p.name))}</div>
      <div class="person-meta">
        <div class="name">${escapeHtml(p.name || 'Unnamed')}</div>
        <div class="sub">${escapeHtml(p.knownFrom || 'Pinned here')}</div>
      </div>
    </div>`);
    row.onclick = () => { closePanel(); A.openCardView(p.id); };
    body.appendChild(row);
  }
  openPanel(`${people.length} people at this address`, body);
}

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  const n = (name || '').trim();
  if (!n) return '?';
  return n.split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function shortNpub(npub) { return npub ? npub.slice(0, 12) + '…' + npub.slice(-6) : ''; }

// Does this relative have their own person card? Matches by npub, or by name at
// the same spot (the same rule used when relatives are turned into cards).
function findRelativeCard(r) {
  const people = getState().dataset.people || [];
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  return people.find((p) =>
    (r.npub && p.npub && p.npub === r.npub) ||
    (r.lat != null && r.name && p.name && p.location &&
      p.name.toLowerCase() === r.name.toLowerCase() &&
      near(p.location.lat, r.lat) && near(p.location.lng, r.lng))
  ) || null;
}

// The display name for a chat peer, if their npub matches someone on your map
// (a person card or your own card). Returns null when they're not on the map.
function nameForNpub(npub) {
  if (!npub) return null;
  const ds = getState().dataset;
  const all = (ds.people || []).concat(ds.self ? [ds.self] : []);
  const p = all.find((x) => x.npub && x.npub === npub && x.name);
  return p ? p.name : null;
}
function nameForHex(hex) {
  let npub; try { npub = hexToNpub(hex); } catch { return null; }
  return nameForNpub(npub);
}
function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function toast(message, isError = false) {
  const root = $('toast-root');
  const t = h(`<div class="toast ${isError ? 'err' : ''}">${escapeHtml(message)}</div>`);
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

// --------------------------------------------------------------------------
// Theme + screens
// --------------------------------------------------------------------------
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name=theme-color]')
    ?.setAttribute('content', theme === 'light' ? '#E8EBEF' : '#0D1218');
  map.setTheme(theme);
  updateThemeButton(theme);
}
export function showScreen(name) {
  $('screen-login').classList.toggle('hidden', name !== 'login');
  $('screen-app').classList.toggle('hidden', name !== 'app');
}

// --------------------------------------------------------------------------
// Login screen relay list
// --------------------------------------------------------------------------
export function renderLoginRelays(state) {
  const ul = $('login-relay-list');
  if (!ul) return;
  ul.innerHTML = '';
  for (const url of state.dataset.settings.relays) {
    const status = state.relayStatus[url] || 'connecting';
    ul.appendChild(h(`
      <li class="relay-row">
        <span class="dot ${status}"></span>
        <span class="url">${escapeHtml(url)}</span>
        <span class="muted xsmall">${status}</span>
      </li>`));
  }
}

// --------------------------------------------------------------------------
// Top-bar unread bubble
// --------------------------------------------------------------------------
export function renderChrome() {
  const n = totalUnread();
  const b = $('chat-bubble');
  if (b) {
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', n === 0);
  }
  const merges = Object.keys(getState().pendingMerges || {}).length;
  const pb = $('people-bubble');
  if (pb) {
    pb.textContent = merges > 99 ? '99+' : String(merges);
    pb.classList.toggle('hidden', merges === 0);
  }
}

// --------------------------------------------------------------------------
// Panel + modal plumbing (one panel and/or one modal at a time)
// --------------------------------------------------------------------------
export function openPanel(title, bodyNode, footNode) {
  const panel = $('panel');
  panel.innerHTML = '';
  panel.appendChild(h(`<div class="panel-head"><h2>${escapeHtml(title)}</h2><button class="x-btn" aria-label="Close">×</button></div>`));
  panel.querySelector('.x-btn').onclick = closePanel;
  const body = h('<div class="panel-body"></div>');
  body.appendChild(bodyNode);
  panel.appendChild(body);
  if (footNode) { const f = h('<div class="panel-foot"></div>'); f.appendChild(footNode); panel.appendChild(f); }
  panel.classList.remove('hidden');
  $('overlay').classList.remove('hidden');
  $('overlay').onclick = closePanel;
}
export function closePanel() {
  $('panel').classList.add('hidden');
  if (!$('modal-root').hasChildNodes()) $('overlay').classList.add('hidden');
  A.onPanelClosed && A.onPanelClosed();
}
export function openModal(node, onDismiss) {
  const root = $('modal-root');
  root.innerHTML = '';
  const scrim = h('<div class="modal-scrim"></div>');
  scrim.appendChild(node);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) { if (onDismiss) onDismiss(); else closeModal(); } });
  root.appendChild(scrim);
}
export function closeModal() {
  const root = $('modal-root'); if (root) root.innerHTML = '';
  const panel = $('panel');
  if (!panel || panel.classList.contains('hidden')) { const ov = $('overlay'); if (ov) ov.classList.add('hidden'); }
}

export function showLoading(text) {
  const el = $('app-loading'); if (!el) return;
  const t = $('app-loading-text'); if (t) t.textContent = text || 'Loading…';
  el.classList.remove('hidden');
}
export function hideLoading() { const el = $('app-loading'); if (el) el.classList.add('hidden'); }

// --------------------------------------------------------------------------
// Confirm dialog
// --------------------------------------------------------------------------
export function confirm({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  const node = h(`
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${escapeHtml(title)}</h2></div>
      <div class="modal-body"><p style="line-height:1.55">${message}</p></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-x>Cancel</button>
        <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-yes>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>`);
  node.querySelector('[data-x]').onclick = closeModal;
  node.querySelector('[data-yes]').onclick = () => { closeModal(); onConfirm && onConfirm(); };
  openModal(node);
}

// --------------------------------------------------------------------------
// People panel
// --------------------------------------------------------------------------
export function openPeoplePanel() {
  const state = getState();
  const body = h('<div></div>');
  body.appendChild(h('<input class="input people-search" placeholder="Search people…" />'));
  const list = h('<div class="people-list"></div>');
  body.appendChild(list);

  const draw = (q = '') => {
    list.innerHTML = '';
    const people = state.dataset.people
      .filter((p) => (p.name || '').toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => firstName(a.name).localeCompare(firstName(b.name), undefined, { sensitivity: 'base' }));
    if (people.length === 0) {
      list.appendChild(h(`<div class="empty-state">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3.4"/><path d="M3 19a6 6 0 0 1 12 0"/></svg>
        <p>No people yet. Tap <b>Add person</b> to pin someone.</p></div>`));
      return;
    }
    for (const p of people) {
      const hasMerge = !!getState().pendingMerges[p.id];
      const row = h(`<div class="person-row ${hasMerge ? 'has-merge' : ''}">
        <div class="person-avatar">${escapeHtml(initials(p.name))}</div>
        <div class="person-meta">
          <div class="name">${escapeHtml(p.name || 'Unnamed')}${hasMerge ? '<span class="merge-dot" title="A shared update is ready to merge"></span>' : ''}</div>
          <div class="sub">${hasMerge ? 'Tap to review &amp; merge a shared update' : escapeHtml(p.knownFrom || (p.location ? 'Pinned on map' : 'No location'))}</div>
        </div>
      </div>`);
      row.onclick = () => { if (hasMerge) A.openMerge(p.id); else A.openCardView(p.id); };
      list.appendChild(row);
    }
  };
  body.querySelector('.people-search').addEventListener('input', (e) => draw(e.target.value));
  draw();

  const foot = h('<button class="btn btn-pin block">Add a person</button>');
  foot.onclick = () => { closePanel(); A.openEditorNew(); };
  openPanel('People', body, foot);
}

// --------------------------------------------------------------------------
// Card view (read-only)
// --------------------------------------------------------------------------
export function openCardView(idOrSelf) {
  const state = getState();
  const isSelf = idOrSelf === 'self';
  const card = isSelf ? state.dataset.self : state.dataset.people.find((p) => p.id === idOrSelf);
  if (!card) { toast('Card not found', true); return; }

  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head">
      <h2>${isSelf ? 'My information' : ''}</h2>
      <button class="x-btn" data-x>×</button>
    </div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div>
  </div>`);
  const body = node.querySelector('.modal-body');
  const foot = node.querySelector('.modal-foot');

  body.appendChild(h(`<div class="card-top">
    <div class="card-photo placeholder">${escapeHtml(initials(card.name))}</div>
    <div>
      <h2>${escapeHtml(card.name || 'Unnamed')}</h2>
      ${card.sharedBy ? `<div class="card-shared">shared by ${escapeHtml(shortNpub(card.sharedBy))}</div>` : ''}
    </div>
  </div>`));

  // Location: address with coordinates beneath it in parentheses, or just the
  // coordinates (with a pin) if there's no physical address. A small gap sits
  // below the name block above and this block.
  if (card.location) {
    body.appendChild(h(card.address
      ? `<div class="card-loc">
           <div class="card-loc-line">📍 ${escapeHtml(card.address)} <span class="card-loc-coord">(${card.location.lat}, ${card.location.lng})</span></div>
         </div>`
      : `<div class="card-loc">
           <div class="card-loc-line">📍 ${card.location.lat}, ${card.location.lng}</div>
         </div>`));
  }

  const detail = (k, v) => v ? body.appendChild(h(`<div class="detail"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`)) : null;
  if (card.npub) body.appendChild(h(`<div class="detail"><div class="k">Their npub</div><div class="v mono npub-full">${escapeHtml(card.npub)}</div></div>`));
  detail('Birthday', card.birthday);
  detail('Pets', card.pets);
  detail('Where you know them from', card.knownFrom);
  detail('Notes', card.notes);

  if ((card.relatives || []).length) {
    const ownerId = isSelf ? 'self' : card.id;
    const wrap = h('<div class="detail"><div class="k">Relatives &amp; children</div></div>');
    card.relatives.forEach((r, idx) => {
      const hasLoc = (r.lat != null && r.lng != null);
      const hasNpub = r.npub && isValidNpub(r.npub);
      const relCard = findRelativeCard(r);
      const line = h(`<div class="rel-line">
        <div class="rel-head">
          <span class="rel-type">${escapeHtml(r.type)}</span>
          <span class="v">${escapeHtml(r.name || '—')}</span>
          ${r.npub ? `<span class="rel-npub">${escapeHtml(shortNpub(r.npub))}</span>` : ''}
        </div>
        <div class="rel-actions">
          ${relCard ? `<button class="btn btn-ghost xsmall rel-act-card">Show card</button>` : ''}
          ${hasLoc ? `<button class="btn btn-ghost xsmall rel-act-map">Show on map</button>` : ''}
          ${hasNpub ? `<button class="btn btn-ghost xsmall rel-act-msg">Send message</button>` : ''}
          <button class="btn btn-ghost xsmall rel-act-remove">Remove relationship</button>
        </div>
      </div>`);
      if (relCard) line.querySelector('.rel-act-card').onclick = () => { closeModal(); openCardView(relCard.id); };
      if (hasLoc) line.querySelector('.rel-act-map').onclick = () => { closeModal(); map.panTo(r.lat, r.lng); };
      if (hasNpub) line.querySelector('.rel-act-msg').onclick = () => { closeModal(); A.openChatWith(r.npub); };
      line.querySelector('.rel-act-remove').onclick = () => confirm({
        title: 'Remove relationship?',
        message: `This removes <b>${escapeHtml(r.name || 'this relative')}</b> as a relationship on this card. Their own pin and card (if any) stay.`,
        confirmLabel: 'Remove', danger: true,
        onConfirm: () => { closeModal(); A.removeRelative(ownerId, idx); },
      });
      wrap.appendChild(line);
    });
    body.appendChild(wrap);
  }

  // Footer actions
  if (card.location) {
    const view = h('<button class="btn btn-ghost">Show on map</button>');
    view.onclick = () => { closeModal(); map.panTo(card.location.lat, card.location.lng); };
    foot.appendChild(view);
  }
  if (!isSelf && card.npub && isValidNpub(card.npub)) {
    const msg = h('<button class="btn btn-ghost">Send message</button>');
    msg.onclick = () => { closeModal(); A.openChatWith(card.npub); };
    foot.appendChild(msg);
  }
  if (isSelf) {
    const share = h('<button class="btn btn-pin">Share with…</button>');
    share.onclick = () => { closeModal(); openShareModal(''); };
    foot.appendChild(share);
  }
  const edit = h('<button class="btn btn-primary">Edit</button>');
  edit.onclick = () => { closeModal(); A.openEditor(isSelf ? 'self' : card.id); };
  foot.appendChild(edit);

  if (!isSelf) {
    const del = h('<button class="btn btn-danger">Delete</button>');
    del.onclick = () => confirm({
      title: 'Delete this card?',
      message: `This removes <b>${escapeHtml(card.name || 'this person')}</b> from your notebook. This can't be undone.`,
      confirmLabel: 'Delete', danger: true,
      onConfirm: () => { A.deletePerson(card.id); closeModal(); toast('Card deleted'); },
    });
    foot.appendChild(del);
  }
  node.querySelector('[data-x]').onclick = closeModal;
  openModal(node);
}

// --------------------------------------------------------------------------
// Card editor (create / edit, for people and self)
// --------------------------------------------------------------------------
export function openEditor(idOrSelf) {
  const state = getState();
  editorIsSelf = idOrSelf === 'self';
  if (idOrSelf === 'new') { editorDraft = emptyCard(); editorId = null; }
  else if (editorIsSelf) { editorDraft = state.dataset.self ? deepCopy(state.dataset.self) : emptyCard(); editorId = 'self'; }
  else { const c = state.dataset.people.find((p) => p.id === idOrSelf); editorDraft = c ? deepCopy(c) : emptyCard(); editorId = idOrSelf; }
  renderEditor();
}

function renderEditor() {
  const c = editorDraft;
  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${editorIsSelf ? 'My information' : (editorId ? 'Edit person' : 'Add person')}</h2><button class="x-btn" data-x>×</button></div>
    <div class="modal-body">
      <div class="name-row">
        <div class="name-field">
          <label class="field-label">Name</label>
          <input id="ed-name" class="input" value="${escapeHtml(c.name)}" placeholder="Their name" />
        </div>
        <div class="bday-field">
          <label class="field-label">Birthday</label>
          <input id="ed-birthday" class="input" type="date" value="${escapeHtml(c.birthday)}" />
        </div>
      </div>

      ${editorIsSelf ? '' : `
      <label class="field-label">Their npub (optional — lets you chat & share)</label>
      <input id="ed-npub" class="input mono" value="${escapeHtml(c.npub || '')}" placeholder="npub1…" />`}

      <label class="field-label">Pets</label>
      <input id="ed-pets" class="input" value="${escapeHtml(c.pets)}" placeholder="e.g. dog, Rex" />

      ${editorIsSelf ? '' : `
      <label class="field-label">Where you know them from</label>
      <input id="ed-knownfrom" class="input" value="${escapeHtml(c.knownFrom)}" placeholder="e.g. conference, gym, neighbour" />`}

      <label class="field-label">General notes</label>
      <textarea id="ed-notes" class="input" placeholder="Anything you want to remember">${escapeHtml(c.notes)}</textarea>

      <label class="field-label">Relatives &amp; children</label>
      <div id="ed-relatives"></div>
      <button id="ed-add-rel" class="btn btn-ghost small">+ Add relative or child</button>

      <hr class="ed-divider" />
      <label class="field-label">Location</label>
      <button id="ed-pin" class="btn btn-pin block">${c.location ? 'Move pin / change address' : 'Set address or pin'}</button>
      <div id="ed-pin-status" class="pin-status ${c.location ? 'set' : ''}">${locationStatusHtml(c)}</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-x>Cancel</button>
      <button class="btn btn-primary" id="ed-save">Save</button>
    </div>
  </div>`);

  // location: address OR pin
  node.querySelector('#ed-pin').onclick = () => {
    editorDraft = captureEditorForm(node);
    closeModal();
    chooseLocation({
      title: editorIsSelf ? 'Set your location' : `Set ${editorDraft.name || 'this person'}'s location`,
      onResult: (loc) => {
        if (loc) { editorDraft.location = { lat: loc.lat, lng: loc.lng }; editorDraft.address = loc.address || ''; }
        renderEditor();
      },
    });
  };

  // relatives — added/removed in place so the view doesn't jump to the top
  const relWrap = node.querySelector('#ed-relatives');
  renderRelatives(relWrap, node);
  node.querySelector('#ed-add-rel').onclick = () => {
    editorDraft = captureEditorForm(node);
    editorDraft.relatives.push(emptyRelative());
    renderRelatives(relWrap, node);   // rebuild only the relatives list, keep scroll
  };

  node.querySelector('#ed-save').onclick = () => {
    const card = captureEditorForm(node);
    if (!card.name.trim()) { toast('Give them a name first', true); return; }
    if (card.npub && !isValidNpub(card.npub)) { toast('That npub doesn\'t look valid', true); return; }
    A.saveCard(card, editorIsSelf, editorId);
    closeModal();
    toast(editorIsSelf ? 'Your info saved' : 'Card saved');
  };
  node.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  openModal(node);
}

// How the location reads in the editor / card: address (if any) + coordinates,
// each with its own pin icon.
function locationStatusHtml(c) {
  if (!c.location) return 'No location set';
  if (c.address) {
    return `📍 ${escapeHtml(c.address)} <span class="mono xsmall">(${c.location.lat}, ${c.location.lng})</span>`;
  }
  return `📍 <span class="mono xsmall">${c.location.lat}, ${c.location.lng}</span>`;
}

function relLocationHtml(r) {
  if (r.lat == null) return 'No location';
  if (r.address) {
    return `📍 ${escapeHtml(r.address)} <span class="mono xsmall">(${r.lat}, ${r.lng})</span>`;
  }
  return `📍 <span class="mono xsmall">${r.lat}, ${r.lng}</span>`;
}

function renderRelatives(wrap, node) {
  wrap.innerHTML = '';
  editorDraft.relatives.forEach((r, i) => {
    const block = h(`<div class="rel-block" data-index="${i}">
      <button class="rel-remove" title="Remove">×</button>
      <label class="field-label" style="margin-top:0">Relationship</label>
      <select class="input rel-type">${RELATIVE_TYPES.map((t) => `<option ${t === r.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="field-label">Name</label>
      <input class="input rel-name" value="${escapeHtml(r.name)}" placeholder="Relative's name" />
      <label class="field-label">Their npub (if known)</label>
      <input class="input mono rel-npub-in" value="${escapeHtml(r.npub)}" placeholder="npub1…" />
      <button class="btn btn-ghost small rel-pin">${(r.lat != null) ? 'Move pin / change address' : 'Set address or pin'}</button>
      <div class="pin-status ${(r.lat != null) ? 'set' : ''}">${relLocationHtml(r)}</div>
    </div>`);
    block.querySelector('.rel-remove').onclick = () => {
      editorDraft = captureEditorForm(node);
      editorDraft.relatives.splice(i, 1);
      renderRelatives(wrap, node);   // rebuild only the list, keep scroll position
    };
    block.querySelector('.rel-pin').onclick = () => {
      editorDraft = captureEditorForm(node);
      const name = editorDraft.relatives[i].name || 'this relative';
      closeModal();
      chooseLocation({
        title: `Set ${name}'s location`,
        onResult: (loc) => {
          if (loc) {
            editorDraft.relatives[i].lat = loc.lat;
            editorDraft.relatives[i].lng = loc.lng;
            editorDraft.relatives[i].address = loc.address || '';
          }
          renderEditor();
        },
      });
    };
    wrap.appendChild(block);
  });
}

// Read all visible fields into a card object, preserving picture/location/address
// (which live in the draft, not in editable text fields).
function captureEditorForm(node) {
  const d = deepCopy(editorDraft);
  const val = (sel) => { const e = node.querySelector(sel); return e ? e.value.trim() : ''; };
  d.name = val('#ed-name');
  d.birthday = val('#ed-birthday');
  d.pets = val('#ed-pets');
  // npub and "where you know them from" aren't shown on your own card, so only
  // overwrite them when their inputs are actually present.
  const npubEl = node.querySelector('#ed-npub'); if (npubEl) d.npub = npubEl.value.trim();
  const knownEl = node.querySelector('#ed-knownfrom'); if (knownEl) d.knownFrom = knownEl.value.trim();
  d.notes = node.querySelector('#ed-notes') ? node.querySelector('#ed-notes').value : d.notes;
  // relatives text fields (lat/lng/address already preserved in the draft copy)
  node.querySelectorAll('.rel-block').forEach((block) => {
    const i = +block.dataset.index;
    if (!d.relatives[i]) return;
    d.relatives[i].type = block.querySelector('.rel-type').value;
    d.relatives[i].name = block.querySelector('.rel-name').value.trim();
    d.relatives[i].npub = block.querySelector('.rel-npub-in').value.trim();
  });
  return d;
}

// --------------------------------------------------------------------------
// Merge modal: reconcile your card with a friend's shared update
// --------------------------------------------------------------------------
export function openMergeModal(personId) {
  const yours = getPerson(personId);
  const pend = getPendingMerge(personId);
  if (!yours || !pend) { toast('Nothing to merge', true); return; }
  const theirs = pend.incoming;
  const shareId = theirs.id;
  const conflicts = pend.conflicts || {};

  // Only name and pets can ever need a choice — and only when they truly clash
  // (both sides have data and differ). Their location/address is auto-applied.
  const fieldDefs = [
    { key: 'name', label: 'Name' },
    { key: 'pets', label: 'Pets' },
  ].filter((f) => conflicts[f.key] != null);

  if (!fieldDefs.length) { A.commitMerge(personId, deepCopy(yours), shareId); toast('Up to date'); return; }

  const merged = deepCopy(yours);   // already has their location applied
  const node = h(`<div class="modal modal-wide" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>Merge: ${escapeHtml(yours.name || 'this person')}</h2><button class="x-btn" data-x>×</button></div>
    <div class="modal-body">
      <p class="muted small">${escapeHtml(theirs.name || 'They')} shared their card and their location was applied automatically. Choose what to keep for the fields below, then press <b>Merge</b>.</p>
      <div id="merge-rows"></div>
    </div>
    <div class="modal-foot merge-foot">
      <button class="btn btn-ghost" id="merge-mine">Keep mine</button>
      <button class="btn btn-primary" id="merge-go">Merge</button>
    </div>
  </div>`);
  const rowsWrap = node.querySelector('#merge-rows');

  fieldDefs.forEach((f) => {
    const yv = yours[f.key] || '';
    const tv = conflicts[f.key] || '';
    const row = h(`<div class="merge-row">
      <div class="merge-label">${escapeHtml(f.label)}</div>
      <div class="merge-cols">
        <div class="merge-col"><div class="merge-side">Yours</div><div class="merge-val">${yv ? escapeHtml(yv) : '<span class="muted">—</span>'}</div><button class="btn btn-ghost xsmall merge-keep chosen" data-side="yours" ${yv ? '' : 'disabled'}>Keep</button></div>
        <div class="merge-col"><div class="merge-side">Theirs</div><div class="merge-val">${tv ? escapeHtml(tv) : '<span class="muted">—</span>'}</div><button class="btn btn-ghost xsmall merge-keep" data-side="theirs" ${tv ? '' : 'disabled'}>Keep</button></div>
      </div>
      <input class="input merge-input" value="${escapeHtml(merged[f.key] || '')}" />
    </div>`);
    const input = row.querySelector('.merge-input');
    input.addEventListener('input', () => { merged[f.key] = input.value; });
    row.querySelectorAll('.merge-keep').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.dataset.side === 'yours' ? yv : tv;
        merged[f.key] = v; input.value = v;
        row.querySelectorAll('.merge-keep').forEach((b) => b.classList.remove('chosen'));
        btn.classList.add('chosen');
      };
    });
    rowsWrap.appendChild(row);
  });

  node.querySelector('#merge-go').onclick = () => {
    if (!merged.name || !merged.name.trim()) { toast('The merged card needs a name', true); return; }
    A.commitMerge(personId, merged, shareId);
    closeModal();
  };
  node.querySelector('#merge-mine').onclick = () => {
    A.commitMerge(personId, deepCopy(yours), shareId);
    closeModal();
  };
  node.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  openModal(node);
}

// --------------------------------------------------------------------------
// Pin-picking handoff (hides UI, shows banner, waits for a map tap)
// --------------------------------------------------------------------------
function startPick(message, onPicked, onCancel) {
  const banner = $('pick-banner');
  $('pick-banner-text').textContent = message;
  $('pick-confirm').classList.add('hidden');
  banner.classList.remove('hidden');
  $('overlay').classList.add('hidden');
  map.enablePickMode('map', (loc) => {
    banner.classList.add('hidden');
    onPicked(loc);
  });
  $('pick-cancel').onclick = () => {
    banner.classList.add('hidden');
    map.cancelPickMode('map');
    if (onCancel) onCancel();
    else renderEditor(); // default: come back to the editor unchanged
  };
}

// Show a draft pin on the map and ask the user to confirm its placement.
function startConfirm(message, onConfirm, onCancel) {
  const banner = $('pick-banner');
  $('pick-banner-text').textContent = message;
  banner.classList.remove('hidden');
  $('overlay').classList.add('hidden');
  const confirmBtn = $('pick-confirm');
  confirmBtn.classList.remove('hidden');
  confirmBtn.onclick = () => { banner.classList.add('hidden'); confirmBtn.classList.add('hidden'); onConfirm(); };
  $('pick-cancel').onclick = () => { banner.classList.add('hidden'); confirmBtn.classList.add('hidden'); if (onCancel) onCancel(); };
}

// Let the user set a location by SEARCHING AN ADDRESS or PLACING A PIN.
// Calls onResult({ lat, lng, address }) on success, or onResult(null) if cancelled.
function chooseLocation({ title, onResult }) {
  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${escapeHtml(title || 'Set location')}</h2><button class="x-btn" data-x>×</button></div>
    <div class="modal-body">
      <label class="field-label">Search an address</label>
      <div class="addr-row">
        <input id="addr-q" class="input" placeholder="e.g. 350 Fifth Ave, New York" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="wwt-addr-search" />
        <button id="addr-search" class="btn btn-ghost small">Search</button>
      </div>
      <div id="addr-results" class="addr-results"></div>
      <div class="addr-or"><span>or</span></div>
      <button id="addr-manual" class="btn btn-pin block">Place a pin manually</button>
    </div>
  </div>`);
  const results = node.querySelector('#addr-results');

  const doSearch = async () => {
    const q = node.querySelector('#addr-q').value;
    if (!q.trim()) return;
    results.innerHTML = '<div class="muted small">Searching…</div>';
    try {
      const list = await searchAddress(q);
      if (!list.length) { results.innerHTML = noMatchHtml(); return; }
      results.innerHTML = '';
      list.forEach((r) => {
        const item = h(`<button class="addr-item"></button>`);
        item.textContent = r.address;
        item.onclick = () => confirmAddress(r);
        results.appendChild(item);
      });
    } catch (e) {
      results.innerHTML = `<div class="muted small">${escapeHtml(e.message || 'Search failed')}. You can place a pin manually.</div>`;
    }
  };

  node.querySelector('#addr-search').onclick = doSearch;
  node.querySelector('#addr-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  node.querySelector('#addr-manual').onclick = () => {
    closeModal();
    startPick('Tap the map to drop a pin',
      (loc) => afterManualPin(loc),
      () => onResult(null));
  };
  const dismiss = () => { closeModal(); onResult(null); };
  node.querySelectorAll('[data-x]').forEach((b) => b.onclick = dismiss);
  openModal(node, dismiss);

  function confirmAddress(r) {
    closeModal();
    map.showDraftPin({ lat: r.lat, lng: r.lng });
    startConfirm(`Place pin at: ${r.address}`,
      () => { map.clearDraftPin(); onResult({ lat: r.lat, lng: r.lng, address: r.address }); },
      () => { map.clearDraftPin(); chooseLocation({ title, onResult }); }); // back to search
  }

  // After a manual pin, see if it lands on a known address and let the user
  // confirm it, type a different one, or just keep the coordinates.
  async function afterManualPin(loc) {
    const coords = { lat: loc.lat, lng: loc.lng };
    let address = null;
    try { address = await reverseGeocode(loc.lat, loc.lng); } catch { address = null; }
    if (!address) { onResult({ ...coords, address: '' }); return; }

    const m = h(`<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>Is this the address?</h2><button class="x-btn" data-x>×</button></div>
      <div class="modal-body">
        <p class="muted small">Your pin looks like it's at:</p>
        <div class="addr-found">📍 ${escapeHtml(address)}</div>
        <div class="addr-choice">
          <button class="btn btn-primary block" id="pin-use-addr">Use this address</button>
          <button class="btn btn-ghost block" id="pin-diff-addr">Enter a different address</button>
          <button class="btn btn-ghost block" id="pin-coords">Use coordinates only</button>
        </div>
      </div>
    </div>`);
    m.querySelector('#pin-use-addr').onclick = () => { closeModal(); onResult({ ...coords, address }); };
    m.querySelector('#pin-diff-addr').onclick = () => { closeModal(); chooseLocation({ title, onResult }); };
    m.querySelector('#pin-coords').onclick = () => { closeModal(); onResult({ ...coords, address: '' }); };
    m.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => { closeModal(); onResult({ ...coords, address: '' }); });
    openModal(m);
  }
}

// Shown when an address search finds nothing. Encourages OSM contribution.
function noMatchHtml() {
  return `<div class="muted small no-match">Couldn't find that address. If it's correct, it may not be on <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> yet — consider adding it there. Or place a pin manually below.</div>`;
}

// New-person flow: choose a location (address or pin) FIRST, then fill details.
export function openNewPersonPinFirst() {
  closeModal();
  closePanel();
  chooseLocation({
    title: 'Where do you know this person?',
    onResult: (loc) => {
      if (!loc) return; // cancelled — abort, don't open an empty editor
      editorDraft = emptyCard();
      editorDraft.location = { lat: loc.lat, lng: loc.lng };
      editorDraft.address = loc.address || '';
      editorIsSelf = false;
      editorId = 'new';
      renderEditor();
    },
  });
}

// --------------------------------------------------------------------------
// Share modal
// --------------------------------------------------------------------------
export function openShareModal(prefill) {
  const sharedWith = getState().dataset.sharedWith || [];
  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>Share my info</h2><button class="x-btn" data-x>×</button></div>
    <div class="modal-body">
      <p class="muted small" style="line-height:1.55">The person you choose will get your card and pin added to their map automatically. When you edit your card later, their copy updates too. Only share with people you trust.</p>
      <label class="field-label">Their npub</label>
      <input id="share-npub" class="input mono" placeholder="npub1…" value="${escapeHtml(prefill || '')}" />
      <div id="shared-with-wrap"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-x>Cancel</button>
      <button class="btn btn-pin" id="share-go">Share with this person</button>
    </div>
  </div>`);

  const wrap = node.querySelector('#shared-with-wrap');
  const drawSharedWith = () => {
    const list = getState().dataset.sharedWith || [];
    wrap.innerHTML = '';
    if (!list.length) return;
    wrap.appendChild(h('<label class="field-label" style="margin-top:18px">People you\'ve shared with</label>'));
    const ul = h('<ul class="shared-list"></ul>');
    for (const np of list) {
      const li = h(`<li class="shared-row"><span class="url mono">${escapeHtml(shortNpub(np))}</span><button class="btn btn-ghost xsmall">Unshare</button></li>`);
      li.querySelector('button').onclick = () => {
        A.unshareWith(np);
        drawSharedWith();
      };
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
  };
  drawSharedWith();

  node.querySelector('#share-go').onclick = () => {
    const npub = node.querySelector('#share-npub').value.trim();
    if (!isValidNpub(npub)) { toast('Enter a valid npub', true); return; }
    confirm({
      title: 'Share your info?',
      message: `Your card and location will be sent to <b>${escapeHtml(shortNpub(npub))}</b> and added to their map. Continue?`,
      confirmLabel: 'Yes, share',
      onConfirm: async () => { closeModal(); await A.shareWith(npub); },
    });
  };
  node.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  openModal(node);
}

// --------------------------------------------------------------------------
// Chat panel
// --------------------------------------------------------------------------
export function openChatPanel(peerHexToOpen) {
  const state = getState();
  const body = h('<div></div>');

  // New conversation starter
  const starter = h(`<div class="new-chat-row">
    <input class="input mono" id="chat-new-npub" placeholder="Start a chat: npub1…" />
    <button class="btn btn-ghost small" id="chat-new-go">Open</button>
  </div>`);
  starter.querySelector('#chat-new-go').onclick = () => {
    const npub = starter.querySelector('#chat-new-npub').value.trim();
    if (!isValidNpub(npub)) { toast('Enter a valid npub', true); return; }
    A.openChatWith(npub);
  };
  body.appendChild(starter);

  const peers = Object.keys(state.conversations)
    .map((hex) => ({ hex, c: state.conversations[hex], name: nameForHex(hex) }))
    .sort((a, b) => lastTs(b.c) - lastTs(a.c));

  if (peers.length === 0) {
    body.appendChild(h('<div class="empty-state"><p>No conversations yet. Paste someone\'s npub above to start one.</p></div>'));
  } else {
    const onMap = peers.filter((p) => p.name);
    const others = peers.filter((p) => !p.name);

    const renderGroup = (title, arr) => {
      if (!arr.length) return;
      body.appendChild(h(`<div class="conv-group-head">${escapeHtml(title)}</div>`));
      const list = h('<div class="conv-list"></div>');
      arr.forEach(({ hex, c, name }) => {
        const last = c.messages[c.messages.length - 1];
        const display = name || shortNpub(hexToNpub(hex));
        const avatar = name ? initials(name) : hexToNpub(hex).slice(5, 7).toUpperCase();
        const row = h(`<div class="conv-row">
          <div class="conv-avatar">${escapeHtml(avatar)}</div>
          <div class="conv-meta">
            <div class="who">${escapeHtml(display)}</div>
            <div class="last">${last ? escapeHtml((last.mine ? 'You: ' : '') + last.text) : 'No messages yet'}</div>
          </div>
          ${c.unread ? `<span class="conv-unread">${c.unread}</span>` : ''}
        </div>`);
        row.onclick = () => A.openChatWith(hexToNpub(hex));
        list.appendChild(row);
      });
      body.appendChild(list);
    };

    renderGroup('People on your map', onMap);
    renderGroup('Other chats', others);
  }

  openPanel('Messages', body);

  if (peerHexToOpen) openThread(peerHexToOpen);
}

// A single conversation thread (replaces the panel body).
export function openThread(peerHex) {
  const state = getState();
  const conv = state.conversations[peerHex] || { messages: [] };
  const npub = hexToNpub(peerHex);

  const panel = $('panel');
  panel.innerHTML = '';
  const name = nameForHex(peerHex);
  const headTop = name ? escapeHtml(name) : 'Chat';
  const headSub = name ? `(${escapeHtml(shortNpub(npub))})` : escapeHtml(shortNpub(npub));
  const head = h(`<div class="panel-head">
    <div style="display:flex;align-items:center;gap:10px;min-width:0">
      <button class="x-btn" id="thread-back" aria-label="Back">‹</button>
      <div style="min-width:0"><div style="font-weight:600">${headTop}</div><div class="chat-peer-head">${headSub}</div></div>
    </div>
    <button class="x-btn" id="thread-close" aria-label="Close">×</button>
  </div>`);
  panel.appendChild(head);

  const thread = h('<div class="panel-body"><div class="chat-thread"></div></div>');
  const threadInner = thread.querySelector('.chat-thread');
  for (const m of conv.messages) {
    threadInner.appendChild(h(`<div class="msg ${m.mine ? 'me' : 'them'}">${escapeHtml(m.text)}<span class="msg-time">${fmtTime(m.ts)}</span></div>`));
  }
  panel.appendChild(thread);

  const bar = h(`<div class="chat-input-bar">
    <input class="input" id="chat-msg" placeholder="Type a message…" autocomplete="off" />
    <button class="btn btn-primary" id="chat-send">Send</button>
  </div>`);
  panel.appendChild(bar);

  const send = () => {
    const input = bar.querySelector('#chat-msg');
    const text = input.value;
    if (!text.trim()) return;
    input.value = '';
    A.sendChat(peerHex, text);
  };
  bar.querySelector('#chat-send').onclick = send;
  bar.querySelector('#chat-msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  head.querySelector('#thread-back').onclick = () => openChatPanel();
  head.querySelector('#thread-close').onclick = closePanel;

  panel.classList.remove('hidden');
  $('overlay').classList.remove('hidden');
  $('overlay').onclick = closePanel;
  setTimeout(() => { threadInner.scrollTop = threadInner.scrollHeight; bar.querySelector('#chat-msg').focus(); }, 50);
}

// If a thread is open for this peer, append the newest message live.
export function refreshOpenThread() {
  const state = getState();
  const peer = state.activeChatPeer;
  if (!peer || state.openPanel !== 'chat-thread') return;
  const inner = document.querySelector('#panel .chat-thread');
  if (!inner) return;
  const conv = state.conversations[peer];
  if (!conv) return;
  inner.innerHTML = '';
  for (const m of conv.messages) {
    inner.appendChild(h(`<div class="msg ${m.mine ? 'me' : 'them'}">${escapeHtml(m.text)}<span class="msg-time">${fmtTime(m.ts)}</span></div>`));
  }
  inner.scrollTop = inner.scrollHeight;
}

// --------------------------------------------------------------------------
// Settings panel
// --------------------------------------------------------------------------
export function openSettingsPanel() {
  const state = getState();
  const s = state.dataset.settings;
  const body = h('<div></div>');

  // --- Location (now at the top) ---
  const loc = h(`<div class="set-section">
    <h3>Location</h3>
    <div class="set-row"><span>Find me on the map at login</span><button class="toggle ${s.shareLocationOnLogin ? 'on' : ''}" id="set-loc"></button></div>
  </div>`);
  loc.querySelector('#set-loc').onclick = () => A.toggleShareLocation(!s.shareLocationOnLogin);
  body.appendChild(loc);

  // --- Your identity (collapsible, collapsed by default) ---
  const nsec = getNsec();
  const idSection = h(`<details class="set-section set-collapse">
    <summary><h3>Your identity</h3><span class="chev" aria-hidden="true"></span></summary>
    <div class="set-collapse-body">
      <div class="set-row"><span>Public key (npub)</span></div>
      <div class="npub-chip" id="set-npub-chip">${escapeHtml(state.npub)}</div>
      <button class="btn btn-ghost small" id="set-copy-npub" style="margin-top:10px">Copy npub</button>

      <div class="set-row" style="margin-top:18px"><span>Private key (nsec)</span></div>
      <div class="npub-chip key-secret" id="set-nsec-chip">${'•'.repeat(24)}</div>
      <p class="muted small" style="margin-top:8px; line-height:1.5">This is the password to your whole account. Anyone with it controls your account — never share it. Keep a safe backup; it can't be recovered if lost.</p>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
        <button class="btn btn-ghost small" id="set-reveal-nsec">Reveal</button>
        <button class="btn btn-ghost small" id="set-copy-nsec">Copy private key</button>
      </div>
    </div>
  </details>`);
  body.appendChild(idSection);

  let nsecShown = false;
  const nsecChip = idSection.querySelector('#set-nsec-chip');
  idSection.querySelector('#set-reveal-nsec').onclick = (e) => {
    nsecShown = !nsecShown;
    nsecChip.textContent = nsecShown ? nsec : '•'.repeat(24);
    nsecChip.classList.toggle('revealed', nsecShown);
    e.target.textContent = nsecShown ? 'Hide' : 'Reveal';
  };
  idSection.querySelector('#set-copy-nsec').onclick = () => {
    navigator.clipboard?.writeText(nsec);
    toast('Private key copied — keep it safe');
  };
  idSection.querySelector('#set-copy-npub').onclick = () => { navigator.clipboard?.writeText(state.npub); toast('npub copied'); };

  // --- Relays (collapsible, collapsed by default) ---
  const relaySection = h(`<details class="set-section set-collapse">
    <summary><h3>Relays</h3><span class="chev" aria-hidden="true"></span></summary>
    <div class="set-collapse-body">
      <ul class="relay-list" id="set-relay-list"></ul>
      <div class="add-relay-row"><input class="input mono" id="set-relay-input" placeholder="wss://…" /><button class="btn btn-ghost small" id="set-relay-add">Add</button></div>
      <button class="btn btn-ghost small" id="set-relay-check" style="margin-top:10px">Re-check status</button>
    </div>
  </details>`);
  body.appendChild(relaySection);
  buildRelayListInto(relaySection.querySelector('#set-relay-list'), state, false);
  relaySection.querySelector('#set-relay-add').onclick = () => {
    const url = relaySection.querySelector('#set-relay-input').value.trim();
    A.addRelay(url, false);
    relaySection.querySelector('#set-relay-input').value = '';
  };
  relaySection.querySelector('#set-relay-check').onclick = () => A.checkRelays();

  // --- Account ---
  const account = h(`<div class="set-section">
    <h3>Account</h3>
    <button class="btn btn-ghost block" id="set-logout" style="margin-bottom:10px">Log out</button>
    <button class="btn btn-danger block" id="set-delete">Delete account</button>
  </div>`);
  account.querySelector('#set-logout').onclick = () => A.logout();
  account.querySelector('#set-delete').onclick = () => confirm({
    title: 'Delete account?',
    message: 'This erases your notebook (your card and everyone\'s cards) from your relays and logs you out. <b>This cannot be undone.</b><br><br>Note: your Nostr key itself can\'t be destroyed, and anything you already shared with others stays on their devices.',
    confirmLabel: 'Delete everything', danger: true,
    onConfirm: () => confirm({
      title: 'Are you absolutely sure?',
      message: 'Last chance — your saved data will be wiped from the relays.',
      confirmLabel: 'Yes, delete', danger: true,
      onConfirm: () => A.deleteAccount(),
    }),
  });
  body.appendChild(account);

  openPanel('Settings', body);
}

function buildRelayListInto(ul, state, atLogin) {
  ul.innerHTML = '';
  for (const url of state.dataset.settings.relays) {
    const status = state.relayStatus[url] || 'connecting';
    const li = h(`<li class="relay-row">
      <span class="dot ${status}"></span>
      <span class="url">${escapeHtml(url)}</span>
      <button class="remove" title="Remove" aria-label="Remove relay">×</button>
    </li>`);
    li.querySelector('.remove').onclick = () => A.removeRelay(url, atLogin);
    ul.appendChild(li);
  }
  return document.createComment('');
}

// Re-render the relay list live inside an open Settings panel.
export function refreshSettingsRelays() {
  const ul = document.querySelector('#set-relay-list');
  if (ul) buildRelayListInto(ul, getState(), false);
}

// --------------------------------------------------------------------------
// Location permission prompt (shown once after login)
// --------------------------------------------------------------------------
export function askLocationPrompt(onChoice) {
  const node = h(`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>Share your location?</h2></div>
    <div class="modal-body">
      <p style="line-height:1.55">Let WhoIsThat center the map on you so you can start pinning right away. Your location stays on your device unless you choose to pin and share it.</p>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="loc-no">Not now</button>
      <button class="btn btn-primary" id="loc-yes">Use my location</button>
    </div>
  </div>`);
  node.querySelector('#loc-yes').onclick = () => { closeModal(); onChoice(true); };
  node.querySelector('#loc-no').onclick = () => { closeModal(); onChoice(false); };
  openModal(node);
}

// --------------------------------------------------------------------------
// tiny utils
// --------------------------------------------------------------------------
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
function firstName(n) { return ((n || '').trim().split(/\s+/)[0] || '').toLowerCase(); }
function lastTs(c) { return c.messages.length ? c.messages[c.messages.length - 1].ts : 0; }
