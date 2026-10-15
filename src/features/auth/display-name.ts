/**
 * Nama tampilan pengguna (kolom `user_settings.display_name`) dan salinannya di perangkat untuk
 * layar masuk. Logika murni — hook-nya ada di useDisplayName.ts. Diuji di display-name.test.ts.
 *
 * Kenapa ada salinan di perangkat: layar masuk dirender SEBELUM database lokal ada (belum login),
 * jadi tidak bisa membaca `user_settings`. Salinannya sengaja bertahan setelah "Keluar"
 * (`clearDeviceData` tidak menghapusnya) — kalau dihapus, fitur ini tidak ada gunanya. Karena
 * itu pengguna di perangkat bersama bisa mematikannya (Pengaturan → Akun).
 */
import { clip, LIMITS } from '@/lib/limits';

/**
 * Rapikan nama: spasi/baris baru jadi satu spasi, buang karakter kontrol, potong ke batas.
 * Sengaja TIDAK membuang karakter format (ZWJ/ZWNJ): dipakai nama beraksara Persia/India dan
 * emoji majemuk; membuangnya mengubah nama orang.
 */
export function cleanDisplayName(raw: string | null | undefined): string {
  const collapsed = (raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim();
  return clip(collapsed, LIMITS.displayName).trimEnd();
}

/** Subset `Storage` yang dipakai di sini (memudahkan uji tanpa DOM). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOGIN_NAME_KEY = 'taskify-login-name';
/** Ada = pengguna mematikan fitur ini di perangkat ini. Bawaan (tidak ada) = aktif. */
export const LOGIN_NAME_OFF_KEY = 'taskify-login-name-off';

/** `localStorage`, atau null bila tak tersedia/diblokir (mis. mode privat tertentu). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function isLoginNameEnabled(store: KeyValueStore | null = browserStore()): boolean {
  try {
    return store?.getItem(LOGIN_NAME_OFF_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Nama yang diingat untuk layar masuk; null bila dimatikan, kosong, atau tak tersedia. */
export function readLoginName(store: KeyValueStore | null = browserStore()): string | null {
  try {
    if (!store || !isLoginNameEnabled(store)) return null;
    return cleanDisplayName(store.getItem(LOGIN_NAME_KEY)) || null;
  } catch {
    return null;
  }
}

/**
 * Simpan (atau hapus bila `name` kosong, atau fitur dimatikan) nama untuk layar masuk.
 * Tidak pernah melempar: penyimpanan yang gagal tidak boleh merusak aplikasi.
 */
export function writeLoginName(
  name: string | null | undefined,
  store: KeyValueStore | null = browserStore(),
): void {
  try {
    if (!store) return;
    const clean = cleanDisplayName(name);
    if (!clean || !isLoginNameEnabled(store)) store.removeItem(LOGIN_NAME_KEY);
    else store.setItem(LOGIN_NAME_KEY, clean);
  } catch {
    /* abaikan */
  }
}

/**
 * Hidupkan/matikan fitur di perangkat ini. Mematikan LANGSUNG menghapus nama tersimpan;
 * menghidupkan menyimpan `currentName` (nama dari database) bila ada.
 */
export function setLoginNameEnabled(
  enabled: boolean,
  currentName: string | null | undefined,
  store: KeyValueStore | null = browserStore(),
): void {
  try {
    if (!store) return;
    if (enabled) store.removeItem(LOGIN_NAME_OFF_KEY);
    else store.setItem(LOGIN_NAME_OFF_KEY, '1');
    writeLoginName(currentName, store);
  } catch {
    /* abaikan */
  }
}

/** Sapaan layar masuk: dengan nama → "Selamat datang kembali, X"; tanpa → sapaan umum. */
export function loginGreeting(name: string | null): { text: string; accent: string } {
  return name
    ? { text: `Selamat datang kembali, ${name}`, accent: name }
    : { text: 'Selamat datang di Taskify', accent: 'Taskify' };
}

/** Sapaan Beranda: "Selamat pagi" atau "Selamat pagi, X". */
export function homeGreeting(greeting: string, name: string): string {
  return name ? `${greeting}, ${name}` : greeting;
}
