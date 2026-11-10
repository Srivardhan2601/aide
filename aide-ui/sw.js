// Aide service worker: network first, cache as offline fallback.
// Network-first means you always get the latest files while online.
const CACHE = 'aide-v12';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'mock-data.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Never cache API responses: stale queue data is worse than the "offline" fallback.
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});

// Clicking a notification: focus Aide (or open it) on the right screen.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const view = (e.notification.data && e.notification.data.view) || 'home';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((w) => new URL(w.url).origin === location.origin);
      if (win) {
        win.postMessage({ type: 'go', view });
        return win.focus();
      }
      return self.clients.openWindow(`./?view=${encodeURIComponent(view)}`);
    })
  );
});
