import { useQuery } from '@powersync/react';
import { eq } from 'drizzle-orm';
import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast-store';
import { supabase } from '@/lib/supabase';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { pwItems, pwKeys, type PwItem, type PwKeys } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { newId } from '@/lib/id';
import {
  decryptItem,
  decryptTotpLog,
  encryptItem,
  ITEM_VERSION,
  type ItemPayload,
  type KeyRecord,
  type RewrittenVault,
  type TotpLogEntry,
} from './crypto';
import {
  checkRemoteKey,
  REMOTE_CHECK_TIMEOUT_MS,
  waitForKeyUpload,
  type RemoteKeyState,
} from './vault-guard';
import {
  clearTotpLog,
  deleteTotpLogRow,
  purgeExpiredTotpLog,
  recordTotpUse,
  totpLogCutoff,
  TOTP_LOG_PAGE_SIZE,
} from './totp-log';
import { currentKeyRef } from './sandi-store';
import { rekeyVaultRows, VAULT_ENCRYPTED_TABLES, type RekeyResult } from './vault-rekey';
import {
  RotationBlockedError,
  RotationRejectedError,
  rotationBlocker,
  rotationOutcome,
  VAULT_ERROR,
} from './vault-rotation';

/** `'pw_items', 'pw_totp_log', 'config_versions'` untuk klausa IN (konstanta, bukan masukan). */
const VAULT_TABLES_SQL = VAULT_ENCRYPTED_TABLES.map((t) => `'${t}'`).join(', ');

// ----------------------------------------------------------------------------- baca
/** Baris kunci brankas (maks. satu per user). */
export function usePwKey() {
  const { data, isLoading } = useQuery<PwKeys>('SELECT * FROM pw_keys ORDER BY created_at LIMIT 1');
  return { row: data[0] ?? null, isLoading };
}

/** Baris sandi TERENKRIPSI yang belum dihapus. Dekripsi dilakukan terpisah (useDecryptedItems). */
export function usePwItemRows() {
  const { data, isLoading } = useQuery<PwItem>(
    'SELECT * FROM pw_items WHERE deleted_at IS NULL ORDER BY updated_at DESC',
  );
  return { rows: data, isLoading };
}

/** Baris `upload_errors` untuk PEMBUATAN `pw_keys` (PUT): server menolak brankas dari perangkat ini. */
export function useRejectedKeyUploads() {
  const { data } = useQuery<{ id: string }>(
    "SELECT id FROM upload_errors WHERE table_name = 'pw_keys' AND op = 'PUT'",
  );
  return data;
}

/**
 * Penggantian kunci (PATCH `pw_keys`) yang ditolak server SETELAH layar ganti sandi ditutup
 * (jawaban server tiba setelah batas tunggu). Penolakan yang tiba selagi menunggu sudah
 * ditangani langsung oleh `replaceVault`. Kode error menentukan pesannya.
 */
export function useRejectedRotation(): string | null | undefined {
  const { data } = useQuery<{ error_code: string | null }>(
    `SELECT error_code FROM upload_errors WHERE table_name = 'pw_keys' AND op = 'PATCH'
      ORDER BY created_at DESC LIMIT 1`,
  );
  return data.length ? data[0]!.error_code : undefined;
}

/**
 * Tulisan brankas dari perangkat ini yang ditolak server karena dienkripsi dengan kunci yang sudah
 * diganti di perangkat lain (kode 23V03, trigger `vault_enc_guard`). Isinya hanya bisa dibuka
 * dengan kunci lama, jadi yang bisa dilakukan hanyalah memberi tahu pengguna.
 */
export function useStaleVaultWrites() {
  const { data } = useQuery<{ n: number }>(
    `SELECT COUNT(*) AS n FROM upload_errors WHERE error_code = ? AND table_name IN (${VAULT_TABLES_SQL})`,
    [VAULT_ERROR.staleKey],
  );
  return data[0]?.n ?? 0;
}

/** Tanya SERVER apakah brankas sudah ada (bukan database lokal). */
export function fetchRemoteKeyState(): Promise<RemoteKeyState> {
  return checkRemoteKey(() => supabase.from('pw_keys').select('id').limit(1));
}

