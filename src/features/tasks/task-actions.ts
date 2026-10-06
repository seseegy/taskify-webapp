/**
 * Semua operasi tulis modul Tugas. Menulis ke SQLite lokal → otomatis masuk antrean sync.
 * Operasi multi-baris dibungkus transaksi agar konsisten (dan ter-upload sebagai satu unit).
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { useMemo } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { taskLists, tasks, type Task, type TaskStatus } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { destroyEntities } from '@/features/trash/trash-actions';
import {
  diffLocalDays,
  nowIso,
  relativeDayLabel,
  todayLocal,
  toDbTime,
  type LocalDate,
} from '@/lib/date';
import { nextDueAfterCompletion } from './recurrence';
import { shiftRemindAt } from './reminder';

export interface NewTaskInput {
  title: string;
  list_id?: string | null;
  parent_id?: string | null;
  due_date?: LocalDate | null;
  due_time?: string | null;
  priority?: number;
  notes?: string | null;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'list_id'
    | 'due_date'
    | 'due_time'
    | 'priority'
    | 'rrule'
    | 'remind_at'
    | 'status'
  >
>;

/** Field konten yang disalin ke kejadian berikutnya tugas berulang. */
function contentOf(t: Task) {
  return {
    title: t.title,
    notes: t.notes,
    list_id: t.list_id,
    parent_id: t.parent_id,
    priority: t.priority,
    due_time: t.due_time,
    position: t.position,
  };
}

