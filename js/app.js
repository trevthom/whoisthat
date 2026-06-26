// ============================================================================
// app.js  —  The conductor. Wires everything together.
// ============================================================================
// This is the only file that decides WHAT HAPPENS when you click things. It
// listens to the login screen's buttons, defines every "action" the rest of the
// app can ask for (the `A` object handed to ui.js), and runs the start-up
// sequence after you log in. If you want to change a behaviour ("when I save a
// card, also do X"), this is usually the file to edit.
//
// The split to remember:
//   • ui.js   = how things LOOK (builds the screens, asks app.js to act)
//   • app.js  = what things DO  (this file)
//   • the other js/ files = the building blocks (network, map, chat, storage…)
// ----------------------------------------------------------------------------

import { getState, setState, updateDataset, subscribe, resetState } from './state.js';
import * as ui from './ui.js';
import * as map from './map.js';
import {
  createIdentity, loginWithKey, npubToHex, getNsec,
  checkRelay, checkAllRelays, startRelayHealthchecks, stopRelayHealthchecks, refreshPool,
} from './nostr.js';
import { loadDataset, saveDataset, saveNow, wipeDataset } from './storage.js';
import {
  addPerson, updatePerson, deletePerson as cardsDeletePerson, saveSelf, shareSelfWith,
  applyMerge, unshareSelfFrom,
} from './cards.js';
import {
  startChat, stopChat, sendMessage, openConversation, totalUnread, setShareImportedHandler,
} from './chat.js';
import { initNotifications, askNotificationPermission } from './notifications.js';

// --- app-wide flags -------------------------------------------------------
let entered = false;            // true once we've fully entered the app (post-login)
let mapReady = false;           // the Leaflet map is created only once per page load
let loginRelayEditing = false;  // is the login screen's relay list in "edit" mode?
let generatedNsec = '';         // remembers a freshly generated key for the Copy button

