import { useEffect } from 'react';
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

/**
 * Pintasan global palet: Ctrl/⌘ K (buka/tutup) dan "/" (buka, bila tidak sedang mengetik dan
 * tidak ada dialog lain). Dipasang di AppShell, BUKAN di CommandPalette: palet dimuat lazy, jadi
 * pintasannya harus hidup sebelum modul palet ada.
 */
export function usePaletteShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const { open, show, hide } = usePalette.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) hide();
        else show();
      } else if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
