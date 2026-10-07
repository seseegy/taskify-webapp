import { create } from 'zustand';
import {
  readLockAttempts,
  readLockConfig,
  writeLockAttempts,
  writeLockConfig,
  type LockConfig,
} from './pin';

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;

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
      const failedAttempts = get().failedAttempts + 1;
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

export const LOCK_MAX_ATTEMPTS = MAX_ATTEMPTS;
