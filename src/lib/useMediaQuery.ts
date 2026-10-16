import { useSyncExternalStore } from 'react';

/** true selama media query cocok; ikut berubah saat ukuran layar berubah. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Breakpoint `lg` Tailwind (64rem): daftar & editor tampil berdampingan. */
export const useIsDesktop = () => useMediaQuery('(min-width: 64rem)');
