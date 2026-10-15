import { useQuery } from '@powersync/react';
import { eq } from 'drizzle-orm';
import { useEffect, useMemo } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { touch } from '@/db/mutations';
import { userSettings } from '@/db/schema';
import { cleanDisplayName, writeLoginName } from './display-name';

interface SettingsRow {
  id: string;
  display_name: string | null;
}

/**
 * Nama tampilan dari `user_settings` (baris dibuat otomatis oleh trigger saat akun didaftarkan;
 * klien hanya boleh mengubahnya, bukan membuat/menghapus — lihat migrasi RLS).
 *
 * `ready` = query pengaturan SUDAH SELESAI (baris ada atau tidak). Penting untuk efek ketik:
 * sebelum `ready`, nama belum diketahui sehingga sapaan belum boleh mulai diketik (kalau tidak,
 * ", Budi" menempel belakangan dan terlihat seperti kedipan). Sengaja TIDAK mensyaratkan barisnya
 * ada: bila belum tiba dari sync (login pertama, offline), sapaan harus tetap tampil tanpa nama,
 * bukan tak terlihat selamanya.
 *
 * Efek samping: menyalin nama ke penyimpanan perangkat untuk layar masuk (mengikuti saklar
 * di Pengaturan; lihat display-name.ts).
 */
export function useDisplayName() {
  const { db } = useDatabase();
  const { data, isLoading } = useQuery<SettingsRow>(
    'SELECT id, display_name FROM user_settings LIMIT 1',
  );
  const row = data[0];
  const name = cleanDisplayName(row?.display_name);
  const ready = !isLoading;

  // Jaga salinan layar masuk tetap sama dengan database (termasuk edit dari perangkat lain).
  useEffect(() => {
    if (ready) writeLoginName(name);
  }, [ready, name]);

  const save = useMemo(
    () => async (next: string) => {
      if (!row) {
        // Baris belum tiba dari sync (mis. login pertama, masih offline): jangan diam-diam gagal.
        toast('Pengaturan belum siap. Tunggu sinkronisasi selesai, lalu coba lagi.', {
          tone: 'danger',
        });
        return false;
      }
      const clean = cleanDisplayName(next);
      await db
        .update(userSettings)
        .set(touch({ display_name: clean || null }))
        .where(eq(userSettings.id, row.id));
      writeLoginName(clean);
      return true;
    },
    [db, row],
  );

  return { name, ready, save };
}
