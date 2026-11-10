// Service worker: la app funciona sin conexión y muestra las notificaciones.
// Cambiá VERSION cada vez que publiques cambios: los teléfonos bajan la versión nueva completa y la usan
// desde la próxima vez que abren la app (nunca mezclan archivos de dos versiones).
const VERSION = 'planthy-v1.0.0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './js/app.js', './js/dates.js', './js/rules.js', './js/merge.js', './js/store.js', './js/sync.js', './js/photos.js',
  './js/weather.js', './js/meteo.js', './js/push.js', './js/ics.js', './js/zip.js', './js/backup.js',
  './js/ui/dom.js', './js/ui/hoy.js', './js/ui/plantas.js', './js/ui/calendario.js', './js/ui/ajustes.js',
  './js/ui/onboarding.js', './js/ui/registro.js', './js/ui/fotos.js', './js/ui/tareas.js',
];
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Solo los archivos de la app. GitHub y Open-Meteo van siempre por la red.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (DEV) { e.respondWith(fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true }))); return; }
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    if (e.request.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
    return fetch(e.request);
  }));
});

/* ---------- notificaciones ---------- */
// El aviso llega en formato "declarativo" (iOS 18.4+ lo muestra solo, sin pasar por acá).
// En iOS más viejo y en otros navegadores llega acá y lo mostramos nosotros.
self.addEventListener('push', e => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { notification: { title: 'Planthy', body: e.data ? e.data.text() : '' } }; }
  const n = msg.notification || msg;
  const url = n.navigate || new URL('./#hoy', self.registration.scope).href;
  const badge = Number(n.app_badge);
  e.waitUntil(Promise.all([
    self.registration.showNotification(n.title || 'Planthy', {
      body: n.body || '', lang: n.lang || 'es-AR', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      tag: 'planthy-dia', data: { url },
    }),
    badge > 0 && self.navigator.setAppBadge ? self.navigator.setAppBadge(badge).catch(() => {}) : null,
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || new URL('./#hoy', self.registration.scope).href;
  const hash = new URL(url).hash || '#hoy';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
        w.postMessage({ type: 'go', hash });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