// --- staying logged in across refreshes -----------------------------------
// We keep the key in the browser so a page refresh just reloads the app instead
// of logging you out. (Your notebook data itself always lives, encrypted, on the
// relays — this only remembers the key on THIS device. "Log out" clears it.)
const SESSION_KEY = 'wwt:nsec';
function saveSession() {
  try { localStorage.setItem(SESSION_KEY, getNsec()); } catch {}
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
function readSession() {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

// --------------------------------------------------------------------------
// The actions object. ui.js calls these; it never changes data directly.
// --------------------------------------------------------------------------
const A = {
  // -- people / cards --
  openCardView(idOrSelf) { setState({ openPanel: 'card' }); ui.openCardView(idOrSelf); },
  openEditor(idOrSelf) { setState({ openPanel: 'editor' }); ui.openEditor(idOrSelf); },
  openEditorNew() { setState({ openPanel: 'editor' }); ui.openNewPersonPinFirst(); },

  saveCard(card, isSelf, id) {
    if (isSelf) saveSelf(card);
    else if (id && id !== 'new') updatePerson(id, card);
    else addPerson(card);
    refreshPins();
  },

  deletePerson(id) { cardsDeletePerson(id); refreshPins(); },

  // merge: review a friend's shared card against the one you already have
  openMerge(personId) { setState({ openPanel: 'merge' }); ui.openMergeModal(personId); },
  commitMerge(personId, mergedCard, shareId) {
    applyMerge(personId, mergedCard, shareId);
    refreshPins();
    ui.toast('Cards merged');
    setState({ openPanel: 'people' });
    ui.openPeoplePanel();   // rebuild the list so the merge marker is gone
  },

  async shareWith(npub) {
    try {
      await shareSelfWith(npub);
      ui.toast('Shared — it will appear on their map');
    } catch (e) {
      ui.toast(e.message || 'Could not share', true);
    }
  },
  unshareWith(npub) {
    unshareSelfFrom(npub);
    ui.toast('Unshared — they keep what they already have');
  },

  // -- chat --
  openChatWith(npub) {
    let hex;
    try { hex = npubToHex(npub); }
    catch { ui.toast('That npub is not valid', true); return; }
    openConversation(hex);                                   // creates/clears unread + sets active peer
    setState({ openPanel: 'chat-thread', activeChatPeer: hex });
    ui.openChatPanel(hex);                                   // opens the list, then the thread
  },

  async sendChat(peerHex, text) {
    try { await sendMessage(peerHex, text); }
    catch (e) { ui.toast(e.message || 'Message failed to send', true); }
  },

  // -- settings --
  setTheme(theme) {
    updateDataset((d) => { d.settings.theme = theme; });
    ui.applyTheme(theme);
    if (entered) saveDataset();
    if (getState().openPanel === 'settings') ui.openSettingsPanel();
  },

  toggleShareLocation(val) {
    updateDataset((d) => { d.settings.shareLocationOnLogin = val; });
    if (entered) saveDataset();
    if (val) locateOrWarn();
    if (getState().openPanel === 'settings') ui.openSettingsPanel();
  },

  addRelay(url, atLogin) { addRelay(url, atLogin); },
  removeRelay(url, atLogin) { removeRelay(url, atLogin); },
  checkRelays() { checkAllRelays(); },

  // -- account --
  logout() { doLogout(true); },
  deleteAccount() { deleteAccount(); },

  // -- housekeeping --
  onPanelClosed() { setState({ openPanel: null }); },
};

// --------------------------------------------------------------------------
// Relay add / remove (shared by the login screen and Settings)
// --------------------------------------------------------------------------
function addRelay(url, atLogin) {
  url = (url || '').trim();
  if (!/^wss:\/\/.+/i.test(url)) { ui.toast('A relay address must start with wss://', true); return; }
  const relays = getState().dataset.settings.relays;
  if (relays.includes(url)) { ui.toast('That relay is already in your list', true); return; }
  updateDataset((d) => { d.settings.relays = [...d.settings.relays, url]; });
  if (entered) saveDataset();
  refreshPool();
  checkRelay(url);
  if (atLogin && loginRelayEditing) renderLoginRelayEditor();
}

function removeRelay(url, atLogin) {
  const relays = getState().dataset.settings.relays;
  if (relays.length <= 1) { ui.toast('Keep at least one relay so the app can connect', true); return; }
  updateDataset((d) => { d.settings.relays = d.settings.relays.filter((r) => r !== url); });
  if (entered) saveDataset();
  refreshPool();
  if (atLogin && loginRelayEditing) renderLoginRelayEditor();
  else if (getState().openPanel === 'settings') ui.refreshSettingsRelays();
}

// --------------------------------------------------------------------------
// Drawing pins (called whenever the people/self data changes)
// --------------------------------------------------------------------------
function refreshPins() {
  map.renderPins(
    getState().dataset,
    (id) => A.openCardView(id),
    (people) => ui.openClusterList(people),
  );
}

// Centre the map on the user, with a clear message if the browser can't get a fix.
function locateOrWarn() {
  if (!window.isSecureContext) {
    ui.toast('Location needs a secure (https://) address — see the README on hosting', true);
    return Promise.resolve();
  }
  return map.locateUser().catch((err) => {
    const code = err && err.code;
    let msg;
    if (code === 1) msg = 'Location permission was blocked — allow it in your browser’s site settings, then toggle it on in Settings';
    else if (code === 3) msg = 'Location timed out — try again, or pin places by hand';
    else msg = "Couldn't get your location just now — you can still pin places by hand";
    ui.toast(msg, true);
  });
}

// --------------------------------------------------------------------------
// Entering the app (used by both "new identity" and "log in")
// --------------------------------------------------------------------------
async function enterApp() {
  hideLoginError();
  setState({ screen: 'app' });
  ui.showScreen('app');

  // Create the map once; on a later login just nudge it to re-measure.
  const startTheme = getState().dataset.settings.theme;
  if (!mapReady) { map.initMap('map', startTheme); mapReady = true; }
  else map.invalidate();
  ui.applyTheme(startTheme);

  // Pull the encrypted notebook down from the relays (if one exists).
  try {
    await loadDataset();
  } catch (e) {
    // Data exists but couldn't be decrypted — almost always the wrong key.
    ui.toast(e.message || 'Could not open your saved data', true);
    await doLogout(false);
    return;
  }

  const ds = getState().dataset;
  ui.applyTheme(ds.settings.theme);   // honour the theme saved in the notebook
  refreshPins();

  // Incoming shared cards. A match against someone you already pinned (same npub)
  // becomes a pending "merge"; a card they shared before auto-updates; otherwise
  // it's added as a new person. Refresh pins always; only toast for live events.
  setShareImportedHandler((res, fromNpub, isHistory) => {
    if (res.added || res.updated) refreshPins();
    if (isHistory) return;
    if (res.added) ui.toast(`${res.card.name || 'Someone'} shared their info`);
    else if (res.updated) ui.toast(`${res.card.name || 'A contact'} updated their card`);
    else if (res.pending) ui.toast('A merge is ready — open People to review');
  });

  // Start listening for chat messages (loads history, then live updates).
  startChat().catch((e) => console.warn('Could not start chat:', e));

  // Register the service worker (lets the browser show message pop-ups).
  initNotifications();

  // Check relay reachability now and on a timer.
  checkAllRelays();
  startRelayHealthchecks();

  entered = true;

  // First-run: ask about using their location. Afterwards, ask about pop-ups.
  const share = ds.settings.shareLocationOnLogin;
  if (share === null) {
    ui.askLocationPrompt(async (yes) => {
      updateDataset((d) => { d.settings.shareLocationOnLogin = yes; });
      saveDataset();
      if (yes) await locateOrWarn();
      askNotificationPermission();
    });
  } else {
    if (share === true) await locateOrWarn();
    askNotificationPermission();
  }
}

// --------------------------------------------------------------------------
// Logging out / deleting the account
// --------------------------------------------------------------------------
async function doLogout(save) {
  try { if (save && entered) await saveNow(); } catch (e) { console.warn('Final save failed:', e); }
  clearSession();                     // forget the key on this device
  stopChat();
  stopRelayHealthchecks();
  entered = false;
  resetState();                       // wipes the in-memory session, back to a blank login
  resetLoginUI();
  ui.showScreen('login');
  ui.applyTheme(getState().dataset.settings.theme);
  ui.renderLoginRelays(getState());
  checkAllRelays();                   // light up the relay dots on the login screen
}

async function deleteAccount() {
  try {
    await wipeDataset();              // overwrite the notebook on the relays with an empty one
  } catch (e) {
    console.warn('Wipe may not have reached every relay:', e);
  }
  await doLogout(false);
  ui.toast('Your data has been wiped from the relays');
}

// --------------------------------------------------------------------------
// Login screen wiring
// --------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function wireLogin() {
  // Tab switching (New identity / I have a key)
  document.querySelectorAll('[data-login-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const which = tab.getAttribute('data-login-tab');
      document.querySelectorAll('[data-login-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.getAttribute('data-pane') !== which));
      hideLoginError();
    });
  });

  // Generate a brand-new key
  $('btn-generate').addEventListener('click', () => {
    try {
      const { nsec } = createIdentity();
      generatedNsec = nsec;
      $('nsec-value').textContent = nsec;
      $('generated-key').classList.remove('hidden');
      $('saved-confirm').checked = false;
      $('btn-enter-new').disabled = true;
    } catch (e) {
      showLoginError('Could not generate a key. Please reload and try again.');
    }
  });

  // Copy the generated key
  $('btn-copy-nsec').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(generatedNsec); ui.toast('Secret key copied'); }
    catch { ui.toast('Copy failed — select and copy it manually', true); }
  });

  // Only enable "Enter" once they've ticked "I saved my key"
  $('saved-confirm').addEventListener('change', (e) => {
    $('btn-enter-new').disabled = !e.target.checked;
  });

  // Enter the app with the freshly generated identity
  $('btn-enter-new').addEventListener('click', () => { saveSession(); enterApp(); });

  // Show/hide the secret key field on the "I have a key" tab
  $('btn-toggle-nsec').addEventListener('click', () => {
    const input = $('nsec-input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('btn-toggle-nsec').textContent = show ? 'Hide' : 'Show';
  });

  // Log in with an existing key
  $('btn-login-existing').addEventListener('click', () => {
    const val = $('nsec-input').value;
    try {
      loginWithKey(val);
      saveSession();
      enterApp();
    } catch (e) {
      showLoginError(e.message || 'That key was not accepted.');
    }
  });
  $('nsec-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-login-existing').click(); });

  // Edit relays from the login screen
  $('btn-edit-relays-login').addEventListener('click', () => {
    loginRelayEditing = !loginRelayEditing;
    $('btn-edit-relays-login').textContent = loginRelayEditing ? 'Done' : 'Edit';
    if (loginRelayEditing) {
      renderLoginRelayEditor();
    } else {
      const addRow = $('login-add-relay-row');
      if (addRow) addRow.remove();
      ui.renderLoginRelays(getState());
    }
  });
}

