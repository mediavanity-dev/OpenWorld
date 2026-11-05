// Service worker: makes the app installable and reloads instant.
// Caches ONLY the app's own files (page, scripts, styles, icons). Map tiles, weather,
// wildlife etc. are never cached here; they keep their normal browser handling.
// The main site (/OpenWorld/) and the beta (/OpenWorld/beta/) each register their own
// worker; caches are named per scope and never touch each other.
const SCOPE = self.registration.scope;                 // e.g. https://…/OpenWorld/ or …/OpenWorld/beta/
const CACHE = `openworld-app-v2|${SCOPE}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // remove only this scope's old caches (and the original unscoped one)
    for (const k of await caches.keys()) if ((k.endsWith(`|${SCOPE}`) && k !== CACHE) || k === 'openworld-app-v1') await caches.delete(k);
    await self.clients.claim();
  })());
});

// requests that belong to a nested app (the beta inside the main scope) are left to it
const nestedBeta = (url) => !SCOPE.endsWith('/beta/') && url.href.startsWith(`${SCOPE}beta/`);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE) || nestedBeta(url)) return;
  // page: network first (so updates arrive), fall back to cache when offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r; })
      .catch(() => caches.open(CACHE).then((c) => c.match('./index.html'))));
    return;
  }
  // hashed build assets never change: cache first
  if (url.pathname.includes('/assets/') || SHELL.some((s) => url.pathname.endsWith(s.replace('./', '/')))) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) c.put(req, r.clone());
      return r;
    }))));
  }
});
