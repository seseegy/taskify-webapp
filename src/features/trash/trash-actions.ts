/**
 * Sampah lintas modul: pulihkan, hapus permanen, dan pembersihan otomatis.
 * Hapus permanen juga membersihkan tag & tautan (deleteEntityRefs).
 */
import { useStatus } from '@powersync/react';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { useEffect, useMemo } from 'react';
import { useDatabase } from '@/db/database-context';
import type { AppDatabase } from '@/db/database';
import { touch } from '@/db/mutations';
import { deleteEntityRefs } from '@/db/refs';
import {
  budgets,
  codeProjects,
  debts,
  journalEntries,
  recurringTransactions,
  snippets,
  tags,
  taskLists,
  tasks,
  transactions,
} from '@/db/schema';

export type TrashType = 'task' | 'journal_entry' | 'transaction' | 'snippet' | 'code_project';
export const TRASH_RETENTION_DAYS = 30;

/** Hapus permanen (+ subtask untuk tugas, + tag & tautan). */
export async function destroyEntities(db: AppDatabase, type: TrashType, ids: string[]) {
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    const t = tx as unknown as AppDatabase;
    if (type === 'task') {
      const subs = await t
        .select({ id: tasks.id })
        .from(tasks)
        .where(inArray(tasks.parent_id, ids));
      const all = [...ids, ...subs.map((s) => s.id)];
      await deleteEntityRefs(t, 'task', all);
      await t.delete(tasks).where(inArray(tasks.id, all));
    } else if (type === 'journal_entry') {
      await deleteEntityRefs(t, 'journal_entry', ids);
      await t.delete(journalEntries).where(inArray(journalEntries.id, ids));
    } else if (type === 'transaction') {
      await deleteEntityRefs(t, 'transaction', ids);
      await t.delete(transactions).where(inArray(transactions.id, ids));
    } else if (type === 'snippet') {
      await deleteEntityRefs(t, 'snippet', ids);
      await t.delete(snippets).where(inArray(snippets.id, ids));
    } else {
      // Arsip zip di R2 dibersihkan cron server karena entitas induknya hilang
      await deleteEntityRefs(t, 'code_project', ids);
      await t.delete(codeProjects).where(inArray(codeProjects.id, ids));
    }
  });
}

export function useTrashActions() {
  const { db } = useDatabase();
  return useMemo(
    () => ({
      async restore(type: TrashType, id: string) {
        const values = touch({ deleted_at: null });
        if (type === 'task') {
          await db.transaction(async (tx) => {
            await tx.update(tasks).set(values).where(eq(tasks.id, id));
            await tx
              .update(tasks)
              .set(values)
              .where(and(eq(tasks.parent_id, id), isNotNull(tasks.deleted_at)));
          });
        } else if (type === 'journal_entry') {
          await db.update(journalEntries).set(values).where(eq(journalEntries.id, id));
        } else if (type === 'transaction') {
          await db.update(transactions).set(values).where(eq(transactions.id, id));
        } else if (type === 'snippet') {
          await db.update(snippets).set(values).where(eq(snippets.id, id));
        } else {
          await db.update(codeProjects).set(values).where(eq(codeProjects.id, id));
        }
      },
      destroy: (type: TrashType, ids: string[]) => destroyEntities(db, type, ids),
    }),
    [db],
  );
}

/**
 * Hapus keras baris pendukung yang sudah di-soft-delete > 30 hari. Tidak tampil di Sampah
 * (pengguna tidak bisa memulihkannya dari UI), jadi tanpa ini menumpuk selamanya.
 *
 * Hanya tabel yang AMAN: tidak ada tabel lain yang mengacu padanya dengan RESTRICT/CASCADE yang
 * bisa menolak sync atau menghapus data hidup. Dompet (transactions.wallet_id RESTRICT) dan
 * kategori (budgets.category_id CASCADE) sengaja tidak termasuk.
 *   task_lists / debts / recurring_transactions → referensi masuk ber-ON DELETE SET NULL
 *   tags → taggings ikut terhapus (CASCADE) dan sudah dibersihkan saat tag dihapus
 *   budgets → tidak ada yang mengacu
 */
export async function purgeExpiredSupportRows(db: AppDatabase, cutoff: string) {
  await db
    .delete(budgets)
    .where(and(isNotNull(budgets.deleted_at), lt(budgets.deleted_at, cutoff)));
  await db.delete(debts).where(and(isNotNull(debts.deleted_at), lt(debts.deleted_at, cutoff)));
  await db
    .delete(recurringTransactions)
    .where(
      and(
        isNotNull(recurringTransactions.deleted_at),
        lt(recurringTransactions.deleted_at, cutoff),
      ),
    );
  await db
    .delete(taskLists)
    .where(and(isNotNull(taskLists.deleted_at), lt(taskLists.deleted_at, cutoff)));
  await db.delete(tags).where(and(isNotNull(tags.deleted_at), lt(tags.deleted_at, cutoff)));
}

/** Hapus permanen isi Sampah yang lebih tua dari 30 hari (sekali per sesi, setelah sync awal). */
export function useTrashPurge() {
  const { db } = useDatabase();
  const hasSynced = useStatus().hasSynced;

  useEffect(() => {
    if (!hasSynced) return;
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400_000).toISOString();
    void (async () => {
      try {
        const tables = [
          ['task', tasks],
          ['journal_entry', journalEntries],
          ['transaction', transactions],
          ['snippet', snippets],
          ['code_project', codeProjects],
        ] as const;
        for (const [type, table] of tables) {
          const rows = await db
            .select({ id: table.id })
            .from(table as typeof tasks)
            .where(and(isNotNull(table.deleted_at), lt(table.deleted_at, cutoff)));
          await destroyEntities(
            db,
            type,
            rows.map((r) => r.id),
          );
        }
        await purgeExpiredSupportRows(db, cutoff);
      } catch (e) {
        console.error('[trash] pembersihan otomatis gagal', e);
      }
    })();
  }, [db, hasSynced]);
}
