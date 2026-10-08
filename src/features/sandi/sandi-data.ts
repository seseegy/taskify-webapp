import { useQuery } from '@powersync/react';
import { eq } from 'drizzle-orm';
import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { pwItems, pwKeys, type PwItem, type PwKeys } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { newId } from '@/lib/id';
import { decryptItem, encryptItem, ITEM_VERSION, type ItemPayload, type KeyRecord } from './crypto';

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

// ----------------------------------------------------------------------------- tulis
export function useSandiActions() {
  const { db } = useDatabase();
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
      async createKey(record: KeyRecord) {
        const existing = await db.select({ id: pwKeys.id }).from(pwKeys).limit(1);
        if (existing.length > 0)
          throw new Error(
            'Brankas sudah dibuat di perangkat lain. Muat ulang halaman lalu buka dengan master password-nya.',
          );
        await db.insert(pwKeys).values(withMeta(userId, { ...record }));
      },

      /** Ganti record kunci (ganti master password / kunci pemulihan). Item tidak berubah. */
      async replaceKey(id: string, record: KeyRecord) {
        await db
          .update(pwKeys)
          .set(touch({ ...record }))
          .where(eq(pwKeys.id, id));
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

      async removeItem(id: string, title: string) {
        await db.update(pwItems).set(softDeleted()).where(eq(pwItems.id, id));
        toast(`"${title || 'Sandi'}" dihapus`, {
          action: { label: 'Urungkan', onClick: () => restoreItem(id) },
        });
      },
    };
  }, [db, userId]);
}
