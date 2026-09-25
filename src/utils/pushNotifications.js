import { Platform } from 'react-native';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import firebaseApp, { db, auth } from '../config/firebase';

// From Firebase Console > Project Settings > Cloud Messaging > Web Push
// certificates. Only the public key is needed here — Firebase's backend
// holds the private half and does the actual push signing.
const VAPID_PUBLIC_KEY = 'BB6a79La0zEcSLXxq5dKROfsNtbu_XRkQw7hTX7puRjBhBUgcNJydyEF0sM76bKqBu4A68gPSjs6FVjCzscHWAM';

function assertWebPushSupported() {
  if (Platform.OS !== 'web') {
    throw new Error('Push notifications are only available in the web app right now.');
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Push notifications aren’t configured yet (missing VAPID key).');
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    throw new Error('This browser does not support push notifications.');
  }
}

// Registers this browser for court-hearing reminder pushes and saves the
// resulting device token under users/{uid}/pushTokens so the scheduled
// reminder job (functions/notifications/courtReminders.js) can target it.
// `promptPermission: true` (the default) shows the OS permission prompt if
// needed — pass false to only proceed when permission is already granted,
// used for the silent on-load check so refreshing doesn't need a re-click.
async function registerForCourtReminders({ promptPermission } = { promptPermission: true }) {
  assertWebPushSupported();

  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) {
    throw new Error('This browser does not support push notifications.');
  }

  if (Notification.permission !== 'granted') {
    if (!promptPermission) return null;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission was not granted.');
    }
  }

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error('Could not get a push token from this browser.');

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in.');
  await setDoc(doc(db, 'users', uid, 'pushTokens', token), {
    token,
    platform: 'web',
    createdAt: serverTimestamp(),
  }, { merge: true });

  await listenForForegroundMessages();

  return token;
}

export async function enableCourtReminders() {
  return registerForCourtReminders({ promptPermission: true });
}

// Called on load: if the browser already has notification permission granted
// from a previous visit, silently re-registers (no prompt, no error thrown)
// so the UI can show "enabled" instead of resetting to "Enable Court
// Reminders" on every refresh. Returns true if reminders are active.
export async function checkCourtRemindersEnabled() {
  try {
    if (Platform.OS !== 'web') return false;
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    const token = await registerForCourtReminders({ promptPermission: false });
    return !!token;
  } catch {
    return false;
  }
}

// FCM only invokes the service worker's background handler when the tab
// isn't focused — a foreground tab needs its own listener or messages just
// vanish silently. Safe to call anytime; it's a no-op until permission has
// actually been granted. Call this once on app load (in addition to right
// after enableCourtReminders) so foreground pushes keep working across
// reloads without the user re-clicking "Enable".
export async function listenForForegroundMessages() {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const { getMessaging, onMessage, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return;
    const messaging = getMessaging(firebaseApp);
    onMessage(messaging, (payload) => {
      const { title, body } = payload.notification || {};
      new Notification(title || 'PowerSync', { body: body || '', icon: '/favicon.ico' });
    });
  } catch {
    // Best-effort — a missing foreground listener shouldn't break the app.
  }
}
