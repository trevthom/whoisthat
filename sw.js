// ============================================================================
// sw.js  —  A tiny service worker.
// ============================================================================
// A service worker is a small script the browser keeps around in the
// background. We use it for two modest jobs:
//   1. Let the app show system notifications reliably (some browsers require
//      notifications to be shown *through* a service worker).
//   2. Handle a click on one of those notifications by focusing the app.
//
// IMPORTANT: this does NOT give "push notifications when the app is fully
// closed". That needs a separate push server (see README → Limitations). With
// only this file, pop-ups work while the app is open in a tab (even a
// background tab).
//
// We deliberately do NOT cache the app aggressively, because the app must talk
// to the network (relays) to do anything useful, and stale caches cause
// confusing bugs for a non-technical owner. Keeping this simple is the point.
// ----------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  // Activate this version immediately rather than waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any open pages right away.
  event.waitUntil(self.clients.claim());
});

// If a notification is clicked, focus an existing window or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
