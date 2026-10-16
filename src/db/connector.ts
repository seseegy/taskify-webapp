import {
  UpdateType,
  type CommonPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from '@powersync/web';
import { env } from '@/lib/env';
import { newId } from '@/lib/id';
import { supabase } from '@/lib/supabase';
import { ROW_MISSING_CODE, UploadFailureTracker, type PostgrestLikeError } from './upload-policy';

/**
 * Jembatan PowerSync ↔ Supabase.
 *
 * - fetchCredentials: memberi JWT sesi Supabase ke PowerSync (dipakai untuk auth.user_id()).
 * - uploadData: mengirim antrean perubahan lokal ke Supabase (Postgres) via supabase-js.
 *
 * Antrean diproses per transaksi lokal & berurutan. PUT berurutan pada tabel yang sama
 * digabung menjadi satu upsert massal agar hemat request.
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
    // null = belum login → PowerSync tidak mencoba sync (tidak dianggap error)
    if (!session) return null;

    return {
      endpoint: env.powersyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    };
  }

  async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    const ops = transaction.crud;
    let index = 0;

    try {
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
      if (this.failures.verdict(key, error) === 'retry') {
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

async function applyBatch(batch: CrudEntry[]): Promise<PostgrestLikeError | null> {
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

export const connector = new SupabaseConnector();
