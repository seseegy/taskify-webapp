import { create } from 'zustand';
import {
  ATTEMPTS_KEY,
  COOLDOWN_MS,
  readLockAttempts,
  readLockConfig,
  writeLockAttempts,
  writeLockConfig,
  type LockConfig,
} from './pin';

const MAX_ATTEMPTS = 5;

interface LockState {
  config: LockConfig | null;
  locked: boolean;
  failedAttempts: number;
  cooldownUntil: number | null;
  hiddenAt: number | null;

  setConfig: (config: LockConfig | null) => void;
  lock: () => void;
  unlock: () => void;
  registerFailure: () => void;
  onHidden: () => void;
  onVisible: () => void;
}

export const useLockStore = create<LockState>((set, get) => {
  const initial = readLockConfig();
  const attempts = readLockAttempts();
  return {
    config: initial,
    locked: initial !== null, // terkunci saat aplikasi dibuka jika PIN aktif
    failedAttempts: attempts.failedAttempts,
    cooldownUntil: attempts.cooldownUntil,
    hiddenAt: null,

    setConfig: (config) => {
      writeLockConfig(config);
      writeLockAttempts({ failedAttempts: 0, cooldownUntil: null });
      set({ config, locked: false, failedAttempts: 0, cooldownUntil: null });
    },
    lock: () => {
      if (get().config) set({ locked: true });
    },
    unlock: () => {
      writeLockAttempts({ failedAttempts: 0, cooldownUntil: null });
      set({ locked: false, failedAttempts: 0, cooldownUntil: null });
    },
    registerFailure: () => {
      // Baca ulang dari penyimpanan: tab lain mungkin sudah menambah hitungan. Tanpa ini tiap tab
      // menghitung sendiri dan batas 5 percobaan efektif berlaku per tab.
      const stored = readLockAttempts();
      const failedAttempts = Math.max(get().failedAttempts, stored.failedAttempts) + 1;
      if (failedAttempts >= MAX_ATTEMPTS) {
        const next = { failedAttempts: 0, cooldownUntil: Date.now() + COOLDOWN_MS };
        writeLockAttempts(next);
        set(next);
      } else {
        writeLockAttempts({ failedAttempts, cooldownUntil: get().cooldownUntil });
        set({ failedAttempts });
      }
    },
    onHidden: () => set({ hiddenAt: Date.now() }),
    onVisible: () => {
      const { config, hiddenAt } = get();
      if (!config || hiddenAt === null) return;
      const elapsedMin = (Date.now() - hiddenAt) / 60_000;
      set({ hiddenAt: null, locked: get().locked || elapsedMin >= config.autoLockMinutes });
    },
  };
});

// Tab lain mengubah hitungan/jeda → ikuti, agar jeda 30 dtk berlaku di semua tab.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== ATTEMPTS_KEY && e.key !== null) return;
    const { failedAttempts, cooldownUntil } = readLockAttempts();
    useLockStore.setState({ failedAttempts, cooldownUntil });
  });
}

export const LOCK_MAX_ATTEMPTS = MAX_ATTEMPTS;
