// ============================================================================
// storage.js  —  Saving and loading your private notebook.
// ============================================================================
// Your whole notebook (your card, everyone's cards, your settings) is bundled
// into one object, encrypted to yourself, and stored on the relays as a single
// "replaceable" event. Replaceable means each save overwrites the last, so the
// relays only ever keep your newest copy. Logging in on another machine simply
// fetches that copy and decrypts it.
// ----------------------------------------------------------------------------

import { KIND, DATASET_TAG } from './config.js';
import { getState, setState } from './state.js';
import {
  encryptForSelf, decryptFromSelf, signEvent, publish, fetchLatest, fetchMany, refreshPool,
} from './nostr.js';

// Load the notebook for the logged-in user. If none exists yet (new account),
// the current empty dataset is kept. Returns true if existing data was loaded.
// Load the newest saved notebook for the logged-in user. Returns the decrypted
// dataset object, or null if none exists. It does NOT commit to state — the
// caller decides whether to apply it (so a superseded login can be discarded).
export async function loadDataset() {
  const { pubkey } = getState();
  const filter = { kinds: [KIND.APP_DATA], authors: [pubkey], '#d': [DATASET_TAG] };
  let events = [];
  try { events = await fetchMany(filter); } catch { events = []; }
  if (!events.length) {
    const one = await fetchLatest(filter);   // fallback
    if (one) events = [one];
  }
  if (!events.length) return null;
  const event = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  if (!event || !event.content) return null;
  lastWriteAt = Math.max(lastWriteAt, event.created_at);   // never write older than what exists

  try {
    const json = decryptFromSelf(event.content);
    const data = JSON.parse(json);
    return mergeDataset(data);
  } catch (e) {
    console.error('Could not read existing notebook:', e);
    throw new Error('Found saved data but could not decrypt it. Is this the right key?');
  }
}

// Save the current notebook. Debounced so a flurry of edits = one network write.
let saveTimer = null;
let pending = false;
export function saveDataset() {
  pending = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!pending) return;
    pending = false;
    try {
      await writeNow();
    } catch (e) {
      console.error('Save failed:', e);
    }
  }, 700);
}

// Force an immediate save (used before logout, or when we must be sure).
export async function saveNow() {
  pending = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  return writeNow();
}

// Tracks the timestamp of our last saved copy so each new save is strictly
// newer. Relays keep only the newest replaceable event; if two saves landed in
// the same second the relay could keep the older one and a card would seem to
// "disappear". Forcing the timestamp upward prevents that.
let lastWriteAt = 0;

async function writeNow() {
  const { dataset } = getState();
  const ciphertext = encryptForSelf(JSON.stringify(dataset));
  const created_at = Math.max(Math.floor(Date.now() / 1000), lastWriteAt + 1);
  lastWriteAt = created_at;
  const event = signEvent({
    kind: KIND.APP_DATA,
    created_at,
    tags: [['d', DATASET_TAG]],
    content: ciphertext,
  });
  try {
    await publish(event);
  } catch (e) {
    // One quick retry — relays are sometimes briefly unreachable.
    await new Promise((r) => setTimeout(r, 600));
    await publish(event);
  }
  return event;
}

// Overwrite the notebook with an empty one (used by "Delete account").
export async function wipeDataset() {
  const { emptyDatasetRef } = {};
  // Build a fresh empty dataset directly to avoid import cycles.
  const empty = {
    version: 1,
    settings: { theme: getState().dataset.settings.theme, relays: getState().dataset.settings.relays, shareLocationOnLogin: false },
    self: null,
    people: [],
  };
  setState({ dataset: empty });
  await saveNow();
}

function mergeDataset(data) {
  const base = {
    version: 1,
    settings: { theme: 'dark', relays: [], shareLocationOnLogin: null },
    self: null,
    people: [],
    handledShares: [],
    sharedWith: [],
  };
  const out = { ...base, ...data };
  out.settings = { ...base.settings, ...(data.settings || {}) };
  if (!Array.isArray(out.people)) out.people = [];
  if (!Array.isArray(out.handledShares)) out.handledShares = [];
  if (!Array.isArray(out.sharedWith)) out.sharedWith = [];

  // Photos were removed from the app. Drop any that linger in older saved data so
  // the encrypted blob shrinks and can't grow past a relay's size limit. They
  // disappear from the stored copy on the next save.
  if (out.self && out.self.picture) delete out.self.picture;
  for (const p of out.people) { if (p && p.picture) delete p.picture; }
  // If the saved relay list is empty for any reason, fall back to current.
  if (!out.settings.relays || out.settings.relays.length === 0) {
    out.settings.relays = getState().dataset.settings.relays;
  }
  return out;
}

export { refreshPool };
