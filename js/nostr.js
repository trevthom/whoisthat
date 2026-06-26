// ============================================================================
// nostr.js  —  Everything that talks to the Nostr network.
// ============================================================================
// This is the only file that knows how keys, encryption, and relays actually
// work. The rest of the app calls these friendly functions and doesn't worry
// about the details. If you ever need to change "how we talk to the network",
// it should only mean changing this file.
// ----------------------------------------------------------------------------

import { NOSTR_TOOLS_URL, KIND, RELAY_HEALTHCHECK_MS } from './config.js';
import { getState, setState } from './state.js';

// Load the Nostr library from the internet (pinned version, see config.js).
const nostr = await import(NOSTR_TOOLS_URL);
const {
  generateSecretKey, getPublicKey, finalizeEvent, verifyEvent,
  SimplePool, nip04, nip44, nip19, nip59,
} = nostr;

let pool = new SimplePool();
let healthTimer = null;

// --- Identity -------------------------------------------------------------

// Make a brand-new identity. Returns the nsec so we can show it to the user
// once (they must save it — it's the only way back into their account).
export function createIdentity() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  setIdentity(sk, pk);
  return { nsec: nip19.nsecEncode(sk), npub: nip19.npubEncode(pk) };
}

// Log in with an existing key. Accepts an nsec... string or a 64-char hex key.
export function loginWithKey(input) {
  const trimmed = (input || '').trim();
  let sk;
  if (trimmed.startsWith('nsec')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') throw new Error('That is not a valid nsec key.');
    sk = decoded.data;
  } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    sk = hexToBytes(trimmed.toLowerCase());
  } else {
    throw new Error('Enter a key that starts with "nsec" (or a 64-character hex key).');
  }
  const pk = getPublicKey(sk);
  setIdentity(sk, pk);
  return { npub: nip19.npubEncode(pk) };
}

function setIdentity(sk, pk) {
  setState({ secretKey: sk, pubkey: pk, npub: nip19.npubEncode(pk), loggedIn: true });
}

// The user's keys as shareable strings (used by Settings + saved-login).
export function getNsec() {
  const { secretKey } = getState();
  return secretKey ? nip19.nsecEncode(secretKey) : '';
}

// --- Conversions people will need ----------------------------------------

export function npubToHex(npub) {
  const d = nip19.decode(npub.trim());
  if (d.type !== 'npub') throw new Error('That is not a valid npub.');
  return d.data;
}
export function hexToNpub(hex) { return nip19.npubEncode(hex); }
export function isValidNpub(s) {
  try { return nip19.decode(s.trim()).type === 'npub'; } catch { return false; }
}

// --- Encryption -----------------------------------------------------------
// Your private notebook is encrypted to yourself with NIP-44 (modern, strong).
// Chat + shared cards use NIP-04, which every relay understands.

export function encryptForSelf(plaintext) {
  const { secretKey, pubkey } = getState();
  const key = nip44.getConversationKey(secretKey, pubkey);
  return nip44.encrypt(plaintext, key);
}
export function decryptFromSelf(ciphertext) {
  const { secretKey, pubkey } = getState();
  const key = nip44.getConversationKey(secretKey, pubkey);
  return nip44.decrypt(ciphertext, key);
}
export async function decryptFrom(peerHex, ciphertext) {
  const { secretKey } = getState();
  return nip04.decrypt(secretKey, peerHex, ciphertext);
}

// --- NIP-17 (modern, gift-wrapped) direct messages ------------------------
// Most current Nostr apps (Damus, Amethyst, 0xchat, …) send DMs this way:
// the real message (a "rumor", kind 14) is sealed and then gift-wrapped in a
// kind 1059 event addressed to the recipient. We build a wrap for the peer AND
// one for ourselves, so the message also syncs to our own other devices.
const DM_RUMOR_KIND = 14;
export const GIFT_WRAP_KIND = 1059;

