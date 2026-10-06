import type { PowerSyncDatabase } from '@powersync/web';
import { saveBlob } from '@/lib/files';
import { todayLocal } from '@/lib/date';

/** Tabel tersinkron yang ikut diekspor (isi file lampiran tetap di R2, hanya metadata). */
export const EXPORT_TABLES = [
  'user_settings',
  'tags',
  'taggings',
  'entity_links',
  'task_lists',
  'tasks',
  'journal_entries',
  'wallets',
  'categories',
  'debts',
  'recurring_transactions',
  'transactions',
  'budgets',
  'snippets',
  'code_projects',
  'attachments',
] as const;

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
