// Tambahan service worker Taskify (dimuat Workbox via importScripts, lihat vite.config.ts):
//   1. Web Push — payload dari Edge Function send-reminders: { title, body, url, tag }
//   2. Klik notifikasi → buka/fokus aplikasi di URL tujuan
//   3. Share Target — POST /bagikan dari aplikasi lain → simpan ke Cache Storage → /bagikan

const SHARE_CACHE = 'taskify-share';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Taskify', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Taskify';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      lang: 'id',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// ----------------------------------------------------------------------------- Share Target
// Didaftarkan sebelum handler Workbox, jadi POST /bagikan ditangani di sini.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/bagikan') return;

  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        for (const key of await cache.keys()) await cache.delete(key);

        const files = [];
        let i = 0;
        for (const file of form.getAll('files')) {
          if (!(file instanceof File) || file.size === 0) continue;
          const key = `/__share/file-${i++}`;
          await cache.put(
            key,
            new Response(file, {
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
            }),
          );
          files.push({ key, name: file.name, type: file.type, size: file.size });
        }
        const meta = {
          title: String(form.get('title') || ''),
          text: String(form.get('text') || ''),
          url: String(form.get('url') || ''),
          files,
          received_at: new Date().toISOString(),
        };
        await cache.put(
          '/__share/meta',
          new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }),
        );
      } catch (e) {
        console.error('[share] gagal menerima', e);
      }
      return Response.redirect('/bagikan?masuk=1', 303);
    })(),
  );
});
