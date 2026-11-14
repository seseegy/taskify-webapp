import { eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db/database';
import { touch } from '@/db/mutations';
import { configVersions, pwItems, pwKeys, pwTotpLog } from '@/db/schema';
import {
  ITEM_VERSION,
  keyRef,
  reencryptConfigVersions,
  reencryptItems,
  reencryptTotpLog,
  SandiError,
  type RewrittenVault,
} from './crypto';

export { VAULT_ENCRYPTED_TABLES } from '@/db/schema';

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
 * Transaksi ini diunggah ATOMIK lewat RPC `apply_vault_rotation` (connector.ts), bukan per baris:
 *   - `rotated_from` = label kunci asal → server menolak bila kunci di server sudah berubah
 *     (dua perangkat merotasi bersamaan) — compare-and-swap.
 *   - Server menolak bila ada baris terenkripsi di server yang TIDAK ada di transaksi ini
 *     (perangkat ini belum menerima semuanya). Karena itu baris yang tidak bisa dibuka
 *     (`skipped`) tetap DISENTUH (`updated_at` saja, isi tidak berubah): server tahu baris itu
 *     sudah dipertimbangkan, bukan terlewat.
 *   - Penolakan = TIDAK ADA yang berubah di server; perangkat ini kembali ke kunci lama setelah
 *     sinkron berikutnya.
 *
 * Urutan tulis: record kunci dulu, lalu isinya.
 */
export async function rekeyVaultRows(
  db: RekeyDb,
  userId: string,
  keyId: string,
  vault: RewrittenVault,
): Promise<RekeyResult> {
  const [current] = await db
    .select({ wrapped_key: pwKeys.wrapped_key })
    .from(pwKeys)
    .where(eq(pwKeys.id, keyId));
  // Kunci lokal harus kunci yang dirotasi. Kalau tidak (sinkron membawa kunci baru dari perangkat
  // lain sementara form terbuka), DEK lama tidak membuka data saat ini → batalkan, jangan setengah.
  if (!current || current.wrapped_key !== vault.previousWrappedKey)
    throw new SandiError(
      'invalid',
      'Kunci brankas berubah saat proses berlangsung. Tidak ada yang diubah; buka brankas lagi lalu ulangi.',
    );

  const fromRef = await keyRef(vault.previousWrappedKey);
  const toRef = await keyRef(vault.record.wrapped_key);

  const rows = await db.select({ id: pwItems.id, enc: pwItems.enc }).from(pwItems);
  const items = await reencryptItems(rows, vault.previousDek, vault.dek, userId, toRef);

  const logRows = await db.select({ id: pwTotpLog.id, enc: pwTotpLog.enc }).from(pwTotpLog);
  const log = await reencryptTotpLog(logRows, vault.previousDek, vault.dek, userId, toRef);

  const configRows = await db
    .select({ id: configVersions.id, enc: configVersions.enc, file_id: configVersions.file_id })
    .from(configVersions);
  const config = await reencryptConfigVersions(
    configRows,
    vault.previousDek,
    vault.dek,
    userId,
    toRef,
  );

  await db
    .update(pwKeys)
    .set(touch({ ...vault.record, rotated_from: fromRef }))
    .where(eq(pwKeys.id, keyId));

  for (const row of items.updated) {
    await db
      .update(pwItems)
      .set(touch({ enc: row.enc, v: ITEM_VERSION }))
      .where(eq(pwItems.id, row.id));
  }
  for (const id of items.skipped) await db.update(pwItems).set(touch({})).where(eq(pwItems.id, id));

  for (const row of log.updated) {
    await db
      .update(pwTotpLog)
      .set(touch({ enc: row.enc, v: ITEM_VERSION }))
      .where(eq(pwTotpLog.id, row.id));
  }
  for (const id of log.skipped)
    await db.update(pwTotpLog).set(touch({})).where(eq(pwTotpLog.id, id));

  for (const row of config.updated) {
    await db
      .update(configVersions)
      .set(touch({ enc: row.enc, v: ITEM_VERSION }))
      .where(eq(configVersions.id, row.id));
  }
  for (const id of config.skipped)
    await db.update(configVersions).set(touch({})).where(eq(configVersions.id, id));

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
