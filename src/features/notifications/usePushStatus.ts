import { useEffect } from 'react';
import { create } from 'zustand';
import { readPushState, type PushState } from './push';

interface PushStore {
  state: PushState;
  refresh: () => Promise<void>;
}

/** Status notifikasi perangkat ini, dibagikan ke semua komponen. */
export const usePushStore = create<PushStore>((set) => ({
  state: 'loading',
  refresh: async () => set({ state: await readPushState().catch(() => 'unsupported' as const) }),
}));

let initialized = false;

export function usePushStatus() {
  const state = usePushStore((s) => s.state);
  const refresh = usePushStore((s) => s.refresh);
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    void refresh();
    // Service worker baru terdaftar beberapa saat setelah load
    void navigator.serviceWorker?.ready.then(() => refresh());
  }, [refresh]);
  return { state, refresh };
}
