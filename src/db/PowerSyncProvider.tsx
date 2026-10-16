import { PowerSyncContext } from '@powersync/react';
import { useEffect, useState, type ReactNode } from 'react';
import { SplashScreen } from '@/components/layout/SplashScreen';
import { useUser } from '@/features/auth/auth-context';
import { clearDeviceData } from '@/features/settings/clear-device-data';
import { connector } from './connector';
import { openDatabase, type DatabaseHandle } from './database';
import { DatabaseContext } from './database-context';
import { mustWipeFor, readDbOwner, wipeLocalDatabase, writeDbOwner } from './local-reset';

/**
 * Membuka DB lokal lalu menghubungkan sync ke PowerSync Service.
 * Dipasang HANYA setelah user login (fetchCredentials butuh sesi Supabase).
 * Saat offline, connect() tetap aman — PowerSync akan mencoba ulang otomatis.
 *
 * Bila database lokal milik akun LAIN (sesi sebelumnya berakhir tanpa tombol Keluar), isinya
 * dikosongkan dulu sebelum ditampilkan / disinkron (lihat local-reset.ts).
 */
export function PowerSyncProvider({ children }: { children: ReactNode }) {
  const [handle, setHandle] = useState<DatabaseHandle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const userId = useUser().id;

  useEffect(() => {
    let cancelled = false;
    openDatabase()
      .then(async (h) => {
        if (cancelled) return;
        if (mustWipeFor(readDbOwner(), userId)) {
          await wipeLocalDatabase(h.powerSync);
          await clearDeviceData();
        }
        writeDbOwner(userId);
        if (cancelled) return;
        setHandle(h);
        await h.powerSync.connect(connector, { crudUploadThrottleMs: 1000 });
        // Minta browser agar tidak menghapus data offline saat penyimpanan menipis
        void navigator.storage?.persist?.();
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
    // userId sengaja tidak memicu ulang: App memasang provider dengan key = user, jadi akun lain
    // selalu berarti mount baru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <SplashScreen
        title="Database lokal gagal dibuka"
        message={error.message}
        action={{ label: 'Muat ulang', onClick: () => location.reload() }}
      />
    );
  }

  if (!handle) return <SplashScreen message="Menyiapkan database lokal…" />;

  return (
    <DatabaseContext.Provider value={handle}>
      <PowerSyncContext.Provider value={handle.powerSync}>{children}</PowerSyncContext.Provider>
    </DatabaseContext.Provider>
  );
}
