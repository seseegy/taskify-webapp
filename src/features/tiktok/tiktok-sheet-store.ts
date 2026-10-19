import { create } from 'zustand';

/**
 * Panel "Unduh dari TikTok" (global, dibuka dari palet perintah). `input` = link yang sudah
 * diketahui (mis. ditempel di palet) → langsung diekstrak; kosong = pengguna menempel sendiri.
 */
interface TikTokSheetState {
  open: boolean;
  input: string;
  show: (input?: string) => void;
  hide: () => void;
}

export const useTikTokSheet = create<TikTokSheetState>((set) => ({
  open: false,
  input: '',
  show: (input = '') => set({ open: true, input }),
  hide: () => set({ open: false }),
}));
