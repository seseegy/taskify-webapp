import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useMatches } from 'react-router';

/** Metadata rute: `handle: { title: 'Kalender' }` di router.tsx. */
export interface RouteHandle {
  title?: string;
}

const APP_NAME = 'Taskify';

/**
 * Aksesibilitas pergantian halaman di SPA:
 *  1. `document.title` mengikuti rute → pembaca layar & riwayat tab tahu halaman mana yang terbuka.
 *  2. Setelah pindah halaman (path berubah, bukan sekadar query), fokus dipindah ke <main> agar
 *     pengguna keyboard/pembaca layar tidak tertinggal di tautan navigasi. Dilewati saat dialog
 *     modal terbuka (jangan merebut fokus dari dialog) dan pada pemuatan pertama.
 */
export function useRouteA11y(mainRef: RefObject<HTMLElement | null>) {
  const matches = useMatches();
  const { pathname } = useLocation();

  const title = [...matches]
    .reverse()
    .map((m) => (m.handle as RouteHandle | undefined)?.title)
    .find(Boolean);

  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [pathname, mainRef]);
}
