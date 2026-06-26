// ============================================================================
// notifications.js  —  Pop-up alerts for new messages.
// ============================================================================
// Two kinds of "notification" exist in this app:
//   1. The little red bubble on the chat icon (handled in the UI) — always works.
//   2. A system pop-up (the kind that slides in from the corner of your screen).
//      These work while the app is open in a tab, even if that tab is in the
//      background. See the README for why "notifications when the app is fully
//      closed" needs an extra piece of server software we don't ship here.
// ----------------------------------------------------------------------------

let swReg = null;

export async function initNotifications() {
  if ('serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('Service worker not registered:', e);
    }
  }
}

export function notificationsAvailable() {
  return 'Notification' in window;
}

export function notificationPermission() {
  return notificationsAvailable() ? Notification.permission : 'denied';
}

export async function askNotificationPermission() {
  if (!notificationsAvailable()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// Show a pop-up. Only fires if the page isn't already in the foreground, so the
// user isn't pinged for a chat they're already looking at.
export function notify(title, body, onClick) {
  if (!notificationsAvailable() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, {
      body,
      icon: './icon.png',
      badge: './icon.png',
      tag: 'whowasthat-msg',
    });
    if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch (e) {
    // Some browsers require notifications to come from the service worker.
    if (swReg && swReg.showNotification) {
      swReg.showNotification(title, { body, icon: './icon.png', tag: 'whowasthat-msg' });
    }
  }
}