export function buildDM17(peerHex, content, extraTags = []) {
  const { secretKey, pubkey } = getState();
  // One shared rumor → identical id in both wraps, so we can de-duplicate.
  const rumor = nip59.createRumor(
    { kind: DM_RUMOR_KIND, content, tags: [['p', peerHex], ...extraTags] },
    secretKey,
  );
  const wrapToPeer = nip59.createWrap(nip59.createSeal(rumor, secretKey, peerHex), peerHex);
  const wrapToSelf = nip59.createWrap(nip59.createSeal(rumor, secretKey, pubkey), pubkey);
  return { rumorId: rumor.id, wraps: [wrapToPeer, wrapToSelf] };
}

// Open a gift wrap (kind 1059) addressed to us. Returns the inner rumor
// { id, pubkey, content, created_at, tags } or null if it isn't ours.
export function unwrapDM17(wrap) {
  try {
    const { secretKey } = getState();
    return nip59.unwrapEvent(wrap, secretKey) || null;
  } catch {
    return null;
  }
}

// --- Publishing & reading -------------------------------------------------

export function signEvent(template) {
  const { secretKey } = getState();
  return finalizeEvent(template, secretKey);
}

// Send a signed event to all of the user's relays. Resolves once at least one
// relay accepts it (or rejects after all fail).
export async function publish(event) {
  const relays = getState().dataset.settings.relays;
  const results = pool.publish(relays, event);
  return Promise.any(results).catch(() => {
    throw new Error('No relay accepted the message. Check your relays in Settings.');
  });
}

// Fetch the newest event matching a filter (used to load your notebook).
export async function fetchLatest(filter) {
  const relays = getState().dataset.settings.relays;
  return pool.get(relays, filter);
}

// Fetch many events at once (used to load chat history). Accepts either a
// single filter or an array of filters. IMPORTANT: the underlying querySync
// takes ONE filter, so when given several we query each and merge the results
// (de-duplicated by event id). This is what makes old messages load on login.
export async function fetchMany(filterOrFilters) {
  const relays = getState().dataset.settings.relays;
  const filters = Array.isArray(filterOrFilters) ? filterOrFilters : [filterOrFilters];
  const batches = await Promise.all(
    filters.map((f) => pool.querySync(relays, f).catch(() => []))
  );
  const byId = new Map();
  for (const batch of batches) for (const ev of batch) byId.set(ev.id, ev);
  return [...byId.values()];
}

// Watch for new events in real time. Returns a handle with .close().
export function subscribe(filters, onEvent) {
  const relays = getState().dataset.settings.relays;
  return pool.subscribeMany(relays, filters, {
    onevent: onEvent,
    oneose: () => {},
  });
}

export { verifyEvent };

// --- Relay health ---------------------------------------------------------
// We show a coloured dot next to each relay. To know if a relay is reachable
// we ask the pool to connect; success = online, failure = offline.

export async function checkRelay(url) {
  const status = { ...getState().relayStatus, [url]: 'connecting' };
  setState({ relayStatus: status });
  try {
    await pool.ensureRelay(url, { connectionTimeout: 6000 });
    setRelayStatus(url, 'online');
    return 'online';
  } catch {
    setRelayStatus(url, 'offline');
    return 'offline';
  }
}

function setRelayStatus(url, value) {
  setState({ relayStatus: { ...getState().relayStatus, [url]: value } });
}

export async function checkAllRelays() {
  const relays = getState().dataset.settings.relays;
  await Promise.all(relays.map((r) => checkRelay(r)));
}

export function startRelayHealthchecks() {
  stopRelayHealthchecks();
  healthTimer = setInterval(() => { checkAllRelays(); }, RELAY_HEALTHCHECK_MS);
}
export function stopRelayHealthchecks() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
}

// Rebuild the pool (e.g. after the relay list changes) so old sockets close.
export function refreshPool() {
  try { pool.close(getState().dataset.settings.relays); } catch {}
  pool = new SimplePool();
}

// --- small helper ---------------------------------------------------------
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}
