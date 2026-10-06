import { useEffect, useRef, type ReactNode } from 'react';
import { useLockStore } from './lock-store';
import { LockScreen } from './LockScreen';

/** Menampilkan layar PIN di atas aplikasi saat terkunci; memantau aplikasi ditinggalkan. */
export function LockGate({ children }: { children: ReactNode }) {
  const locked = useLockStore((s) => s.locked);
  const onHidden = useLockStore((s) => s.onHidden);
  const onVisible = useLockStore((s) => s.onVisible);

  useEffect(() => {
    const handler = () => (document.visibilityState === 'hidden' ? onHidden() : onVisible());
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [onHidden, onVisible]);

  // Ingat elemen terakhir yang difokuskan sebelum terkunci, lalu kembalikan setelah PIN benar
  // (konten jadi `inert` → tanpa ini fokus jatuh ke <body> dan pengguna keyboard mulai dari awal).
  const lastFocus = useRef<HTMLElement | null>(null);
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (locked) return;
    const onFocusIn = (e: FocusEvent) => {
      lastFocus.current = e.target as HTMLElement;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [locked]);
  useEffect(() => {
    if (wasLocked.current && !locked) {
      requestAnimationFrame(() => {
        const el = lastFocus.current;
        if (el?.isConnected) el.focus({ preventScroll: true });
      });
    }
    wasLocked.current = locked;
  }, [locked]);

  return (
    <>
      {/* Konten tetap di-mount (sync tetap jalan), tapi disembunyikan & tidak bisa diakses */}
      <div aria-hidden={locked} inert={locked} className={locked ? 'invisible' : undefined}>
        {children}
      </div>
      {locked && <LockScreen />}
    </>
  );
}
