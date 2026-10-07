import { create } from 'zustand';

export interface ConfirmOptions {
  /** Judul dialog. Default: "Konfirmasi". */
  title?: string;
  /** Teks tombol setuju. Default: "Ya, lanjutkan". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Aksi merusak (hapus/keluar) → tombol merah. Default: true. */
  destructive?: boolean;
}

interface Pending extends ConfirmOptions {
  message: string;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  pending: Pending | null;
  settle: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  settle: (ok) => {
    const p = get().pending;
    if (!p) return;
    set({ pending: null });
    p.resolve(ok);
  },
}));

/** Jumlah <ConfirmHost> yang sedang terpasang (seharusnya 1, di AppShell). */
let hosts = 0;
export const registerConfirmHost = () => {
  hosts += 1;
  return () => {
    hosts -= 1;
  };
};

/**
 * Pengganti `window.confirm` yang serasi dengan desain dan bisa dibaca pembaca layar.
 * Pemakaian: `if (!(await confirmDialog('Hapus item ini?', { confirmLabel: 'Hapus' }))) return;`
 * Hasil `true` hanya jika pengguna menekan tombol setuju; Esc/klik latar/Batal → `false`.
 */
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  // Pengaman: tanpa host dialog tidak akan pernah muncul → jangan biarkan aksi menggantung
  if (hosts === 0) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    useConfirmStore.getState().pending?.resolve(false); // permintaan lama dibatalkan
    useConfirmStore.setState({ pending: { message, ...options, resolve } });
  });
}
