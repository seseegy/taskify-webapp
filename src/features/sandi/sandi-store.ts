import { create } from 'zustand';
import { clearClipboardNow } from './clipboard';

/**
 * Status kunci brankas. Kunci data (DEK) HANYA ada di memori sebagai CryptoKey non-extractable:
 * tidak pernah ke localStorage/IndexedDB, dan hilang saat tab dimuat ulang atau dikunci.
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

interface SandiState {
  dek: CryptoKey | null;
  autoLockMinutes: AutoLockMinutes;
  lastActivity: number;
  hiddenAt: number | null;
  unlock: (dek: CryptoKey) => void;
  lock: () => void;
  touch: () => void;
  hide: () => void;
  show: () => void;
  setAutoLock: (minutes: AutoLockMinutes) => void;
}

export const useSandiStore = create<SandiState>((set, get) => ({
  dek: null,
  autoLockMinutes: readAutoLock(),
  lastActivity: Date.now(),
  hiddenAt: null,
  unlock: (dek) => set({ dek, lastActivity: Date.now(), hiddenAt: null }),
  lock: () => {
    if (!get().dek) return;
    set({ dek: null, hiddenAt: null });
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