// Builds an editable relay list (with × remove buttons and an add box) directly
// on the login screen, where modals aren't available yet.
function renderLoginRelayEditor() {
  const ul = $('login-relay-list');
  if (!ul) return;
  const state = getState();
  ul.innerHTML = '';
  state.dataset.settings.relays.forEach((url) => {
    const status = state.relayStatus[url] || 'connecting';
    const li = document.createElement('li');
    li.className = 'relay-row';
    li.innerHTML = `<span class="dot ${status}"></span><span class="url"></span><button class="remove" title="Remove" aria-label="Remove relay">×</button>`;
    li.querySelector('.url').textContent = url;
    li.querySelector('.remove').onclick = () => removeRelay(url, true);
    ul.appendChild(li);
  });

  let addRow = $('login-add-relay-row');
  if (!addRow) {
    addRow = document.createElement('div');
    addRow.id = 'login-add-relay-row';
    addRow.className = 'add-relay-row';
    addRow.innerHTML = `<input class="input mono" id="login-relay-input" placeholder="wss://…" /><button class="btn btn-ghost small" id="login-relay-add">Add</button>`;
    ul.parentNode.appendChild(addRow);
    addRow.querySelector('#login-relay-add').onclick = () => {
      const input = addRow.querySelector('#login-relay-input');
      addRelay(input.value, true);
      input.value = '';
    };
    addRow.querySelector('#login-relay-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addRow.querySelector('#login-relay-add').click();
    });
  }
}

