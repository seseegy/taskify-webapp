import { eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db/database';
import { touch } from '@/db/mutations';
import { configVersions, pwItems, pwKeys, pwTotpLog } from '@/db/schema';
import {
  ITEM_VERSION,
  reencryptConfigVersions,
  reencryptItems,
  reencryptTotpLog,
  type RewrittenVault,
} from './crypto';

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
  /** Versi konfigurasi (Vault) yang berhasil dienkripsi ulang. */
  configReencrypted: number;
  /** Versi konfigurasi yang tidak bisa dibuka; dibiarkan apa adanya. */
  configSkipped: number;
}

/**
 * Isi penggantian kunci brankas. WAJIB dipanggil di dalam SATU transaksi tulis
 * (`db.transaction`), karena record kunci dan seluruh isinya harus berganti bersama.
 *
 * Yang dienkripsi ulang dari DEK lama ke DEK baru:
 *   - `pw_items`     semua baris, TERMASUK yang ada di Sampah
 *   - `pw_totp_log`  riwayat kode
 *   - `config_versions`  semua versi berkas konfigurasi Vault
 *
 * Setiap jenis data baru yang dienkripsi dengan DEK brankas HARUS ditambahkan di sini. Kalau
 * terlewat, mengganti master password membuat data itu tidak bisa dibuka selamanya — kunci lama
 * sudah ditimpa dan hanya ada di backup.
 *
 * Baris yang sudah tidak bisa dibuka dengan DEK lama TIDAK disentuh dan dihitung di `skipped` /
 * `logSkipped` / `configSkipped`. Urutan tulis: record kunci dulu, lalu isinya (PowerSync
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

  const configRows = await db
    .select({ id: configVersions.id, enc: configVersions.enc, file_id: configVersions.file_id })
    .from(configVersions);
  const config = await reencryptConfigVersions(configRows, vault.previousDek, vault.dek, userId);

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
  for (const row of config.updated) {
    await db
      .update(configVersions)
      .set(touch({ enc: row.enc, v: ITEM_VERSION }))
      .where(eq(configVersions.id, row.id));
  }

  return {
    reencrypted: items.updated.length,
    skipped: items.skipped.length,
    logReencrypted: log.updated.length,
    logSkipped: log.skipped.length,
    configReencrypted: config.updated.length,
    configSkipped: config.skipped.length,
  };
}

/**
 * Pesan untuk pengguna tentang baris yang TIDAK bisa dibuka dengan kunci lama, jadi dibiarkan apa
 * adanya. `null` bila semuanya berhasil. Dipakai bersama oleh semua jalur penggantian kunci,
 * supaya tidak ada jenis data yang gagal diam-diam.
 */
export function skippedMessage(r: RekeyResult): string | null {
  const parts: string[] = [];
  if (r.skipped > 0) parts.push(`${r.skipped} sandi`);
  if (r.configSkipped > 0) parts.push(`${r.configSkipped} versi konfigurasi`);
  if (parts.length === 0) return null;
  return `${parts.join(' dan ')} lama tidak bisa dibuka dan dibiarkan apa adanya.`;
}
