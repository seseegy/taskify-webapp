/**
 * Web Push di sisi browser.
 *  1. Minta izin notifikasi
 *  2. Berlangganan lewat service worker PWA (pushManager.subscribe + kunci publik VAPID)
 *  3. Simpan langganan ke Supabase `push_subscriptions` (butuh online)
 * Server (Edge Function send-reminders) memakai langganan ini untuk mengirim pengingat.
 */
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

export type PushState = 'loading' | 'unsupported' | 'no-key' | 'no-sw' | 'denied' | 'off' | 'on';

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

async function getRegistration() {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function readPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!env.vapidPublicKey) return 'no-key';
  const reg = await getRegistration();
  if (!reg) return 'no-sw';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(): Promise<void> {
  const reg = await getRegistration();
  if (!reg)
    throw new Error('Service worker belum aktif. Buka versi yang sudah di-build/di-install.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Izin notifikasi ditolak.');

  const key = base64UrlToBytes(env.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  // Kunci VAPID berganti → langganan lama tidak valid
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw new Error(`Gagal menyimpan langganan: ${error.message}`);
}

export async function disablePush(): Promise<void> {
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/**
 * Lepas langganan push perangkat ini saat KELUAR atau saat perangkat dipakai akun lain.
 *
 * Tanpa ini perangkat tetap menerima pengingat (berisi judul tugas) milik akun yang sudah keluar,
 * dan akun berikutnya gagal mengaktifkan notifikasi: endpoint yang sama masih tercatat milik akun
 * lama, jadi upsert-nya ditolak RLS.
 *
 * - Baris di server dihapus bila sesi masih berlaku (best effort, dibatasi waktu: offline tidak
 *   boleh menahan logout).
 * - Langganan di browser SELALU dicabut. Endpoint yang dicabut dijawab 404/410 oleh layanan push,
 *   dan send-reminders lalu menghapus baris lamanya sendiri — jadi tetap bersih walau langkah
 *   pertama gagal.
 */
export async function forgetPushSubscription(timeoutMs = 4_000): Promise<void> {
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint),
      new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs))),
    ]);
  } catch {
    /* offline / sesi sudah habis: cukup cabut di browser */
  } finally {
    clearTimeout(timer);
  }
  await sub.unsubscribe();
}

export async function sendTestPush(): Promise<{ devices: number; sent: number }> {
  const { data, error } = await supabase.functions.invoke<{ devices: number; sent: number }>(
    'send-reminders',
    { body: { test: true } },
  );
  if (error) throw new Error(`Edge Function gagal: ${error.message}`);
  return data ?? { devices: 0, sent: 0 };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}
