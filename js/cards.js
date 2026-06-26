// ============================================================================
// cards.js  —  The "cards" you keep about people (and yourself).
// ============================================================================
// A card is just a plain object with the fields from the brief: name, picture,
// birthday, pets, children, relatives, where you know them from, notes, and a
// pinned location. This file creates, edits, deletes, and shares cards. Saving
// to the network is handled by storage.js — here we only change the data and
// then ask it to save.
// ----------------------------------------------------------------------------

import { getState, updateDataset, setState } from './state.js';
import { saveNow } from './storage.js';
import { SHARE_MARKER } from './config.js';
import { buildDM17, publish, npubToHex } from './nostr.js';

// Persist the notebook to the relays right away (encrypted). We save
// immediately on every card change so nothing can be lost to a page refresh.
function persist() {
  saveNow().catch((e) => {
    console.error('Save failed:', e);
    try { window.dispatchEvent(new CustomEvent('wwt:save-error')); } catch {}
  });
}

// The shape of a blank card. Add a field here and it'll flow through the editor.
export function emptyCard() {
  return {
    id: cryptoId(),
    name: '',
    npub: '',             // their Nostr public key, if you know it (enables chat/share)
    picture: '',          // small base64 thumbnail or an image URL
    birthday: '',
    pets: '',
    relatives: [],        // [{ type, name, npub, lat, lng, address }] — includes children
    knownFrom: '',
    notes: '',
    location: null,       // { lat, lng } or null
    address: '',          // human-readable address, if one was used to place the pin
    createdAt: Math.floor(Date.now() / 1000),
    sharedBy: null,       // npub of whoever shared this card with you, if any
  };
}

export function emptyRelative() {
  return { type: 'Parent', name: '', npub: '', lat: null, lng: null, address: '' };
}

export const RELATIVE_TYPES = [
  'Parent', 'Child', 'Sibling', 'Partner', 'Spouse',
  'Grandparent', 'Grandchild', 'Cousin', 'Friend', 'Colleague', 'Other',
];

// --- Other people's cards -------------------------------------------------

export function addPerson(card) {
  updateDataset((d) => { d.people.push(card); });
  persist();
}

export function updatePerson(id, card) {
  updateDataset((d) => {
    const i = d.people.findIndex((p) => p.id === id);
    if (i !== -1) d.people[i] = { ...card, id };
  });
  persist();
}

export function deletePerson(id) {
  updateDataset((d) => { d.people = d.people.filter((p) => p.id !== id); });
  persist();
}

export function getPerson(id) {
  return getState().dataset.people.find((p) => p.id === id) || null;
}

// --- Your own card --------------------------------------------------------

export function saveSelf(card) {
  updateDataset((d) => { d.self = card; });
  persist();
  // If you've already shared your card with anyone, push the update to them so
  // their copy on their map refreshes automatically.
  reshareSelf().catch((e) => console.warn('Could not push card update:', e));
}

// --- Sharing your card with another npub ----------------------------------
// We package the card and send it as an encrypted DM. The recipient's app sees
// the marker and files it under their "people" automatically. We also remember
// each npub we've shared with, so later edits can be pushed to them.

async function sendSelfTo(npub) {
  const self = getState().dataset.self;
  if (!self) throw new Error('Add your own information first, then share it.');
  const peerHex = npubToHex(npub);
  const payloadCard = {
    ...self,
    id: cryptoId(),                 // fresh id each send; the recipient matches by npub
    sharedBy: getState().npub,
    createdAt: Math.floor(Date.now() / 1000),
  };
  const body = JSON.stringify({ marker: SHARE_MARKER, card: payloadCard });
  const { wraps } = buildDM17(peerHex, body);
  const results = await Promise.allSettled(wraps.map((w) => publish(w)));
  if (!results.some((r) => r.status === 'fulfilled')) {
    throw new Error('No relay accepted the share. Check your relays in Settings.');
  }
}

export async function shareSelfWith(npub) {
  await sendSelfTo(npub);
  // Remember this recipient for future auto-updates.
  updateDataset((d) => {
    if (!Array.isArray(d.sharedWith)) d.sharedWith = [];
    if (!d.sharedWith.includes(npub)) d.sharedWith.push(npub);
  });
  persist();
}

