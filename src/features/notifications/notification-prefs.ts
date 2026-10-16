/**
 * Preferensi notifikasi PER PERANGKAT yang perlu dibaca service worker.
 *
 * Service worker tidak bisa membaca localStorage, jadi preferensinya disimpan di Cache Storage
 * (sama seperti kotak masuk "Bagikan ke Taskify"). Nama cache & key HARUS sama dengan yang dibaca
 * `public/sw-extra.js`.
 */
export const PREFS_CACHE = 'taskify-prefs';
export const NOTIFICATION_PREFS_KEY = '/__prefs/notifications';

export interface NotificationPrefs {
  /** Notifikasi tampil tanpa judul tugas ("Ada pengingat tugas") — aman di layar kunci. */
  hideContent: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { hideContent: false };

export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  const v = (value ?? {}) as Partial<NotificationPrefs>;
  return { hideContent: v.hideContent === true };
}

export async function readNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const res = await (await caches.open(PREFS_CACHE)).match(NOTIFICATION_PREFS_KEY);
    return parseNotificationPrefs(res ? await res.json() : null);
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export async function writeNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  const cache = await caches.open(PREFS_CACHE);
  await cache.put(
    NOTIFICATION_PREFS_KEY,
    new Response(JSON.stringify(prefs), { headers: { 'Content-Type': 'application/json' } }),
  );
}
