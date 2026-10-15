import { eq, isNotNull } from 'drizzle-orm';
import { useMemo } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { notes } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { destroyEntities } from '@/features/trash/trash-actions';
import type { LocalDate } from '@/lib/date';
import { clip, LIMITS } from '@/lib/limits';

export interface NotePatch {
  /** null = catatan bebas (lepas dari tanggal) */
  note_date?: LocalDate | null;
  title?: string | null;
  content?: string;
  is_pinned?: number;
}

const cleanTitle = (title: string | null | undefined) =>
  title?.trim() ? clip(title.trim(), LIMITS.noteTitle) : null;

export function useNoteActions() {
  const { db } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const restore = async (id: string) => {
      await db
        .update(notes)
        .set(touch({ deleted_at: null }))
        .where(eq(notes.id, id));
    };
    return {
      async create(values: NotePatch = {}) {
        const row = withMeta(userId, {
          note_date: values.note_date ?? null,
          title: cleanTitle(values.title),
          content: values.content ?? '',
          is_pinned: values.is_pinned ?? 0,
        });
        await db.insert(notes).values(row);
        return row.id;
      },
      async update(id: string, patch: NotePatch) {
        const values = { ...patch };
        if ('title' in values) values.title = cleanTitle(values.title);
        await db.update(notes).set(touch(values)).where(eq(notes.id, id));
      },
      async remove(id: string) {
        await db.update(notes).set(softDeleted()).where(eq(notes.id, id));
        toast('Catatan dipindahkan ke Sampah', {
          action: { label: 'Urungkan', onClick: () => restore(id) },
        });
      },
      restore,
      destroy: (id: string) => destroyEntities(db, 'note', [id]),
      async emptyTrash() {
        const rows = await db
          .select({ id: notes.id })
          .from(notes)
          .where(isNotNull(notes.deleted_at));
        await destroyEntities(
          db,
          'note',
          rows.map((r) => r.id),
        );
      },
    };
  }, [db, userId]);
}
