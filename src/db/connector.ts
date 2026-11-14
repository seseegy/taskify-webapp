import {
  UpdateType,
  type CommonPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from '@powersync/web';
import type { Session } from '@supabase/supabase-js';
import { mfaStatus } from '@/features/auth/mfa';
import { env } from '@/lib/env';
import { sha256Hex16 } from '@/lib/hash';
import { newId } from '@/lib/id';
import { supabase } from '@/lib/supabase';
import { VAULT_ENCRYPTED_TABLES } from './schema';
import { ROW_MISSING_CODE, UploadFailureTracker, type PostgrestLikeError } from './upload-policy';

/**
 * Jembatan PowerSync ↔ Supabase.
 *
 * - fetchCredentials: memberi JWT sesi Supabase ke PowerSync (dipakai untuk auth.user_id()).
 * - uploadData: mengirim antrean perubahan lokal ke Supabase (Postgres) via supabase-js.
 *
 * Antrean diproses per transaksi lokal & berurutan. PUT berurutan pada tabel yang sama
 * digabung menjadi satu upsert massal agar hemat request.
 *
 * Hanya sesi aal2 (verifikasi dua langkah) yang boleh sync. Sesi bisa saja turun ke aal1 saat
 * aplikasi masih terbuka (mis. login ulang dengan password di tab lain berbagi penyimpanan sesi):
 *   - sync dengan token aal1 mengembalikan data KOSONG (Sync Streams mensyaratkan aal2) dan
 *     bisa mengosongkan salinan lokal → `fetchCredentials` mengembalikan null;
 *   - unggah dengan token aal1 DITOLAK RLS (42501) — itu bukan kesalahan data, jadi tidak boleh
 *     dipindah ke `upload_errors` → unggah ditunda (dicoba lagi) sampai sesi aal2 kembali.
 */
export class SupabaseConnector implements PowerSyncBackendConnector {
  /** Kapan error skema (PGRST1xx/2xx) dianggap permanen — lihat upload-policy.ts */
  private readonly failures = new UploadFailureTracker();

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) throw error;
    // null = belum login / belum aal2 → PowerSync tidak mencoba sync (tidak dianggap error)
    if (!isAal2(session)) return null;

    return {
      endpoint: env.powersyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    };
  }

  async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    // Dilempar = PowerSync mencoba lagi nanti; antrean tetap utuh.
    if (!(await currentSessionIsAal2()))
      throw new Error('Sesi belum terverifikasi dua langkah; unggahan ditunda.');

    const ops = transaction.crud;
    let index = 0;

    try {
      if (isVaultRotation(ops)) {
        // Satu permintaan, satu transaksi Postgres: diterima semua atau ditolak semua.
        const error = await applyVaultRotation(ops);
        if (error) throw error;
        index = ops.length;
      }
      while (index < ops.length) {
        const batch = takeBatch(ops, index);
        const error = await applyBatch(batch);
        if (error) throw error;
        index += batch.length;
      }
      await transaction.complete();
      this.failures.reset();
    } catch (ex) {
      const error = ex as PostgrestLikeError;
      const key = String(transaction.transactionId ?? ops[0]?.clientId ?? '');
      // Sesi turun ke aal1 di tengah unggahan → penolakan RLS bukan salah data: tunda saja.
      if (this.failures.verdict(key, error) === 'retry' || !(await currentSessionIsAal2())) {
        // Error sementara (jaringan, 5xx, atau error skema yang masih dalam masa tenggang)
        // → lempar; PowerSync akan mencoba lagi dengan backoff.
        throw ex;
      }

      // Error permanen: simpan sisa operasi ke tabel lokal `upload_errors` agar tidak hilang,
      // lalu selesaikan transaksi supaya antrean tidak macet selamanya.
      console.error('[sync] Perubahan ditolak server, disimpan ke upload_errors:', error);
      const failed = ops.slice(index);
      await database.writeTransaction(async (tx) => {
        for (const op of failed) {
          await tx.execute(
            `INSERT INTO upload_errors
               (id, op, table_name, row_id, payload, error_code, error_message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newId(),
              op.op,
              op.table,
              op.id,
              JSON.stringify(op.opData ?? null),
              error.code ?? null,
              error.message ?? null,
              new Date().toISOString(),
            ],
          );
        }
      });
      await transaction.complete();
    }
  }
}

function isAal2(session: Session | null): session is Session {
  return session !== null && mfaStatus(session) === 'ok';
}

async function currentSessionIsAal2(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return isAal2(session);
}

/** Ambil operasi berurutan yang bisa digabung: PUT beruntun pada tabel yang sama. */
function takeBatch(ops: CrudEntry[], start: number): CrudEntry[] {
  const first = ops[start]!;
  if (first.op !== UpdateType.PUT) return [first];

  const batch = [first];
  for (let i = start + 1; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.op !== UpdateType.PUT || op.table !== first.table) break;
    batch.push(op);
  }
  return batch;
}

/** Satu operasi CRUD, bentuk minimal yang dibutuhkan applyBatch. */
export type CrudOp = Pick<CrudEntry, 'op' | 'table' | 'id' | 'opData'> &
  Partial<Pick<CrudEntry, 'previousValues'>>;

/**
 * Terapkan satu operasi langsung ke Supabase (tanpa antrean PowerSync) dengan aturan yang sama
 * seperti upload biasa. Dipakai "Coba lagi" di daftar perubahan yang ditolak (upload_errors).
 */
export const applyOp = (op: CrudOp) => applyBatch([op]);

async function applyBatch(batch: CrudOp[]): Promise<PostgrestLikeError | null> {
  const first = batch[0]!;
  const table = supabase.from(first.table);

  switch (first.op) {
    case UpdateType.PUT: {
      const rows = batch.map((op) => ({ ...op.opData, id: op.id }));
      // defaultToNull: false → kolom yang tidak dikirim memakai DEFAULT Postgres, bukan NULL
      const { error } = await table.upsert(rows, { defaultToNull: false });
      return error;
    }
    case UpdateType.PATCH: {
      // `.select('id')`: tanpa ini, UPDATE yang tidak mengenai baris mana pun (baris tidak ada di
      // server — mis. INSERT-nya dulu ditolak ke upload_errors, atau sudah dihapus permanen dari
      // perangkat lain) dianggap SUKSES dan perubahannya hilang tanpa jejak.
      const { data, error } = await table
        .update(first.opData ?? {})
        .eq('id', first.id)
        .select('id');
      if (error) return error;
      if (!data || data.length === 0) {
        return {
          code: ROW_MISSING_CODE,
          message: `Baris ${first.table}/${first.id} tidak ada di server`,
        };
      }
      return null;
    }
    case UpdateType.DELETE: {
      const { error } = await table.delete().eq('id', first.id);
      return error;
    }
    default:
      return null;
  }
}

// ----------------------------------------------------------------------------- rotasi brankas
const VAULT_TABLES: ReadonlySet<string> = new Set(VAULT_ENCRYPTED_TABLES);

/**
 * Transaksi penggantian kunci brankas Sandi (src/features/sandi/vault-rekey.ts): PATCH `pw_keys`
 * yang mengubah `wrapped_key`. Server HANYA menerima perubahan kunci lewat RPC atomik
 * `apply_vault_rotation`; PATCH biasa dinetralkan trigger `pw_keys_guard` (kunci tidak berubah).
 */
export function isVaultRotation(ops: readonly CrudOp[]): boolean {
  return ops.some(
    (op) =>
      op.table === 'pw_keys' &&
      op.op === UpdateType.PATCH &&
      op.opData != null &&
      'wrapped_key' in op.opData,
  );
}

/** Kode klien: permintaan rotasi melebihi batas ukuran gateway (HTTP 413). Kelas 23 = permanen. */
export const VAULT_ROTATION_TOO_LARGE = '23V04';
/** Kode klien/server: bentuk transaksi rotasi tidak valid. */
export const VAULT_ROTATION_INVALID = '23V05';

/**
 * Bentuk argumen RPC — diekspor untuk tes. Tiap baris membawa `b` = sidik (`sha256Hex16`) `enc`
 * SEBELUM rotasi (dari `previousValues`, lihat `trackPrevious` di schema.ts), supaya server
 * menolak rotasi bila baris itu diubah perangkat lain sejak perangkat ini mengenkripsi ulang.
 */
export async function rotationPayload(ops: readonly CrudOp[]) {
  const keyOps = ops.filter((op) => op.table === 'pw_keys');
  const others = ops.filter((op) => op.table !== 'pw_keys');
  // Hanya: satu PATCH pw_keys + PATCH baris terenkripsi. Apa pun selain itu bukan dari
  // rekeyVaultRows → tolak utuh (tidak ada yang terkirim) daripada mengirim sebagian.
  if (
    keyOps.length !== 1 ||
    keyOps[0]!.op !== UpdateType.PATCH ||
    others.some((op) => op.op !== UpdateType.PATCH || !VAULT_TABLES.has(op.table))
  )
    return null;
  const key = keyOps[0]!;
  const p_rows = [];
  for (const op of others) {
    const before = op.previousValues?.enc;
    p_rows.push({
      t: op.table,
      id: op.id,
      enc: (op.opData?.enc as string | undefined) ?? null,
      v: (op.opData?.v as number | undefined) ?? null,
      // Tanpa nilai lama (tidak seharusnya terjadi) → null → server menolak utuh (23V05)
      b: typeof before === 'string' ? await sha256Hex16(before) : null,
    });
  }
  return { p_key: { ...key.opData, id: key.id }, p_rows };
}

async function applyVaultRotation(ops: readonly CrudOp[]): Promise<PostgrestLikeError | null> {
  const payload = await rotationPayload(ops);
  if (!payload)
    return { code: VAULT_ROTATION_INVALID, message: 'Transaksi rotasi kunci brankas tidak valid' };
  const { data, error, status } = await supabase.rpc('apply_vault_rotation', payload);
  if (status === 413)
    return {
      code: VAULT_ROTATION_TOO_LARGE,
      message: 'Rotasi kunci brankas terlalu besar untuk satu permintaan',
    };
  if (error) return error;
  // Rotasi format lama ditolak sebagai HASIL (server perlu meng-commit catatannya), bukan error
  const result = data as { code?: string; message?: string } | null;
  if (result?.code) return { code: result.code, message: result.message };
  return null;
}

export const connector = new SupabaseConnector();
