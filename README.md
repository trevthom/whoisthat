# WhoIsThat

A private, encrypted map of the people you've met — and where you know them from.
Everything you save is encrypted with your own key and stored **only** on the
Nostr relays you choose. Your notebook data is never stored on the device. By
default you paste your key each time you open the app; you can opt in to "Keep me
logged in on this device" at login, which stores your key in the browser so a
refresh keeps you in (clear it any time with "Log out"). Log in on another
computer or phone with the same key and your whole notebook comes back.

Currently deployed at https://whoisthat-ungu.vercel.app/

---

## What it does

- **Your own key, your own account.** Generate a fresh Nostr key, or paste one
  you already have (`nsec…`). That key *is* your account — there's no email,
  password, or server sign-up.
- **A map of people.** Drop a pin on OpenStreetMap for anyone you've met and
  keep a card on them: name, birthday, pets, relatives and children (each
  with their own optional pin), where you know them from, and free-form notes.
- **Your own card.** Pin yourself and fill in the same details, then **share**
  that card with someone by their `npub`. It lands on *their* map automatically,
  pin and all.
- **Real chat.** Send end-to-end-encrypted direct messages to any Nostr user.
  Messages are sent in the modern "gift-wrapped" (NIP-17) format that current
  apps use, and the app reads both that and the older (NIP-04) format, so
  conversations started in other apps show up here too. A red bubble counts
  unread messages, and you'll get a system pop-up for new ones while the app is
  open (see *Limitations* below).
- **Light or dark, your relays, your call.** Switch theme (the map stays
  readable either way), add or remove relays, log out, or delete your account —
  all from Settings.

---

## The files (what each one is for)

You don't need to read any code to run the app, but if you ever want to change
something, here's the map. Everything lives in plain files — there's no build
step and nothing to compile.

```
index.html              The page itself (the skeleton of the screens).
manifest.webmanifest    Lets phones "install" the app to the home screen.
sw.js                   A tiny background helper, used for notifications.
icon.png                The app / notification icon.
css/
  styles.css            All the colours, spacing, and layout.
js/
  config.js             The knobs: default relays, the app name, etc.  ← start here
  state.js              The app's memory while it's open (never written to disk).
  nostr.js              Everything that talks to the Nostr network & encryption.
  storage.js            Saving / loading your encrypted notebook on the relays.
  cards.js              Creating, editing, deleting, and sharing person-cards.
  chat.js               Direct messages (and receiving shared cards).
  map.js                The OpenStreetMap map and its pins.
  notifications.js      System pop-up notifications.
  ui.js                 Everything you SEE (panels, forms, chat, pop-ups).
  app.js                Everything that HAPPENS when you click (the conductor).
```

A good rule of thumb: **how it looks** lives in `css/styles.css` and `js/ui.js`;
**what it does** lives in `js/app.js`; **the settings you'd most likely tweak**
live in `js/config.js`.

---

## Putting it online (so you can actually use it)

The app needs to be served over **HTTPS** (a secure `https://` address). That's
not optional — browsers only allow the map's location feature, notifications,
and the background helper on secure pages. The two easiest free options:

### Option A — Netlify Drop (no account needed to try it)
1. Go to **https://app.netlify.com/drop**.
2. Drag the whole `whowasthat` folder onto the page.
3. It gives you a live `https://…netlify.app` address. Done.

### Option B — GitHub Pages
1. Create a new repository on GitHub and upload all these files to it.
2. In the repo: **Settings → Pages → Build and deployment**, set *Source* to
   your main branch, folder `/ (root)`, and save.
3. After a minute it publishes at `https://yourname.github.io/your-repo/`.

Either way, open the address on your computer or phone, generate or paste a key,
and you're in. Use the **same key** anywhere to see the same notebook.

---

## Running it on your own computer (for testing)

You can't just double-click `index.html` — browsers block the app's modules when
opened that way. Serve the folder with any tiny local web server instead:

```bash
# from inside the whowasthat folder, pick whichever you have:
python3 -m http.server 8000
#   then open  http://localhost:8000

# or, if you have Node.js:
npx serve
```

Note: location, notifications, and the background helper may be limited on
`http://localhost` compared to a real `https://` site — that's expected. For the
full experience, use one of the hosting options above.

---

## Making common changes

- **Change the default relays:** edit the `DEFAULT_RELAYS` list at the top of
  `js/config.js`. (Anyone already using the app keeps their own saved list.)
- **Rename the app:** change `APP_NAME` in `js/config.js`, the `<title>` in
  `index.html`, and the `name` in `manifest.webmanifest`.
- **Change colours:** the palette is defined as variables near the top of
  `css/styles.css` (look for `--accent`, `--ink`, `--surface`, etc.). Change a
  value there and it updates everywhere.
- **Add a new field to a person's card:** add its default in `emptyCard()` in
  `js/cards.js`, then add an input for it in the editor inside `js/ui.js`
  (search for `ed-notes` to see the pattern) and read it back in
  `captureEditorForm`.

---

## Limitations (please read — you asked to be told)

These are honest trade-offs of building a private, server-free app. None of them
are bugs.

1. **Pop-up notifications only work while the app is open in a tab** (it can be a
   background tab — that's fine). Getting notified when the app is **completely
   closed** requires a separate "push server" with its own keys, which a pure
   static, server-free Nostr app can't include. The in-app red unread bubble
   always works, and you'll always see new messages when you open the app.

2. **Staying logged in is opt-in.** By default the app keeps nothing on the
   device, so you paste your key each time. If you tick **"Keep me logged in on
   this device"** at login, your key is stored in this browser's local storage so
   refreshes keep you in — until you press "Log out" (which erases it). Only do
   this on a device that's yours; on a shared or public computer, leave it off.
   Your notebook data itself always lives encrypted on the relays — this only
   ever remembers the key locally, and only if you ask it to.

3. **Deleting your account is best-effort.** "Delete account" overwrites your
   notebook on the relays with an empty one and logs you out. But: a Nostr key
   can never truly be destroyed, some relays may keep older copies or ignore
   deletion requests, and **anything you already shared with someone else stays
   on their device.** Treat "delete" as "erase my copy," not "erase it from the
   universe."

4. **It must be hosted on HTTPS.** The map's "find me," notifications, and the
   background helper are disabled by browsers on insecure pages. Use one of the
   hosting options above.

5. **You alone hold the key.** There is no "forgot password." If you lose your
   `nsec`, no one — not us, not the relays — can recover your notebook. Save it
   somewhere safe (a password manager is ideal).

---

## A note on privacy

Your notebook is encrypted to yourself before it ever leaves your device, so the
relays store only an unreadable blob. Chat messages and shared cards are
encrypted to the recipient. Relays can still see *that* you're active and the
general size/time of what you publish — that's how every Nostr app works — but
not the contents of your notebook or messages.
