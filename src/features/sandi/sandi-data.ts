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
import { checkRemoteKey, waitForKeyUpload, type RemoteKeyState } from './vault-guard';
import {
  clearTotpLog,
  deleteTotpLogRow,
  purgeExpiredTotpLog,
  recordTotpUse,
  totpLogCutoff,
  TOTP_LOG_PAGE_SIZE,
} from './totp-log';
import { rekeyVaultRows, type RekeyResult } from './vault-rekey';

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

/** Baris `upload_errors` untuk `pw_keys`: server menolak record kunci dari perangkat ini. */
export function useRejectedKeyUploads() {
  const { data } = useQuery<{ id: string }>(
    "SELECT id FROM upload_errors WHERE table_name = 'pw_keys'",
  );
  return data;
}

/** Tanya SERVER apakah brankas sudah ada (bukan database lokal). */
export function fetchRemoteKeyState(): Promise<RemoteKeyState> {
  return checkRemoteKey(() => supabase.from('pw_keys').select('id').limit(1));
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
    `SELECT id, enc, created_at FROM pw_totp_log ORDER BY created_at DESC LIMIT ${TOTP_LOG_PAGE_SIZE}`,
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
        const row = withMeta(userId, { ...record });
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
          keyOpPending: async () => {
            const batch = await powerSync.getCrudBatch(1000);
            return Boolean(batch?.crud.some((op) => op.table === 'pw_keys' && op.id === keyId));
          },
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

      /** Buang catatan penolakan `pw_keys` (setelah pengguna membaca banner). */
      async dismissRejectedKeys() {
        await powerSync.execute("DELETE FROM upload_errors WHERE table_name = 'pw_keys'");
      },

      /**
       * Ganti master password / kunci pemulihan. DEK ikut dibuat baru, jadi SEMUA item
       * (termasuk yang ada di Sampah) dienkripsi ulang dari DEK lama ke yang baru dalam SATU
       * transaksi lokal bersama record kuncinya: tidak pernah ada keadaan setengah jadi di
       * perangkat ini, dan PowerSync mengunggahnya berurutan (kunci dulu, lalu item).
       *
       * Item yang sudah tidak bisa dibuka dengan DEK lama dibiarkan apa adanya (jumlahnya
       * dikembalikan di `skipped`), bukan ditimpa atau dijadikan alasan menolak ganti sandi.
       */
      async replaceVault(id: string, vault: RewrittenVault): Promise<RekeyResult> {
        return db.transaction((tx) => rekeyVaultRows(tx, userId, id, vault));
      },

      /** Buat (tanpa id) atau ubah (dengan id). Mengembalikan id. */
      async saveItem(dek: CryptoKey, payload: ItemPayload, id?: string): Promise<string> {
        const itemId = id ?? newId();
        const enc = await encryptItem(dek, userId, itemId, payload);
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
        await recordTotpUse(db, userId, dek, { itemId, name, code });
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