/** `wrapped_key` brankas di SERVER (bukan lokal). Timeout/gagal → 'unreachable'. */
export async function fetchRemoteWrappedKey(): Promise<string | null | 'unreachable'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), REMOTE_CHECK_TIMEOUT_MS);
    });
    const res = await Promise.race([
      supabase.from('pw_keys').select('wrapped_key').limit(1),
      timeout,
    ]);
    if (res === 'timeout' || res.error || !Array.isArray(res.data)) return 'unreachable';
    return (res.data[0] as { wrapped_key?: string } | undefined)?.wrapped_key ?? null;
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export function toKeyRecord(row: PwKeys): KeyRecord {
  return {
    version: row.version,
    kdf: row.kdf as KeyRecord['kdf'],
    iterations: row.iterations,
    salt: row.salt,
    wrapped_key: row.wrapped_key,
    recovery_salt: row.recovery_salt,
    recovery_wrapped_key: row.recovery_wrapped_key,
  };
}

export interface DecryptedItem {
  id: string;
  payload: ItemPayload;
  created_at: string;
  updated_at: string;
}

interface DecryptState {
  dek: CryptoKey;
  items: DecryptedItem[];
  /** id yang gagal dibuka (dibuat dengan kunci lain / data rusak) */
  failed: string[];
}

/**
 * Mendekripsi daftar di memori. Hanya dipakai oleh komponen yang HANYA DI-MOUNT saat brankas
 * terbuka, sehingga hasil dekripsi (plaintext) ikut dibuang begitu brankas dikunci (unmount).
 * Selama dekripsi berjalan, daftar sebelumnya tetap tampil (tidak berkedip).
 */
export function useDecryptedItems(rows: PwItem[], dek: CryptoKey, userId: string) {
  const [state, setState] = useState<DecryptState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items: DecryptedItem[] = [];
      const failed: string[] = [];
      for (const r of rows) {
        try {
          const payload = await decryptItem(dek, userId, r.id, r.enc);
          items.push({ id: r.id, payload, created_at: r.created_at, updated_at: r.updated_at });
        } catch {
          failed.push(r.id);
        }
      }
      if (!cancelled) setState({ dek, items, failed });
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, dek, userId]);

  const current = state && state.dek === dek ? state : null;
  return { items: current?.items ?? [], failed: current?.failed ?? [], ready: current !== null };
}

/** Baris riwayat TOTP (terenkripsi), terbaru lebih dulu. */
export function usePwTotpLogRows() {
  const { data, isLoading } = useQuery<{ id: string; enc: string; created_at: string }>(
    `SELECT id, enc, created_at FROM pw_totp_log
      ORDER BY datetime(created_at) DESC, id DESC LIMIT ${TOTP_LOG_PAGE_SIZE}`,
  );
  return { rows: data, isLoading };
}

export interface TotpLogItem {
  id: string;
  created_at: string;
  entry: TotpLogEntry;
}

/**
 * Mendekripsi riwayat di memori. Baris yang tidak bisa dibuka (dibuat dengan kunci brankas lama
 * yang sudah dirotasi) DILEWATI tanpa pemberitahuan: isinya tidak bisa dipulihkan dan akan
 * hilang sendiri karena retensi.
 */
export function useDecryptedTotpLog(
  rows: { id: string; enc: string; created_at: string }[],
  dek: CryptoKey,
  userId: string,
) {
  const [state, setState] = useState<{ dek: CryptoKey; items: TotpLogItem[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items: TotpLogItem[] = [];
      for (const r of rows) {
        try {
          items.push({
            id: r.id,
            created_at: r.created_at,
            entry: await decryptTotpLog(dek, userId, r.id, r.enc),
          });
        } catch {
          /* dibuat dengan kunci lain: lewati */
        }
      }
      if (!cancelled) setState({ dek, items });
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, dek, userId]);

  const current = state && state.dek === dek ? state : null;
  return { entries: current?.items ?? [], ready: current !== null };
}

