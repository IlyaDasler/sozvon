// PWA без офлайн-кэша: интерфейс и API всегда идут в сеть.
// Нужен только для установки приложения на Android; старых файлов не держит.
const VERSION = '3.5.3';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // На всякий случай убираем кэши прошлых версий, если они когда-то были.
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', () => {
  // Без respondWith(): запрос уходит в сеть как обычно, без кэша.
});