// Re-send your (edited) card to everyone you've shared it with.
async function reshareSelf() {
  const list = getState().dataset.sharedWith || [];
  if (!list.length || !getState().dataset.self) return;
  await Promise.allSettled(list.map((npub) => sendSelfTo(npub)));
}

// Called by chat.js when an incoming DM turns out to be a shared card.
// Outcomes:
//   • Already handled before → ignore (so reloads don't re-prompt or duplicate).
//   • Matches a card THEY previously shared with you → auto-apply their update.
//   • Matches someone YOU pinned with the same npub → stage a "merge" to review.
//   • Otherwise → add as a new person.
export function applyIncomingShare(card, fromNpub) {
  const incoming = { ...card, npub: card.npub || fromNpub, sharedBy: fromNpub };
  const ds = getState().dataset;
  if ((ds.handledShares || []).includes(incoming.id)) return { skipped: true };

  const match = ds.people.find((p) => p.npub && p.npub === fromNpub);

  // No existing card for this npub → add theirs as a brand-new person.
  if (!match) {
    if (ds.people.some((p) => p.id === incoming.id)) return { skipped: true };
    addPerson(incoming);   // keeps the packet's id so reloads don't duplicate it
    return { added: true, card: incoming };
  }

  // We already have a card for this person. Only their NEWEST share should drive
  // changes; ignore out-of-order replays of older shares.
  const incomingAt = incoming.createdAt || 0;
  if (match.lastShareAt && incomingAt < match.lastShareAt) return { skipped: true };

  const updated = { ...match, sharedBy: fromNpub, lastShareAt: incomingAt || Math.floor(Date.now() / 1000) };

  // Location & address ALWAYS come from them (and keep auto-updating from here on),
  // whether or not you already had a location saved.
  updated.location = incoming.location || null;
  updated.address = incoming.address || '';

  // name / pets / photo: take theirs automatically if you have nothing there;
  // if you both have data and it differs, that's a conflict for you to resolve.
  const conflicts = {};
  for (const f of ['name', 'pets', 'picture']) {
    if (!match[f]) {
      updated[f] = incoming[f] || match[f] || '';
    } else if (incoming[f] && incoming[f] !== match[f]) {
      conflicts[f] = incoming[f];
    }
  }
  // Everything else (npub, birthday, where-you-know-them, notes, relatives) stays
  // exactly as you have it — their share never overwrites your own notes.

  updatePerson(match.id, updated);

  if (Object.keys(conflicts).length) {
    setState({ pendingMerges: { ...getState().pendingMerges, [match.id]: { incoming, fromNpub, conflicts } } });
    return { pending: true, personId: match.id, card: updated };
  }
  markShareHandled(incoming.id);
  return { updated: true, personId: match.id, card: updated };
}

// Stop auto-sharing your card with someone. Their existing copy is NOT removed —
// they simply stop receiving future updates.
export function unshareSelfFrom(npub) {
  updateDataset((d) => {
    if (Array.isArray(d.sharedWith)) d.sharedWith = d.sharedWith.filter((n) => n !== npub);
  });
  persist();
}

// Remember that a shared card was dealt with (merged or added) so it won't
// prompt again after a page reload.
export function markShareHandled(shareId) {
  if (!shareId) return;
  updateDataset((d) => {
    if (!d.handledShares) d.handledShares = [];
    if (!d.handledShares.includes(shareId)) d.handledShares.push(shareId);
  });
  persist();
}

export function getPendingMerge(personId) {
  return getState().pendingMerges[personId] || null;
}

export function clearPendingMerge(personId) {
  const pm = { ...getState().pendingMerges };
  delete pm[personId];
  setState({ pendingMerges: pm });
}

// Save the user's chosen merged card and close out the pending merge.
export function applyMerge(personId, mergedCard, shareId) {
  updatePerson(personId, mergedCard);
  markShareHandled(shareId);
  clearPendingMerge(personId);
}

// --- helpers --------------------------------------------------------------

function cryptoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
