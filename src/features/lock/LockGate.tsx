import { useEffect, type ReactNode } from 'react';
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
