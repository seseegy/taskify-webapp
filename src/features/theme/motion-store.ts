import { create } from 'zustand';

/**
 * Animasi latar (blob bergerak di belakang kaca). Menggerakkan latar memaksa SEMUA permukaan
 * `backdrop-filter` dihitung ulang tiap frame, jadi ini pengaturan yang berarti bagi HP lama.
 *   auto = bergerak, kecuali hemat daya (baterai ≤ 20% & tidak mengisi, atau Penghemat Data)
 *   on   = selalu bergerak      off = tidak pernah bergerak
 * `prefers-reduced-motion` dari sistem selalu menang (ditangani di CSS).
 */
export type MotionPreference = 'auto' | 'on' | 'off';

export const MOTION_STORAGE_KEY = 'taskify-motion';
const LOW_BATTERY = 0.2;

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}
interface NetworkInformation extends EventTarget {
  saveData?: boolean;
}
type NavigatorExtras = Navigator & {
  getBattery?: () => Promise<BatteryManager>;
  connection?: NetworkInformation;
};

function readPreference(): MotionPreference {
  try {
    const v = localStorage.getItem(MOTION_STORAGE_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

interface MotionState {
  preference: MotionPreference;
  /** Perangkat sedang hemat daya (dideteksi, hanya berlaku pada mode "auto") */
  powerSaver: boolean;
  setPreference: (p: MotionPreference) => void;
  setPowerSaver: (v: boolean) => void;
}

export const useMotionStore = create<MotionState>((set) => ({
  preference: readPreference(),
  powerSaver: false,
  setPreference: (preference) => {
    try {
      if (preference === 'auto') localStorage.removeItem(MOTION_STORAGE_KEY);
      else localStorage.setItem(MOTION_STORAGE_KEY, preference);
    } catch {
      /* penyimpanan tidak tersedia → berlaku untuk sesi ini saja */
    }
    set({ preference });
  },
  setPowerSaver: (powerSaver) => set({ powerSaver }),
}));

/** Latar harus diam? (dipakai untuk kelas `save-power` di <html>) */
export const shouldFreezeBackdrop = (s: Pick<MotionState, 'preference' | 'powerSaver'>) =>
  s.preference === 'off' || (s.preference === 'auto' && s.powerSaver);

/**
 * Pantau baterai & Penghemat Data. Mengembalikan fungsi pembersih.
 * Browser tanpa API ini (Safari/Firefox) hanya mengandalkan pengaturan manual.
 */
export function watchPowerSaver(): () => void {
  const nav = navigator as NavigatorExtras;
  const cleanups: (() => void)[] = [];
  const state = { lowBattery: false, saveData: nav.connection?.saveData === true };
  const push = () => useMotionStore.getState().setPowerSaver(state.lowBattery || state.saveData);

  if (nav.connection) {
    const onChange = () => {
      state.saveData = nav.connection?.saveData === true;
      push();
    };
    nav.connection.addEventListener('change', onChange);
    cleanups.push(() => nav.connection?.removeEventListener('change', onChange));
  }

  let cancelled = false;
  nav
    .getBattery?.()
    .then((battery) => {
      if (cancelled) return;
      const onChange = () => {
        state.lowBattery = !battery.charging && battery.level <= LOW_BATTERY;
        push();
      };
      onChange();
      battery.addEventListener('levelchange', onChange);
      battery.addEventListener('chargingchange', onChange);
      cleanups.push(() => {
        battery.removeEventListener('levelchange', onChange);
        battery.removeEventListener('chargingchange', onChange);
      });
    })
    .catch(() => {
      /* ditolak oleh kebijakan izin → abaikan */
    });
  push();

  return () => {
    cancelled = true;
    cleanups.forEach((fn) => fn());
  };
}
