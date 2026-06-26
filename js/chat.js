// ============================================================================
// chat.js  —  Real direct messages with other Nostr users.
// ============================================================================
// Other Nostr apps send DMs in two ways:
//   • Legacy "NIP-04" (kind 4) — older, still common.
//   • Modern "NIP-17" gift-wrapped (kind 1059) — what most current apps
//     (Damus, Amethyst, 0xchat, Coracle…) now use by default.
// To make sure messages from any app show up here, we READ both formats. We
// SEND the modern gift-wrapped format, which is what those apps expect today.
//
// One clever reuse: when you "share your info" with someone, we send it as one
// of these DMs whose text is a small tagged packet. Their app spots the tag and
// files the card away instead of showing it as a chat line.
// ----------------------------------------------------------------------------

import { KIND, SHARE_MARKER } from './config.js';
import { getState, setState } from './state.js';
import {
  subscribe, fetchMany, decryptFrom, hexToNpub, publish,
  buildDM17, unwrapDM17, GIFT_WRAP_KIND,
} from './nostr.js';
import { applyIncomingShare } from './cards.js';
import { notify } from './notifications.js';

const TWO_DAYS = 2 * 24 * 60 * 60;

let sub = null;
let seen = new Set();          // ids we've already processed (events + rumors)
let onShareImported = null;    // optional callback so the UI can toast

export function setShareImportedHandler(fn) { onShareImported = fn; }

// Load past conversations, then start listening for new messages.
export async function startChat() {
  const { pubkey } = getState();
  seen = new Set();

  // History: legacy DMs both directions + modern gift wraps addressed to us
  // (those include copies of messages we sent, too).
  const events = await fetchMany([
    { kinds: [KIND.DIRECT_MESSAGE], '#p': [pubkey] },
    { kinds: [KIND.DIRECT_MESSAGE], authors: [pubkey] },
    { kinds: [GIFT_WRAP_KIND], '#p': [pubkey] },
  ]);
  events.sort((a, b) => a.created_at - b.created_at);
  for (const ev of events) await handleEvent(ev, /*isHistory*/ true);

  // Live updates. NOTE: gift wraps use a randomised timestamp up to ~2 days in
  // the past, so we must use a wide "since" window or we'd miss fresh ones.
  sub = subscribe([
    { kinds: [KIND.DIRECT_MESSAGE], '#p': [pubkey], since: nowSeconds() - 5 },
    { kinds: [KIND.DIRECT_MESSAGE], authors: [pubkey], since: nowSeconds() - 5 },
    { kinds: [GIFT_WRAP_KIND], '#p': [pubkey], since: nowSeconds() - TWO_DAYS - 60 },
  ], (ev) => handleEvent(ev, false));
}

export function stopChat() {
  if (sub) { try { sub.close(); } catch {} sub = null; }
}

async function handleEvent(ev, isHistory) {
  if (seen.has(ev.id)) return;
  seen.add(ev.id);
  if (ev.kind === GIFT_WRAP_KIND) return handleGiftWrap(ev, isHistory);
  return handleLegacy(ev, isHistory);
}

// --- Legacy NIP-04 (kind 4) ----------------------------------------------
async function handleLegacy(ev, isHistory) {
  const me = getState().pubkey;
  const mine = ev.pubkey === me;
  const peer = mine ? tagP(ev.tags) : ev.pubkey;
  if (!peer) return;
  let text;
  try { text = await decryptFrom(peer, ev.content); }
  catch { return; } // not for us / undecryptable — ignore quietly
  ingest(peer, mine, text, ev.created_at, ev.id, isHistory);
}

// --- Modern NIP-17 (kind 1059 gift wrap) ---------------------------------
function handleGiftWrap(wrap, isHistory) {
  const rumor = unwrapDM17(wrap);
  if (!rumor || rumor.kind !== 14) return;
  const me = getState().pubkey;
  const mine = rumor.pubkey === me;
  const peer = mine ? tagP(rumor.tags) : rumor.pubkey;
  if (!peer) return;
  // The peer-wrap and the self-wrap share one rumor id — de-duplicate on it.
  const rid = 'r:' + rumor.id;
  if (seen.has(rid)) return;
  seen.add(rid);
  ingest(peer, mine, rumor.content, rumor.created_at, rumor.id, isHistory);
}

