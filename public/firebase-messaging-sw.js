// Handles push messages while the PowerSync tab isn't focused. Loaded via
// navigator.serviceWorker.register('/firebase-messaging-sw.js') in
// src/utils/pushNotifications.js. Config values mirror src/config/firebase.js
// (a service worker can't import that module, so they're duplicated here).
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBAfQyphiBW_LOxaqHuqFKhXv5c8y5Lrd8',
  authDomain: 'dars-4e5d0.firebaseapp.com',
  projectId: 'dars-4e5d0',
  storageBucket: 'dars-4e5d0.firebasestorage.app',
  messagingSenderId: '265945958214',
  appId: '1:265945958214:web:b9e1c524f29f6a3c608747',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'PowerSync', {
    body: body || '',
    icon: '/favicon.ico',
  });
});