export function useTaskActions() {
  const { db } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const setStatus = async (id: string, status: TaskStatus) => {
      await db
        .update(tasks)
        .set(touch({ status, completed_at: status === 'done' ? nowIso() : null }))
        .where(eq(tasks.id, id));
    };

    const actions = {
      async create(input: NewTaskInput): Promise<string> {
        const row = withMeta(userId, {
          title: input.title.trim(),
          list_id: input.list_id ?? null,
          parent_id: input.parent_id ?? null,
          due_date: input.due_date ?? null,
          due_time: input.due_date ? toDbTime(input.due_time) : null,
          priority: input.priority ?? 0,
          notes: input.notes ?? null,
          status: 'todo' as const,
          position: Date.now(),
        });
        await db.insert(tasks).values(row);
        return row.id;
      },

      async update(id: string, patch: TaskPatch) {
        const values: TaskPatch = { ...patch };
        if ('due_time' in values) values.due_time = toDbTime(values.due_time);
        if (values.due_date === null) {
          // Tanpa tanggal → tidak boleh ada jam, pengulangan, atau pengingat
          Object.assign(values, { due_time: null, rrule: null, remind_at: null });
        }
        await db.update(tasks).set(touch(values)).where(eq(tasks.id, id));
      },

      /** Centang/batal centang. Tugas berulang → buat kejadian berikutnya. */
      async toggle(task: Task) {
        if (task.status === 'done' || task.status === 'cancelled') {
          await setStatus(task.id, 'todo');
          return;
        }
        if (task.rrule && task.due_date && !task.parent_id) {
          await completeRecurring(task);
          return;
        }
        await setStatus(task.id, 'done');
        if (!task.parent_id) {
          toast('Tugas selesai 🎉', {
            tone: 'success',
            action: { label: 'Urungkan', onClick: () => setStatus(task.id, 'todo') },
          });
        }
      },

      async cancel(task: Task) {
        await db
          .update(tasks)
          .set(touch({ status: 'cancelled', completed_at: null }))
          .where(eq(tasks.id, task.id));
        toast('Tugas dibatalkan', {
          action: { label: 'Urungkan', onClick: () => setStatus(task.id, task.status) },
        });
      },

      /** Pindahkan ke Sampah (beserta subtask). */
      async remove(task: Task) {
        const values = softDeleted();
        await db.transaction(async (tx) => {
          await tx.update(tasks).set(values).where(eq(tasks.id, task.id));
          await tx
            .update(tasks)
            .set(values)
            .where(and(eq(tasks.parent_id, task.id), isNull(tasks.deleted_at)));
        });
        if (!task.parent_id) {
          toast('Dipindahkan ke Sampah', {
            action: { label: 'Urungkan', onClick: () => actions.restore(task.id) },
          });
        }
      },

      async restore(id: string) {
        const values = touch({ deleted_at: null });
        await db.transaction(async (tx) => {
          await tx.update(tasks).set(values).where(eq(tasks.id, id));
          await tx
            .update(tasks)
            .set(values)
            .where(and(eq(tasks.parent_id, id), isNotNull(tasks.deleted_at)));
        });
      },

      /** Hapus permanen (subtask ikut). Tidak bisa diurungkan. */
      async destroy(ids: string[]) {
        if (ids.length === 0) return;
        // Bersama subtask, tag & tautan
        await destroyEntities(db, 'task', ids);
      },

      async emptyTrash() {
        const rows = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(isNull(tasks.parent_id), isNotNull(tasks.deleted_at)));
        await actions.destroy(rows.map((r) => r.id));
        return rows.length;
      },

      // ---------------------------------------------------------------- Daftar
      async createList(name: string, color: string) {
        const row = withMeta(userId, {
          name: name.trim(),
          color,
          icon: null,
          position: Date.now(),
          is_archived: 0,
        });
        await db.insert(taskLists).values(row);
        return row.id;
      },

      async updateList(id: string, patch: { name?: string; color?: string }) {
        await db.update(taskLists).set(touch(patch)).where(eq(taskLists.id, id));
      },

      /** Hapus daftar; tugas di dalamnya pindah ke "Tanpa daftar". */
      async removeList(id: string) {
        await db.transaction(async (tx) => {
          await tx
            .update(tasks)
            .set(touch({ list_id: null }))
            .where(eq(tasks.list_id, id));
          await tx.update(taskLists).set(softDeleted()).where(eq(taskLists.id, id));
        });
      },
    };

    /**
     * Selesaikan tugas berulang (model bergulir):
     *   baris ini → riwayat (done, rrule = null); baris baru → kejadian berikutnya,
     *   pengingat digeser sejumlah hari yang sama, subtask disalin dalam keadaan belum selesai.
     */
    async function completeRecurring(task: Task) {
      const now = nowIso();
      const seriesId = task.series_id ?? task.id;
      const next = nextDueAfterCompletion(task.rrule!, task.due_date!, todayLocal());
      let nextId: string | null = null;

      await db.transaction(async (tx) => {
        await tx
          .update(tasks)
          .set({
            status: 'done',
            completed_at: now,
            rrule: null,
            series_id: seriesId,
            updated_at: now,
          })
          .where(eq(tasks.id, task.id));

        if (!next) return;
        const row = withMeta(userId, {
          ...contentOf(task),
          due_date: next,
          remind_at: shiftRemindAt(task.remind_at, diffLocalDays(task.due_date!, next)),
          rrule: task.rrule,
          series_id: seriesId,
          status: 'todo' as const,
        });
        nextId = row.id;
        await tx.insert(tasks).values(row);

        const subs = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.parent_id, task.id), isNull(tasks.deleted_at)));
        for (const s of subs) {
          await tx
            .insert(tasks)
            .values(
              withMeta(userId, { ...contentOf(s), parent_id: row.id, status: 'todo' as const }),
            );
        }
      });

      const undo = async () => {
        await db.transaction(async (tx) => {
          if (nextId) {
            await tx.delete(tasks).where(eq(tasks.parent_id, nextId));
            await tx.delete(tasks).where(eq(tasks.id, nextId));
          }
          await tx
            .update(tasks)
            .set(touch({ status: task.status, completed_at: null, rrule: task.rrule }))
            .where(eq(tasks.id, task.id));
        });
      };

      toast(
        next
          ? `Selesai · berikutnya ${relativeDayLabel(next).toLowerCase()}`
          : 'Selesai · seri berakhir',
        {
          tone: 'success',
          action: { label: 'Urungkan', onClick: undo },
        },
      );
    }

    return actions;
  }, [db, userId]);
}
