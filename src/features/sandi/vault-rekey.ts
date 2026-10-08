import { eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db/database';
import { touch } from '@/db/mutations';
import { pwItems, pwKeys } from '@/db/schema';
import { ITEM_VERSION, reencryptItems, type RewrittenVault } from './crypto';

/** Hanya yang dipakai, supaya bisa dijalankan dengan `tx` PowerSync maupun database tes. */
export type RekeyDb = Pick<AppDatabase, 'select' | 'update'>;

/**
 * Isi penggantian kunci brankas. WAJIB dipanggil di dalam SATU transaksi tulis
 * (`db.transaction`), karena record kunci dan semua item harus berganti bersama.
 *
 * Semua baris `pw_items` (juga yang di Sampah) dienkripsi ulang dari DEK lama ke DEK baru.
 * Baris yang sudah tidak bisa dibuka dengan DEK lama TIDAK disentuh dan dihitung di `skipped`.
 * Urutan tulis: record kunci dulu, lalu item (PowerSync mengunggah berurutan).
 */
export async function rekeyVaultRows(
  db: RekeyDb,
  userId: string,
  keyId: string,
  vault: RewrittenVault,
): Promise<{ reencrypted: number; skipped: number }> {
  const rows = await db.select({ id: pwItems.id, enc: pwItems.enc }).from(pwItems);
  const { updated, skipped } = await reencryptItems(rows, vault.previousDek, vault.dek, userId);
  await db
    .update(pwKeys)
    .set(touch({ ...vault.record }))
    .where(eq(pwKeys.id, keyId));
  for (const r of updated) {
    await db
      .update(pwItems)
      .set(touch({ enc: r.enc, v: ITEM_VERSION }))
      .where(eq(pwItems.id, r.id));
  }
  return { reencrypted: updated.length, skipped: skipped.length };
}