// ----------------------------------------------------------------------------- tulis
export function useSandiActions() {
  const { db, powerSync } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const restoreItem = async (id: string) => {
      await db
        .update(pwItems)
        .set(touch({ deleted_at: null }))
        .where(eq(pwItems.id, id));
    };

    /**
     * Masih ada operasi untuk baris ini di antrean upload? Bila antrean lebih panjang dari batch
     * yang dibaca (`haveMore`) dan operasinya belum terlihat, anggap MASIH menunggu: lebih baik
     * "belum pasti" daripada salah menganggap server sudah menerimanya.
     */
    const opPending = async (table: string, id: string) => {
      const batch = await powerSync.getCrudBatch(1000);
      if (!batch) return false;
      return batch.crud.some((op) => op.table === table && op.id === id) || batch.haveMore;
    };

    return {
      /**
       * Simpan record kunci brankas baru. Menolak bila sudah ada (mis. dibuat di perangkat lain
       * sesaat sebelumnya): dua kunci berbeda membuat item tak terbaca di salah satu perangkat.
       */
      async createKey(record: KeyRecord): Promise<string> {
        const existing = await db.select({ id: pwKeys.id }).from(pwKeys).limit(1);
        if (existing.length > 0)
          throw new Error(
            'Brankas sudah dibuat di perangkat lain. Muat ulang halaman lalu buka dengan master password-nya.',
          );
        const row = withMeta(userId, {
          ...record,
          rotated_from: null,
          labels_required_at: null,
        });
        await db.insert(pwKeys).values(row);
        return row.id;
      },

      /**
       * Tunggu server menerima record kunci `keyId` sebelum brankas dibuka. 'rejected' = server
       * menolak (brankas sudah ada di perangkat lain); catatan penolakannya dibersihkan karena
       * belum ada item yang ditulis dengan kunci itu.
       */
      async confirmKeyUploaded(keyId: string) {
        const outcome = await waitForKeyUpload({
          keyOpPending: () => opPending('pw_keys', keyId),
          keyOpRejected: async () =>
            (
              await powerSync.getAll(
                "SELECT 1 FROM upload_errors WHERE table_name = 'pw_keys' AND row_id = ? LIMIT 1",
                [keyId],
              )
            ).length > 0,
        });
        if (outcome === 'rejected')
          await powerSync.execute(
            "DELETE FROM upload_errors WHERE table_name = 'pw_keys' AND row_id = ?",
            [keyId],
          );
        return outcome;
      },

      /** Buang catatan penolakan pembuatan `pw_keys` (setelah pengguna membaca banner). */
      async dismissRejectedKeys() {
        await powerSync.execute(
          "DELETE FROM upload_errors WHERE table_name = 'pw_keys' AND op = 'PUT'",
        );
      },

      /**
       * Buang catatan rotasi kunci yang ditolak: record kunci + seluruh isi terenkripsinya. Isinya
       * hanya bisa dibuka dengan kunci yang ditolak, jadi "Coba lagi" tidak ada gunanya (dan
       * server akan menolaknya lagi).
       */
      async dismissRejectedRotation() {
        await powerSync.execute(
          `DELETE FROM upload_errors
            WHERE (table_name = 'pw_keys' AND op = 'PATCH')
               OR (table_name IN (${VAULT_TABLES_SQL}) AND error_code IN (?, ?, ?, ?))`,
          [
            VAULT_ERROR.keyChanged,
            VAULT_ERROR.incomplete,
            VAULT_ERROR.tooLarge,
            VAULT_ERROR.invalid,
          ],
        );
      },

      /** Buang catatan tulisan brankas yang ditolak karena kunci lama (banner di halaman Sandi). */
      async dismissStaleVaultWrites() {
        await powerSync.execute(
          `DELETE FROM upload_errors WHERE error_code = ? AND table_name IN (${VAULT_TABLES_SQL})`,
          [VAULT_ERROR.staleKey],
        );
      },

      /**
       * Ganti master password / kunci pemulihan. DEK ikut dibuat baru, jadi SEMUA item
       * (termasuk yang ada di Sampah) dienkripsi ulang dari DEK lama ke yang baru dalam SATU
       * transaksi lokal bersama record kuncinya. Transaksi itu diunggah ATOMIK (RPC
       * `apply_vault_rotation`, lihat connector.ts & vault-rekey.ts).
       *
       * Urutan:
       *   1. Prasyarat (`rotationBlocker`): online, sinkron selesai, antrean upload kosong, kunci di
       *      server = kunci asal. Gagal → `RotationBlockedError`, TIDAK ADA yang berubah.
       *   2. Tulis lokal (satu transaksi).
       *   3. Tunggu jawaban server. Ditolak → `RotationRejectedError` (server tidak berubah;
       *      database lokal kembali ke kunci lama setelah sinkron, jadi pemanggil WAJIB mengunci
       *      brankas). Belum terjawab dalam batas waktu → `confirmed: false`.
       *
       * Item yang sudah tidak bisa dibuka dengan DEK lama dibiarkan apa adanya (jumlahnya
       * dikembalikan di `skipped`), bukan ditimpa atau dijadikan alasan menolak ganti sandi.
       */
      async replaceVault(
        id: string,
        vault: RewrittenVault,
        { onLocalWritten }: { onLocalWritten?: () => void } = {},
      ): Promise<{ result: RekeyResult; confirmed: boolean }> {
        const status = powerSync.currentStatus;
        const blocker = await rotationBlocker(
          {
            online: typeof navigator === 'undefined' || navigator.onLine !== false,
            connected: status.connected,
            hasSynced: Boolean(status.hasSynced),
            downloading: status.downloading,
            pendingUploads: async () => (await powerSync.getUploadQueueStats()).count,
            remoteWrappedKey: fetchRemoteWrappedKey,
          },
          vault.previousWrappedKey,
        );
        if (blocker) throw new RotationBlockedError(blocker);

        // ISO, sama dengan created_at yang ditulis connector ke upload_errors
        const since = new Date().toISOString();
        const result = await db.transaction((tx) => rekeyVaultRows(tx, userId, id, vault));
        // Isi lokal sekarang terenkripsi dengan DEK baru: pemanggil memasang DEK baru SEKARANG,
        // supaya daftar tidak sesaat tampil "tidak bisa dibuka" selama menunggu server.
        onLocalWritten?.();

        const outcome = await rotationOutcome({
          pending: () => opPending('pw_keys', id),
          rejected: async () => {
            const [r] = await powerSync.getAll<{ error_code: string | null }>(
              `SELECT error_code FROM upload_errors
                WHERE table_name = 'pw_keys' AND row_id = ? AND created_at >= ? LIMIT 1`,
              [id, since],
            );
            return r ? r.error_code : undefined;
          },
        });
        if (outcome.kind === 'rejected') {
          // Seluruh transaksi rotasi tercatat ditolak. Jangan biarkan di daftar "Coba lagi":
          // rotasi ini batal, dan isinya hanya bisa dibuka dengan kunci yang ditolak.
          await powerSync.execute(
            `DELETE FROM upload_errors WHERE created_at >= ? AND table_name IN (${VAULT_TABLES_SQL}, 'pw_keys')`,
            [since],
          );
          throw new RotationRejectedError(outcome.code);
        }
        return { result, confirmed: outcome.kind === 'accepted' };
      },

      /** Buat (tanpa id) atau ubah (dengan id). Mengembalikan id. */
      async saveItem(dek: CryptoKey, payload: ItemPayload, id?: string): Promise<string> {
        const itemId = id ?? newId();
        const enc = await encryptItem(dek, userId, itemId, payload, await currentKeyRef(dek));
        if (id) {
          await db
            .update(pwItems)
            .set(touch({ enc, v: ITEM_VERSION }))
            .where(eq(pwItems.id, id));
        } else {
          // id dibuat DULU karena menjadi bagian dari AAD enkripsi
          await db
            .insert(pwItems)
            .values({ ...withMeta(userId, { enc, v: ITEM_VERSION }), id: itemId });
        }
        return itemId;
      },

      /**
       * Catat satu pemakaian kode TOTP. Sengaja TIDAK menyentuh `pw_items`, supaya menyalin kode
       * tidak mengubah `updated_at` item dan tidak mengacak urutan daftar brankas.
       */
      async recordTotpUse(dek: CryptoKey, itemId: string, name: string, code: string) {
        await recordTotpUse(db, userId, dek, await currentKeyRef(dek), { itemId, name, code });
      },

      async purgeTotpLog() {
        await purgeExpiredTotpLog(db, totpLogCutoff(Date.now()));
      },

      async deleteTotpLogRow(id: string) {
        await deleteTotpLogRow(db, id);
      },

      async clearTotpLog() {
        await clearTotpLog(db);
      },

      async removeItem(id: string, title: string) {
        await db.update(pwItems).set(softDeleted()).where(eq(pwItems.id, id));
        toast(`"${title || 'Sandi'}" dihapus`, {
          action: { label: 'Urungkan', onClick: () => restoreItem(id) },
        });
      },
    };
  }, [db, powerSync, userId]);
}
