import { useEffect } from 'react';
import { useLockStore } from '@/features/lock/lock-store';
import { shouldLock, useSandiStore } from './sandi-store';

const CHECK_EVERY_MS = 15_000;
const ACTIVITY_THROTTLE_MS = 1_000;

/**
 * Mesin kunci otomatis brankas. Dipasang SEKALI di AppShell (bukan di halaman Sandi), supaya
 * brankas tetap terkunci meski pengguna berpindah halaman.
 *
 *  - tab disembunyikan → hitung mundur; saat kembali terlihat, kunci DULU baru tampil
 *  - tidak ada interaksi → kunci setelah batas yang dipilih
 *  - kunci PIN aplikasi aktif → brankas ikut terkunci
 */
export function useSandiAutoLock() {
  const unlocked = useSandiStore((s) => s.dek !== null);
  const appLocked = useLockStore((s) => s.locked);

  useEffect(() => {
    if (appLocked) useSandiStore.getState().lock();
  }, [appLocked]);

  useEffect(() => {
    if (!unlocked) return;
    const store = useSandiStore.getState;
    let last = 0;

    const onActivity = () => {
      const now = Date.now();
      if (now - last < ACTIVITY_THROTTLE_MS) return;
      last = now;
      store().touch();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') store().hide();
      else store().show();
    };
    const check = () => {
      const s = store();
      if (s.dek && shouldLock({ ...s, now: Date.now() })) s.lock();
    };

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(check, CHECK_EVERY_MS);
    // Tab sudah tersembunyi saat brankas dibuka (mis. dibuka lalu langsung pindah)
    if (document.visibilityState === 'hidden') store().hide();

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
    };
  }, [unlocked]);
}
