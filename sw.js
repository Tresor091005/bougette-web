// Version web installable (2026-11-20, avec l'utilisateur : l'accès depuis un iPhone) : ce service worker garde l'app
// elle-même (ses fichiers) pour qu'elle s'ouvre hors ligne. Il ne voit jamais les données : elles restent dans le
// navigateur (IndexedDB), rien ne part nulle part. Réseau d'abord, pour tous les fichiers (une nouvelle version arrive
// entière dès qu'on est en ligne, jamais à moitié) ; hors ligne, la copie gardée.
const CACHE = 'bougette-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
