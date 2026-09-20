// Service worker for TurnZero — push notifications + an offline-capable app shell.
// Must be served from the site's root (e.g. https://yoursite.com/sw.js).
//
// Bump VERSION whenever you deploy new files in /vendor (they are cached until then).
// Everything else is fetched fresh from the network first, so normal deploys show up immediately.

const VERSION = '2.0.1';
const CACHE = 'turnzero-' + VERSION;
const SHELL = [
  '/', '/index.html', '/app.js', '/config.js', '/manifest.json',
  '/vendor/supabase.js', '/vendor/qrcode.min.js', '/vendor/jsQR.js',
  '/icon-192.png', '/badge-96.png', '/favicon-32.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  // One missing file must never stop the worker (and push with it) from installing.
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('turnzero-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, but if the network is slow (bad venue wifi) fall back to the cached copy after a few seconds.
function networkFirst(req, cacheKey, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const key = cacheKey || req;
    const fromCache = () => caches.match(key);
    const timer = setTimeout(() => {
      fromCache().then((r) => { if (r && !settled) { settled = true; resolve(r); } });
    }, timeoutMs);
    fetch(req).then((res) => {
      clearTimeout(timer);
      const copy = res && res.ok ? res.clone() : null;
      if (copy) caches.open(CACHE).then((c) => c.put(key, copy));
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      if (!settled) fromCache().then((r) => { settled = true; resolve(r || Response.error()); });
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts: show the cached copy instantly, refresh it in the background.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const refresh = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || refresh;
        })
      )
    );
    return;
  }

  // Anything else on another origin (the Supabase API, realtime, ...) is never touched.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Every timer link (/?view=…, /?control=…) is the same single page, so one cached copy serves them all offline.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(networkFirst(req, '/index.html', 4000));
    }
    return;
  }

  // Pinned libraries and icons only change when VERSION does: cache first.
  if (url.pathname.startsWith('/vendor/') || /\.(png|ico)$/.test(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // app.js, config.js, manifest: always try the network first so a new deploy is picked up at once.
  event.respondWith(networkFirst(req, null, 4000));
});

self.addEventListener('push', (event) => {
  let data = { title: 'TurnZero', body: 'Timer update.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  // Only ever open a page on this same site, whatever the payload says.
  let target = '/';
  try {
    const u = new URL(data.url || '/', self.location.origin);
    if (u.origin === self.location.origin) target = u.pathname + u.search;
  } catch (e) {}
  const isEnd = data.event === 'time_up';
  const options = {
    body: data.body,
    tag: data.tag || 'round-timer',
    renotify: true,               // every milestone shares one tag per timer; renotify makes each one buzz/ding again
    icon: '/icon-192.png',        // the large picture in the notification
    badge: '/badge-96.png',       // the small monochrome status-bar icon (Android shows Chrome's own without this)
    vibrate: isEnd ? [300, 150, 300, 150, 600] : [200],
    requireInteraction: isEnd,    // the time's-up alert stays on screen until dismissed
    data: { url: target },
  };
  event.waitUntil(self.registration.showNotification(data.title || 'TurnZero', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  const timerId = target.searchParams.get('view') || target.searchParams.get('control');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Prefer a window already showing this timer (view page, control page, or a combined view containing it).
      for (const client of clientList) {
        try {
          const u = new URL(client.url);
          const ids = [u.searchParams.get('view'), u.searchParams.get('control'), ...(u.searchParams.get('multi') || '').split(',')];
          if (timerId && ids.includes(timerId) && 'focus' in client) return client.focus();
        } catch (e) {}
      }
      if (self.clients.openWindow) return self.clients.openWindow(target.href);
    })
  );
});
