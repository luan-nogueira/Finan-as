const CACHE_NAME = 'financas-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  // Estratégia Network First para arquivos do app, garantindo atualizações rápidas
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

