// ============================================================================
// cards.js  —  The "cards" you keep about people (and yourself).
// ============================================================================
// A card is just a plain object with the fields from the brief: name,
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
  'Parent', 'Child', 'Sibling', 'Spouse',
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

// Does relative-entry `rel` point at person `card`? Strong match: same npub, or
// same name at the same spot.
function relRefersTo(rel, card) {
  if (!rel || !card) return false;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  if (card.npub && rel.npub) return card.npub === rel.npub;
  if (rel.lat != null && card.location && rel.name && card.name &&
      rel.name.toLowerCase() === card.name.toLowerCase() &&
      near(card.location.lat, rel.lat) && near(card.location.lng, rel.lng)) return true;
  return false;
}
// Looser match (also same name with no location) — used when unlinking a
// relationship, where the back-reference has no coordinates of its own.
function relRefersToLoose(rel, card) {
  if (relRefersTo(rel, card)) return true;
  return !!(rel && card && rel.name && card.name && rel.name.toLowerCase() === card.name.toLowerCase());
}

// Delete a person's card AND scrub every reference to them: their entry is
// removed from every other card's relatives list, including your own card.
export function deletePerson(id) {
  updateDataset((d) => {
    const gone = d.people.find((p) => p.id === id);
    d.people = d.people.filter((p) => p.id !== id);
    if (!gone) return;
    const scrub = (card) => {
      if (card && Array.isArray(card.relatives)) {
        card.relatives = card.relatives.filter((r) => !relRefersTo(r, gone));
      }
    };
    d.people.forEach(scrub);
    scrub(d.self);
  });
  persist();
}

// Remove just the relationship link (keep the relative's own card/pin). Removes
// the entry from this card and the matching back-reference from the other card.
export function removeRelative(ownerId, index) {
  const ds = getState().dataset;
  const owner = ownerId === 'self' ? ds.self : (ds.people.find((p) => p.id === ownerId) || null);
  if (!owner || !Array.isArray(owner.relatives) || !owner.relatives[index]) return;
  const rel = { ...owner.relatives[index] };
  updateDataset((d) => {
    const o = ownerId === 'self' ? d.self : d.people.find((p) => p.id === ownerId);
    if (o && Array.isArray(o.relatives)) o.relatives.splice(index, 1);
    // Remove the reverse link on the relative's own card, if they have one.
    const yCard = d.people.find((p) =>
      (rel.npub && p.npub && p.npub === rel.npub) ||
      (rel.lat != null && p.location && p.name && rel.name &&
        p.name.toLowerCase() === rel.name.toLowerCase() &&
        Math.abs(p.location.lat - rel.lat) < 1e-6 && Math.abs(p.location.lng - rel.lng) < 1e-6));
    if (yCard && Array.isArray(yCard.relatives) && o) {
      yCard.relatives = yCard.relatives.filter((rr) => !relRefersToLoose(rr, o));
    }
  });
  persist();
}

// When a card gains an npub, copy it onto matching relative entries elsewhere
// (people who listed this person without an npub), so chat buttons light up.
export function propagateNpub(card) {
  if (!card || !card.npub || !card.location) return;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  let changed = false;
  updateDataset((d) => {
    const fix = (owner) => {
      if (!owner || !Array.isArray(owner.relatives)) return;
      for (const r of owner.relatives) {
        if (r.npub) continue;
        if (r.lat != null && r.name && card.name &&
            r.name.toLowerCase() === card.name.toLowerCase() &&
            near(r.lat, card.location.lat) && near(r.lng, card.location.lng)) {
          r.npub = card.npub; changed = true;
        }
      }
    };
    d.people.forEach(fix);
    fix(d.self);
  });
  if (changed) persist();
}

export function getPerson(id) {
  return getState().dataset.people.find((p) => p.id === id) || null;
}

// How a relationship looks from the other person's side. Used so a newly created
// relative card lists the original person back with the matching relationship.
// Symmetric ones (Sibling, Cousin, Spouse) map to themselves; Friend/Colleague/
// Other have no clear inverse, so no back-reference is added for them.
const INVERSE_RELATION = {
  Child: 'Parent',
  Parent: 'Child',
  Sibling: 'Sibling',
  Grandchild: 'Grandparent',
  Grandparent: 'Grandchild',
  Cousin: 'Cousin',
  Spouse: 'Spouse',
};

// When a card lists a relative who has a known location, give that relative their
// own pin/card on the map. De-duplicates by npub (if known) or by name+spot, so
// re-saving doesn't pile up copies. The new card also lists the original person
// back with the matching relationship (child↔parent, sibling, etc.). Pass a
// single card, or omit to sweep everyone (used once at login so existing
// relatives also appear). Returns how many were added.
export function materializeRelatives(card) {
  const sources = card ? [card] : getState().dataset.people.concat(getState().dataset.self ? [getState().dataset.self] : []);
  let added = 0;
  updateDataset((d) => {
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    for (const parent of sources) {
      for (const r of (parent.relatives || [])) {
        if (r.lat == null || r.lng == null) continue;
        if (!(r.name || r.npub)) continue;
        const dup = d.people.some((p) =>
          (r.npub && p.npub && p.npub === r.npub) ||
          (p.name && r.name && p.name.toLowerCase() === r.name.toLowerCase()
            && p.location && near(p.location.lat, r.lat) && near(p.location.lng, r.lng)));
        if (dup) continue;

        // Reciprocal entry: list the original person on the new card with the
        // inverse relationship. No location on it (the original already has its
        // own pin), which also keeps it from being re-materialized.
        const inverse = INVERSE_RELATION[r.type];
        const backRefs = (inverse && (parent.name || parent.npub))
          ? [{ type: inverse, name: parent.name || '', npub: parent.npub || '', lat: null, lng: null, address: '' }]
          : [];

        d.people.push({
          ...emptyCard(),
          name: r.name || 'Relative',
          npub: r.npub || '',
          location: { lat: r.lat, lng: r.lng },
          address: r.address || '',
          knownFrom: parent && parent.name ? `Relative of ${parent.name}` : 'Relative',
          relatives: backRefs,
        });
        added++;
      }
    }
  });
  if (added) persist();
  return added;
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
  delete payloadCard.picture;       // photos are no longer used; keep the packet small
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

  // name / pets: take theirs automatically if you have nothing there; if you
  // both have data and it differs, that's a conflict for you to resolve.
  const conflicts = {};
  for (const f of ['name', 'pets']) {
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
