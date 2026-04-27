importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyAA9oMvrsKbsixFBgJ5MlZuHdriVBcG4hA",
  authDomain: "financas-4f348.firebaseapp.com",
  projectId: "financas-4f348",
  storageBucket: "financas-4f348.firebasestorage.app",
  messagingSenderId: "521022969270",
  appId: "1:521022969270:web:aa68de175296674d35dd17"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Lidar com mensagens em segundo plano
messaging.onBackgroundMessage((payload) => {
  console.log('Recebido mensagem em segundo plano: ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || './logo.jpg',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

const CACHE_NAME = 'financas-v5'; // Incrementado para v5 para forçar atualização completa
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './logo.jpg'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

