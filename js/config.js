// ============================================================================
// config.js  —  All the settings you might want to change live here.
// ============================================================================
// This file holds the "knobs" for the whole app. If you ever want to change
// the default relays, the app name, or how data is labelled on the network,
// this is the one place to look. Nothing here talks to the network itself —
// it's just values that the rest of the app reads.
// ----------------------------------------------------------------------------

// The relays the app starts with. Users can add or remove their own later;
// their personal list is saved (encrypted) with the rest of their data.
export const DEFAULT_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://nostr.bitcoiner.social',
  'wss://relay.wellorder.net',
];

// Nostr "event kinds" are just numbers that tell relays what a message is.
export const KIND = {
  DIRECT_MESSAGE: 4,      // NIP-04 encrypted direct message (used for chat + sharing)
  DELETION: 5,            // NIP-09 request to delete your own events
  APP_DATA: 30078,        // NIP-78 app-specific data (your encrypted notebook lives here)
};

// A label that marks YOUR notebook event so we can find it again on any machine.
// (Stored in the event's "d" tag. Bumping the version here would start a fresh
//  notebook, so only change it if you really mean to.)
export const DATASET_TAG = 'whowasthat:v1';

// When you share a card with someone, we send it as a normal encrypted DM whose
// text is a small JSON object starting with this marker. The recipient's app
// recognises the marker and files the card away instead of showing it as chat.
export const SHARE_MARKER = 'wwt/share/v1';

// Pulled in by nostr.js. Pinned to an exact version so the app keeps working
// even if the library changes in the future.
export const NOSTR_TOOLS_URL = 'https://esm.sh/nostr-tools@2.10.4';

// Map starting view if we can't get the user's location (roughly central Europe,
// zoomed out enough to feel like "the whole map" rather than nowhere).
export const MAP_DEFAULT = { lat: 30, lng: 0, zoom: 2 };
export const MAP_LOCATED_ZOOM = 16;

// How often (ms) to re-check whether each relay is still reachable.
export const RELAY_HEALTHCHECK_MS = 25000;

export const APP_NAME = 'WhoIsThat';

// Footer links. Listed left-to-right; the footer is right-aligned, so the LAST
// item ("Donate") appears at the far right. Items with `action` open an in-app
// popup; items with `url: '#'` are placeholders; any other url opens in a new tab.
export const FOOTER_LINKS = [
  { label: 'Other Nostr Apps', url: '#' },
  { label: 'What is Nostr?', action: 'whatIsNostr' },
  { label: 'Issues / Feature Request', action: 'issues' },
  { label: 'About WhoIsThat', url: '#' },
  { label: 'Donate', url: '#' },
];

// Targets for the "Issues / Feature Request" popup.
export const ISSUES_GITHUB_URL = 'https://github.com/trevthom/whoisthat';
// TODO: replace with the npub people should message about bugs / ideas.
export const ISSUES_CONTACT_NPUB = 'npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';


