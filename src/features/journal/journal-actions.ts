import { and, eq, isNotNull } from 'drizzle-orm';
import { useMemo } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { journalEntries } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import type { LocalDate } from '@/lib/date';

export interface JournalPatch {
  entry_date?: LocalDate;
  title?: string | null;
  content?: string;
  mood?: number | null;
  is_pinned?: number;
}

export function useJournalActions() {
  const { db } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const restore = async (id: string) => {
      await db
        .update(journalEntries)
        .set(touch({ deleted_at: null }))
        .where(eq(journalEntries.id, id));
    };
    return {
      async create(values: JournalPatch & { entry_date: LocalDate }) {
        const row = withMeta(userId, {
          entry_date: values.entry_date,
          title: values.title?.trim() || null,
          content: values.content ?? '',
          mood: values.mood ?? null,
          is_pinned: values.is_pinned ?? 0,
        });
        await db.insert(journalEntries).values(row);
        return row.id;
      },
      async update(id: string, patch: JournalPatch) {
        const values = { ...patch };
        if ('title' in values) values.title = values.title?.trim() || null;
        await db.update(journalEntries).set(touch(values)).where(eq(journalEntries.id, id));
      },
      async remove(id: string) {
        await db.update(journalEntries).set(softDeleted()).where(eq(journalEntries.id, id));
        toast('Catatan dipindahkan ke Sampah', {
          action: { label: 'Urungkan', onClick: () => restore(id) },
        });
      },
      restore,
      async destroy(id: string) {
        await db.delete(journalEntries).where(eq(journalEntries.id, id));
      },
      async emptyTrash() {
        await db.delete(journalEntries).where(and(isNotNull(journalEntries.deleted_at)));
      },
    };
  }, [db, userId]);
}
