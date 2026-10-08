import type { PowerSyncDatabase } from '@powersync/web';
import { saveBlob } from '@/lib/files';
import { EXPORT_TABLES } from './export-tables';
import { todayLocal } from '@/lib/date';

/**
 * Ekspor seluruh data dari SQLite lokal ke satu file JSON — jalan offline.
 * Termasuk item di Sampah (deleted_at terisi) agar cadangan lengkap.
 */
export async function exportAllData(db: PowerSyncDatabase, userId: string) {
  const tables: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of EXPORT_TABLES) {
    tables[t] = await db.getAll(`SELECT * FROM ${t}`);
    rows += tables[t].length;
  }
  const payload = {
    app: 'taskify',
    format: 1,
    version: __APP_VERSION__,
    exported_at: new Date().toISOString(),
    user_id: userId,
    note: 'Uang dalam rupiah utuh (integer). Tanggal tanpa jam = WIB. Isi file lampiran ada di Cloudflare R2.',
    tables,
  };
  saveBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `taskify-ekspor-${todayLocal()}.json`,
  );
  return rows;
}