// --- Shared between both formats -----------------------------------------
function ingest(peer, mine, text, ts, id, isHistory) {
  const share = tryParseShare(text);
  if (share) {
    if (!mine) {
      const fromNpub = hexToNpub(peer);
      const res = applyIncomingShare(share.card, fromNpub);
      if (!res.skipped) {
        if (onShareImported) onShareImported(res, fromNpub, isHistory);
        if (!isHistory) {
          const who = share.card.name || 'Someone';
          notify('WhoIsThat',
            res.pending ? `${who} shared an update — a merge is ready in People`
            : res.updated ? `${who} updated their shared card`
            : `${who} shared their details with you`);
        }
      }
    }
    return; // never show share packets as chat text
  }
  addMessage(peer, { id, text, mine, ts }, isHistory);
}

function addMessage(peer, msg, isHistory) {
  const convs = { ...getState().conversations };
  const c = convs[peer] || { messages: [], unread: 0 };
  if (c.messages.some((m) => m.id === msg.id)) return;
  c.messages = [...c.messages, msg].sort((a, b) => a.ts - b.ts);

  const isActiveChat = getState().activeChatPeer === peer && getState().openPanel === 'chat-thread';
  if (!msg.mine && !isHistory && !isActiveChat) {
    c.unread += 1;
    notify('New message', preview(msg.text), () => {});
  }
  convs[peer] = c;
  setState({ conversations: convs });
}

// Send a chat message to a peer (hex pubkey), modern gift-wrapped format.
export async function sendMessage(peerHex, text) {
  const clean = (text || '').trim();
  if (!clean) return;
  const rumorId = await sendWrapped(peerHex, clean);
  // Show our own message immediately. (The self-wrap echo is de-duped via the
  // rumor id we marked as seen, and addMessage also guards against duplicates.)
  addMessage(peerHex, { id: rumorId, text: clean, mine: true, ts: nowSeconds() }, false);
}

// Internal: build + publish the two gift wraps; show our copy immediately.
async function sendWrapped(peerHex, content) {
  const { rumorId, wraps } = buildDM17(peerHex, content);
  const results = await Promise.allSettled(wraps.map((w) => publish(w)));
  if (!results.some((r) => r.status === 'fulfilled')) {
    throw new Error('No relay accepted the message. Check your relays in Settings.');
  }
  // Mark the rumor seen so the self-wrap echo doesn't double-add it.
  seen.add('r:' + rumorId);
  return rumorId;
}

// Send a shared-card packet (used by cards.js). Returns once published.
export async function sendShareCard(peerHex, packet) {
  const rumorId = await sendWrapped(peerHex, packet);
  return rumorId;
}

export function openConversation(peerHex) {
  const convs = { ...getState().conversations };
  if (!convs[peerHex]) convs[peerHex] = { messages: [], unread: 0 };
  convs[peerHex].unread = 0;
  setState({ conversations: convs, activeChatPeer: peerHex });
}

export function markRead(peerHex) {
  const convs = { ...getState().conversations };
  if (convs[peerHex]) { convs[peerHex].unread = 0; setState({ conversations: convs }); }
}

export function totalUnread() {
  return Object.values(getState().conversations).reduce((n, c) => n + (c.unread || 0), 0);
}

// --- helpers --------------------------------------------------------------
function tagP(tags) { const t = (tags || []).find((x) => x[0] === 'p'); return t ? t[1] : null; }
function tryParseShare(text) {
  if (!text || text[0] !== '{') return null;
  try {
    const obj = JSON.parse(text);
    if (obj && obj.marker === SHARE_MARKER && obj.card) return obj;
  } catch {}
  return null;
}
function preview(t) { return t.length > 80 ? t.slice(0, 80) + '…' : t; }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
