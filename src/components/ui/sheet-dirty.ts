import { createContext, useContext, useEffect } from 'react';

/** Penyetel "ada isian belum disimpan" milik `Sheet` terdekat (lihat useSheetDirty). */
export const SheetDirtyContext = createContext<((dirty: boolean) => void) | null>(null);

/**
 * Tandai bahwa form di dalam `Sheet` punya isian yang belum disimpan. Selama `dirty` true,
 * menutup panel oleh PENGGUNA (Esc, klik di luar panel, tombol Tutup) meminta konfirmasi dulu,
 * supaya satu ketukan meleset di HP tidak membuang isian. Penutupan terprogram (mis. setelah
 * Simpan) tidak ditanya. Di luar `Sheet`, hook ini tidak melakukan apa-apa.
 */
export function useSheetDirty(dirty: boolean) {
  const setDirty = useContext(SheetDirtyContext);
  useEffect(() => {
    setDirty?.(dirty);
    return () => setDirty?.(false);
  }, [setDirty, dirty]);
}
