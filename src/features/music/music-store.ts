import { create } from 'zustand';

/** Tab di `MusicSheet`. Radio tidak ada — lihat docs/RANCANGAN-MUSIK.md. */
export type MusicTab = 'cari' | 'antrean' | 'lirik';

/**
 * Keadaan panel musik, dipisahkan dari keadaan pemutarnya.
 *
 * Alasannya praktis: yang membuka panel ada di mana-mana — bilah mini, CommandPalette, dan
 * nanti pintasan lain — sementara keadaan pemutar (antrean, status, audio) hidup di satu
 * hook di `AppShell`. Kalau keduanya disatukan, setiap pemicu harus punya akses ke hook itu.
 *
 * Mengikuti pola `ui/toast-store.ts` dan `ui/confirm-store.ts`: store singleton + satu
 * fungsi imperatif untuk dipanggil dari mana saja.
 */
interface MusicSheetState {
  open: boolean;
  tab: MusicTab;
  show: (tab?: MusicTab) => void;
  hide: () => void;
  setTab: (tab: MusicTab) => void;
}

export const useMusicSheet = create<MusicSheetState>((set) => ({
  open: false,
  tab: 'cari',
  show: (tab) => set(tab ? { open: true, tab } : { open: true }),
  hide: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}));

/** Pemakaian: `openMusicSheet('antrean')`. Tanpa argumen = buka di tab yang terakhir dilihat. */
export function openMusicSheet(tab?: MusicTab) {
  useMusicSheet.getState().show(tab);
}
