import { create } from 'zustand';

/** Command palette (pencarian global + quick capture). Buka: Ctrl/⌘+K atau "/". */
interface PaletteState {
  open: boolean;
  initial: string;
  show: (initial?: string) => void;
  hide: () => void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  initial: '',
  show: (initial = '') => set({ open: true, initial }),
  hide: () => set({ open: false }),
}));