function resetLoginUI() {
  loginRelayEditing = false;
  generatedNsec = '';
  const editBtn = $('btn-edit-relays-login'); if (editBtn) editBtn.textContent = 'Edit';
  const addRow = $('login-add-relay-row'); if (addRow) addRow.remove();
  const gen = $('generated-key'); if (gen) gen.classList.add('hidden');
  const nsecVal = $('nsec-value'); if (nsecVal) nsecVal.textContent = '';
  const saved = $('saved-confirm'); if (saved) saved.checked = false;
  const enter = $('btn-enter-new'); if (enter) enter.disabled = true;
  const nsecIn = $('nsec-input'); if (nsecIn) { nsecIn.value = ''; nsecIn.type = 'password'; }
  const tgl = $('btn-toggle-nsec'); if (tgl) tgl.textContent = 'Show';
  // back to the "New identity" tab
  document.querySelectorAll('[data-login-tab]').forEach((t) => t.classList.toggle('active', t.getAttribute('data-login-tab') === 'new'));
  document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.getAttribute('data-pane') !== 'new'));
  hideLoginError();
}

function showLoginError(msg) {
  const el = $('login-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideLoginError() {
  const el = $('login-error');
  if (el) el.classList.add('hidden');
}

// --------------------------------------------------------------------------
// In-app top-bar / floating buttons
// --------------------------------------------------------------------------
function wireAppChrome() {
  $('btn-theme').addEventListener('click', () => {
    const cur = getState().dataset.settings.theme;
    A.setTheme(cur === 'dark' ? 'light' : 'dark');
  });
  $('btn-people').addEventListener('click', () => { setState({ openPanel: 'people' }); ui.openPeoplePanel(); });
  $('btn-chat').addEventListener('click', () => { setState({ openPanel: 'chat', activeChatPeer: null }); ui.openChatPanel(); });
  $('btn-settings').addEventListener('click', () => { setState({ openPanel: 'settings' }); ui.openSettingsPanel(); });
  $('btn-add-person').addEventListener('click', () => { setState({ openPanel: 'editor' }); ui.openNewPersonPinFirst(); });
  $('btn-my-info').addEventListener('click', () => {
    if (getState().dataset.self) { setState({ openPanel: 'card' }); ui.openCardView('self'); }
    else { setState({ openPanel: 'editor' }); ui.openEditor('self'); }
  });
}

// --------------------------------------------------------------------------
// Keep the screen in sync with the data
// --------------------------------------------------------------------------
function wireStateSubscription() {
  subscribe((state) => {
    if (state.screen === 'login') {
      // While actively editing the relay list we leave the DOM alone so typed
      // text isn't wiped by a background status update.
      if (!loginRelayEditing) ui.renderLoginRelays(state);
      return;
    }
    ui.renderChrome();
    if (state.openPanel === 'settings') ui.refreshSettingsRelays();
    if (state.openPanel === 'chat-thread') ui.refreshOpenThread();
  });
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
function boot() {
  ui.init(A);
  wireLogin();
  wireAppChrome();
  wireStateSubscription();

  // Safety net: if the page is being hidden/closed, flush any unsaved changes.
  const flush = () => { if (entered) { try { saveNow(); } catch {} } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // If a save to the relays fails, let the user know (so a pin can't silently vanish).
  window.addEventListener('wwt:save-error', () => {
    ui.toast('Could not save to your relays — check Settings → relay status', true);
  });

  // Login screen: show theme + relays, and start checking who's online.
  ui.applyTheme(getState().dataset.settings.theme);
  ui.renderLoginRelays(getState());
  checkAllRelays();

  // Stay logged in across refreshes: if we remembered a key, go straight in.
  const savedNsec = readSession();
  if (savedNsec) {
    try {
      loginWithKey(savedNsec);
      enterApp();
    } catch {
      clearSession(); // saved key was somehow invalid — fall back to login screen
    }
  }
}

boot();
