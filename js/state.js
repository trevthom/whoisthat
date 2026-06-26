// ============================================================================
// state.js  —  The app's single source of truth, kept in memory only.
// ============================================================================
// IMPORTANT: nothing here is written to the browser's local storage. When the
// page reloads, this is wiped and the user logs in again. That's deliberate —
// the only place data is ever saved is on the Nostr relays, encrypted.
//
// Everything the screen shows is read from this object. When something changes,
// call `setState(...)` and any part of the UI that registered with `subscribe`
// gets told to re-draw. This keeps the data and the screen in sync without a
// big framework.
// ----------------------------------------------------------------------------

import { DEFAULT_RELAYS } from './config.js';

// A brand-new, empty notebook. This is also the shape of the data that gets
// encrypted and saved to relays, so if you add a new field to a card, add its
// default here too.
export function emptyDataset() {
  return {
    version: 1,
    settings: {
      theme: 'dark',                 // 'dark' or 'light'
      relays: [...DEFAULT_RELAYS],   // the user's chosen relays
      shareLocationOnLogin: null,    // null = not asked yet, true/false once answered
    },
    self: null,                      // the user's own card (see cards.js -> emptyCard)
    people: [],                      // cards about other people
    handledShares: [],               // ids of shared cards already merged/added (avoids re-prompting)
    sharedWith: [],                  // npubs you've shared YOUR card with (auto-updated when you edit it)
  };
}

// The live state. Treat everything here as read-only from outside; change it
// only through setState() so the screen stays in sync.
const state = {
  // session / identity (memory only)
  secretKey: null,     // Uint8Array — the private key. Never saved to disk.
  pubkey: null,        // hex public key
  npub: null,          // npub... form of the public key
  loggedIn: false,

  // network
  relayStatus: {},     // { 'wss://...': 'online' | 'offline' | 'connecting' }

  // data
  dataset: emptyDataset(),

  // chat
  conversations: {},   // { peerPubkeyHex: { messages: [...], unread: 0 } }
  activeChatPeer: null,

  // merges: a friend shared a card that matches someone you already pinned.
  pendingMerges: {},   // { existingPersonId: { incoming: card, fromNpub } }

  // ui
  screen: 'login',     // 'login' | 'app'
  openPanel: null,     // null | 'chat' | 'settings' | 'card' | 'editor' | 'share'
  selectedPersonId: null,
};

const listeners = new Set();

export function getState() {
  return state;
}

// Shallow-merge a patch into state, then notify the UI.
export function setState(patch) {
  Object.assign(state, patch);
  emit();
}

// Convenience for changing something deep inside the dataset and notifying.
export function updateDataset(mutator) {
  mutator(state.dataset);
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let scheduled = false;
function emit() {
  // Batch rapid changes into a single redraw on the next frame.
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.error('UI listener error:', e); }
    });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

// Wipe everything (used on logout / delete account).
export function resetState() {
  state.secretKey = null;
  state.pubkey = null;
  state.npub = null;
  state.loggedIn = false;
  state.relayStatus = {};
  state.dataset = emptyDataset();
  state.conversations = {};
  state.activeChatPeer = null;
  state.pendingMerges = {};
  state.screen = 'login';
  state.openPanel = null;
  state.selectedPersonId = null;
  emit();
}
