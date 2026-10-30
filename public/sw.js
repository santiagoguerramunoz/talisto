// Service worker de TaListo!
// - Páginas: siempre desde internet (así cada publicación nueva se ve enseguida); sin conexión usa la última copia.
// - Archivos estáticos con hash (/_next/static) e íconos: se guardan y se reutilizan.
// - Supabase, mapas y rutas: no pasan por acá (siempre en vivo).
// - Avisos (push): muestra la notificación y, al tocarla, abre la pantalla que corresponde.
const CACHE = 'talisto-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const claves = await caches.keys();
      await Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const guardado = await cache.match(req);
        if (guardado) return guardado;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copia));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/login')) || Response.error())
    );
  }
});

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { titulo: 'TaListo!', cuerpo: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.titulo || 'TaListo!', {
      body: d.cuerpo || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/panel' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/panel', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const v of ventanas) {
        if (new URL(v.url).origin === self.location.origin && 'focus' in v) {
          await v.focus();
          if ('navigate' in v) await v.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
