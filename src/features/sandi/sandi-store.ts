import { create } from 'zustand';
import { clearClipboardNow } from './clipboard';

/**
 * Status kunci brankas. Store ini memegang kunci data (DEK) di memori sebagai CryptoKey
 * non-extractable; ia hilang dari sini saat tab dimuat ulang atau dikunci, dan store ini tidak
 * pernah menulisnya ke storage mana pun.
 *
 * Satu-satunya pengecualian adalah pilihan pengguna "Ingat perangkat ini" (`device-trust.ts`):
 * DEK disimpan di IndexedDB sebagai CryptoKey BURAM (byte-nya tidak bisa dibaca JavaScript),
 * berlaku 30 hari, dan batal saat kunci brankas diganti atau akun keluar.
 */
export const AUTO_LOCK_OPTIONS = [0, 1, 5, 15] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number];
export const DEFAULT_AUTO_LOCK: AutoLockMinutes = 5;
export const AUTO_LOCK_STORAGE_KEY = 'taskify-sandi-autolock';

export function readAutoLock(): AutoLockMinutes {
  try {
    const n = Number(localStorage.getItem(AUTO_LOCK_STORAGE_KEY));
    return (AUTO_LOCK_OPTIONS as readonly number[]).includes(n) &&
      localStorage.getItem(AUTO_LOCK_STORAGE_KEY) !== null
      ? (n as AutoLockMinutes)
      : DEFAULT_AUTO_LOCK;
  } catch {
    return DEFAULT_AUTO_LOCK;
  }
}

export interface LockCheck {
  now: number;
  /** Interaksi terakhir (klik/ketik) */
  lastActivity: number;
  /** Kapan tab mulai tersembunyi; null = sedang terlihat */
  hiddenAt: number | null;
  autoLockMinutes: AutoLockMinutes;
}

/**
 * Apakah brankas harus dikunci sekarang?
 *  - Tab tersembunyi: kunci setelah `autoLockMinutes` (0 = segera).
 *  - Tab terlihat tetapi tidak ada interaksi: kunci setelah `autoLockMinutes` (0 = tidak ada batas idle
 *    selama terlihat, karena "segera" berarti saat ditinggalkan).
 */
export function shouldLock(c: LockCheck): boolean {
  const limit = c.autoLockMinutes * 60_000;
  if (c.hiddenAt !== null) return c.now - c.hiddenAt >= limit;
  if (c.autoLockMinutes === 0) return false;
  return c.now - c.lastActivity >= limit;
}

/**
 * Kunci brankas bila akun berubah: keluar (sesi hilang dari mana pun: tombol Keluar, sesi dicabut
 * dari perangkat lain, refresh token gagal) atau akun lain masuk di tab yang sama. Tanpa ini
 * DEK akun sebelumnya tetap di memori karena AppShell (dan timer kunci otomatisnya) sudah
 * di-unmount saat layar login tampil. Refresh token milik akun yang sama TIDAK mengunci.
 */
export function shouldLockOnAuthChange(
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  if (previousUserId === null) return false; // belum ada akun sebelumnya (mis. INITIAL_SESSION)
  return nextUserId !== previousUserId;
}

interface SandiState {
  dek: CryptoKey | null;
  /**
   * `wrapped_key` dari record kunci yang dipakai membuka `dek`. Bila record di database berubah
   * (kunci diganti di perangkat lain, DEK dirotasi), `dek` ini sudah usang dan tidak boleh dipakai.
   */
  stamp: string | null;
  /** true selama penggantian kunci dari perangkat ini berlangsung (record berubah SENGAJA). */
  rekeying: boolean;
  autoLockMinutes: AutoLockMinutes;
  lastActivity: number;
  hiddenAt: number | null;
  unlock: (dek: CryptoKey, stamp: string) => void;
  setRekeying: (value: boolean) => void;
  lock: () => void;
  touch: () => void;
  hide: () => void;
  show: () => void;
  setAutoLock: (minutes: AutoLockMinutes) => void;
}

export const useSandiStore = create<SandiState>((set, get) => ({
  dek: null,
  stamp: null,
  rekeying: false,
  autoLockMinutes: readAutoLock(),
  lastActivity: Date.now(),
  hiddenAt: null,
  unlock: (dek, stamp) => set({ dek, stamp, lastActivity: Date.now(), hiddenAt: null }),
  setRekeying: (rekeying) => set({ rekeying }),
  lock: () => {
    if (!get().dek) return;
    set({ dek: null, stamp: null, hiddenAt: null });
    clearClipboardNow(); // jangan biarkan sandi tertinggal di papan klip setelah dikunci
  },
  touch: () => {
    if (get().dek) set({ lastActivity: Date.now() });
  },
  hide: () => set({ hiddenAt: Date.now() }),
  show: () => {
    const s = get();
    if (!s.dek) return set({ hiddenAt: null });
    // Kunci SEBELUM konten sempat terlihat lagi
    if (shouldLock({ ...s, now: Date.now() })) get().lock();
    else set({ hiddenAt: null, lastActivity: Date.now() });
  },
  setAutoLock: (autoLockMinutes) => {
    try {
      localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(autoLockMinutes));
    } catch {
      /* penyimpanan diblokir: tetap berlaku untuk sesi ini */
    }
    set({ autoLockMinutes });
  },
}));
