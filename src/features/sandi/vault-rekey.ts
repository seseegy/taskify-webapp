import { eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db/database';
import { touch } from '@/db/mutations';
import { pwItems, pwKeys, pwTotpLog } from '@/db/schema';
import { ITEM_VERSION, reencryptItems, reencryptTotpLog, type RewrittenVault } from './crypto';

/** Hanya yang dipakai, supaya bisa dijalankan dengan `tx` PowerSync maupun database tes. */
export type RekeyDb = Pick<AppDatabase, 'select' | 'update'>;

export interface RekeyResult {
  /** Item yang berhasil dienkripsi ulang. */
  reencrypted: number;
  /** Item yang tidak bisa dibuka dengan DEK lama; dibiarkan apa adanya. */
  skipped: number;
  /** Baris riwayat TOTP yang berhasil dienkripsi ulang. */
  logReencrypted: number;
  /** Baris riwayat yang tidak bisa dibuka; dibiarkan dan hilang sendiri karena retensi. */
  logSkipped: number;
}

/**
 * Isi penggantian kunci brankas. WAJIB dipanggil di dalam SATU transaksi tulis
 * (`db.transaction`), karena record kunci dan seluruh isinya harus berganti bersama.
 *
 * Semua baris `pw_items` (juga yang di Sampah) DAN `pw_totp_log` dienkripsi ulang dari DEK lama
 * ke DEK baru. Baris yang sudah tidak bisa dibuka dengan DEK lama TIDAK disentuh dan dihitung
 * di `skipped` / `logSkipped`. Urutan tulis: record kunci dulu, lalu isinya (PowerSync
 * mengunggah berurutan).
 */
export async function rekeyVaultRows(
  db: RekeyDb,
  userId: string,
  keyId: string,
  vault: RewrittenVault,
): Promise<RekeyResult> {
  const rows = await db.select({ id: pwItems.id, enc: pwItems.enc }).from(pwItems);
  const items = await reencryptItems(rows, vault.previousDek, vault.dek, userId);

  const logRows = await db.select({ id: pwTotpLog.id, enc: pwTotpLog.enc }).from(pwTotpLog);
  const log = await reencryptTotpLog(logRows, vault.previousDek, vault.dek, userId);

  await db
    .update(pwKeys)
    .set(touch({ ...vault.record }))
    .where(eq(pwKeys.id, keyId));

  for (const row of items.updated) {
    await db
      .update(pwItems)
      .set(touch({ enc: row.enc, v: ITEM_VERSION }))
      .where(eq(pwItems.id, row.id));
  }
  for (const row of log.updated) {
    await db
      .update(pwTotpLog)
      .set(touch({ enc: row.enc, v: ITEM_VERSION }))
      .where(eq(pwTotpLog.id, row.id));
  }

  return {
    reencrypted: items.updated.length,
    skipped: items.skipped.length,
    logReencrypted: log.updated.length,
    logSkipped: log.skipped.length,
  };
}
