import { desc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '@/db/database';
import { withMeta } from '@/db/mutations';
import { pwTotpLog } from '@/db/schema';
import { nowIso } from '@/lib/date';
import { encryptTotpLog, ITEM_VERSION, type TotpLogEntry } from './crypto';

/**
 * Riwayat pemakaian kode TOTP. Logika database murni (tanpa React) supaya bisa diuji dengan
 * SQLite sungguhan; hook-nya ada di `sandi-data.ts`.
 *
 * Isi baris (nama akun, angka kode, id item) dienkripsi dengan DEK brankas. Server hanya melihat
 * waktunya. Baris yang lebih tua dari retensi dibuang di perangkat ini.
 */
export const TOTP_LOG_RETENTION_DAYS = 90;

/** Batas baris yang ditampilkan sekaligus. */
export const TOTP_LOG_PAGE_SIZE = 200;

/** Hanya kolom yang dipakai, agar bisa dijalankan dengan `tx` PowerSync maupun database tes. */
export type TotpLogDb = Pick<AppDatabase, 'select' | 'insert' | 'delete'>;

export function totpLogCutoff(nowMs: number, days = TOTP_LOG_RETENTION_DAYS): string {
  return new Date(nowMs - days * 86400_000).toISOString();
}

/**
 * Catat satu pemakaian kode. Dipanggil saat kode disalin — sengaja TIDAK menyentuh `pw_items`,
 * supaya item tidak berubah `updated_at` dan urutan daftar brankas tetap.
 */
export async function recordTotpUse(
  db: TotpLogDb,
  userId: string,
  dek: CryptoKey,
  ref: string,
  entry: Omit<TotpLogEntry, 'usedAt'> & { usedAt?: string },
): Promise<string> {
  const row = withMeta(userId, { enc: '', v: ITEM_VERSION });
  // id dibuat DULU karena menjadi bagian dari AAD enkripsi
  const enc = await encryptTotpLog(
    dek,
    userId,
    row.id,
    {
      itemId: entry.itemId,
      name: entry.name,
      code: entry.code,
      usedAt: entry.usedAt ?? nowIso(),
    },
    ref,
  );
  await db.insert(pwTotpLog).values({ ...row, enc });
  return row.id;
}

/**
 * Buang baris yang lebih tua dari `cutoff` (ISO).
 *
 * `datetime()` di kedua sisi, BUKAN perbandingan teks: baris yang sudah tersinkron kembali dari
 * server berformat `'YYYY-MM-DD HH:MM:SSZ'` (spasi), tulisan lokal berformat ISO (`T`). Sebagai
 * teks, spasi < `T`, jadi baris tersinkron dari HARI cutoff dianggap lebih tua dan ikut terhapus
 * hingga ±1 hari terlalu cepat (lihat juga VERSION_ORDER di vault/config/config-data.ts).
 */
export async function purgeExpiredTotpLog(db: TotpLogDb, cutoff: string): Promise<void> {
  await db.delete(pwTotpLog).where(sql`datetime(${pwTotpLog.created_at}) < datetime(${cutoff})`);
}

/** Hapus seluruh riwayat (tombol di UI). */
export async function clearTotpLog(db: TotpLogDb): Promise<void> {
  await db.delete(pwTotpLog);
}

/** Hapus satu baris riwayat. */
export async function deleteTotpLogRow(db: TotpLogDb, id: string): Promise<void> {
  await db.delete(pwTotpLog).where(eq(pwTotpLog.id, id));
}

/** Baris terenkripsi terbaru lebih dulu (urutan waktu sungguhan, lihat purgeExpiredTotpLog). */
export async function listTotpLogRows(
  db: TotpLogDb,
  limit = TOTP_LOG_PAGE_SIZE,
): Promise<{ id: string; enc: string; created_at: string }[]> {
  return db
    .select({ id: pwTotpLog.id, enc: pwTotpLog.enc, created_at: pwTotpLog.created_at })
    .from(pwTotpLog)
    .orderBy(sql`datetime(${pwTotpLog.created_at}) DESC`, desc(pwTotpLog.id))
    .limit(limit);
}
