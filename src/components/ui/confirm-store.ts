import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface ConfirmOptions {
  /** Pertanyaannya, singkat. Mis. "Hapus dompet Tunai?" */
  title: string;
  /** Akibat yang perlu diketahui sebelum memutuskan. */
  description?: ReactNode;
  /** Label tombol yang melanjutkan. Bawaan: "Lanjutkan". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' = tindakan merusak (tombol merah). Bawaan 'danger', karena hampir semua
   *  konfirmasi di aplikasi ini adalah penghapusan. */
  tone?: 'danger' | 'default';
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  /** Tanya pengguna. `true` = lanjutkan, `false` = batal / ditutup / Esc. */
  ask: (options: ConfirmOptions) => Promise<boolean>;
  /** Jawab permintaan yang sedang terbuka. Tanpa permintaan terbuka, tidak melakukan apa-apa. */
  settle: (confirmed: boolean) => void;
}

let nextId = 1;
/** Disimpan di luar store: fungsi tidak perlu ikut memicu render. */
let pending: ((confirmed: boolean) => void) | null = null;

export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,

  ask: (options) =>
    new Promise<boolean>((resolve) => {
      // Permintaan yang masih terbuka dibatalkan, bukan ditumpuk: dua dialog konfirmasi
      // sekaligus membuat pengguna tidak tahu sedang menjawab yang mana. Janji yang lama
      // WAJIB diselesaikan, kalau tidak pemanggilnya menggantung selamanya.
      pending?.(false);
      pending = resolve;
      set({ request: { ...options, id: nextId++ } });
    }),

  settle: (confirmed) => {
    const resolve = pending;
    pending = null;
    set({ request: null });
    resolve?.(confirmed);
  },
}));

/**
 * Konfirmasi dengan dialog milik aplikasi, pengganti `window.confirm`.
 *
 * Sengaja TIDAK dinamai `confirm` supaya tidak bisa tertukar dengan `window.confirm`: kalau
 * importnya lupa, `confirm(...)` akan diam-diam memakai dialog bawaan sistem lagi.
 *
 * ```ts
 * if (!(await askConfirm({ title: 'Hapus tag?' }))) return;
 * ```
 */
export const askConfirm = (options: ConfirmOptions): Promise<boolean> =>
  useConfirmStore.getState().ask(options);
