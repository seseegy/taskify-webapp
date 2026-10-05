/**
 * Query reaktif modul Tugas. Semua membaca SQLite lokal dan otomatis ter-update
 * saat data berubah (lokal maupun hasil sync).
 *
 * Konvensi: daftar utama hanya menampilkan tugas induk (parent_id IS NULL);
 * subtask diambil per tugas atau sebagai ringkasan progres.
 */
import { toCompilableQuery } from '@powersync/drizzle-driver';
import { useQuery } from '@powersync/react';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { useMemo } from 'react';
import { useDatabase } from '@/db/database-context';
import { tasks, taskLists, type Task, type TaskList } from '@/db/schema';
import type { LocalDate } from '@/lib/date';

export const ACTIVE_STATUSES = ['todo', 'in_progress'] as const;

export type SmartView = 'today' | 'upcoming' | 'overdue' | 'all' | 'done' | 'trash';
export type TaskView = SmartView | `list:${string}`;

export const isListView = (view: TaskView): view is `list:${string}` => view.startsWith('list:');

const activeOrder = [
  sql`${tasks.due_date} IS NULL`,
  asc(tasks.due_date),
  sql`${tasks.due_time} IS NULL`,
  asc(tasks.due_time),
  desc(tasks.priority),
  asc(tasks.position),
];

/** Tugas induk untuk satu tampilan. */
export function useTaskViewRows(view: TaskView, today: LocalDate) {
  const { db } = useDatabase();

  const query = useMemo(() => {
    const top = isNull(tasks.parent_id);
    const alive = isNull(tasks.deleted_at);
    const active = inArray(tasks.status, [...ACTIVE_STATUSES]);
    const q = db.select().from(tasks);

    if (isListView(view)) {
      return q
        .where(and(top, alive, active, eq(tasks.list_id, view.slice(5))))
        .orderBy(...activeOrder);
    }
    switch (view) {
      case 'today':
        return q
          .where(and(top, alive, ne(tasks.status, 'cancelled'), eq(tasks.due_date, today)))
          .orderBy(sql`${tasks.status} = 'done'`, ...activeOrder);
      case 'upcoming':
        return q.where(and(top, alive, active, gt(tasks.due_date, today))).orderBy(...activeOrder);
      case 'overdue':
        return q.where(and(top, alive, active, lt(tasks.due_date, today))).orderBy(...activeOrder);
      case 'all':
        return q.where(and(top, alive, active)).orderBy(...activeOrder);
      case 'done':
        return q
          .where(and(top, alive, inArray(tasks.status, ['done', 'cancelled'])))
          .orderBy(desc(sql`COALESCE(${tasks.completed_at}, ${tasks.updated_at})`))
          .limit(300);
      case 'trash':
        return q
          .where(and(top, isNotNull(tasks.deleted_at)))
          .orderBy(desc(tasks.deleted_at))
          .limit(300);
    }
  }, [db, view, today]);

  return useQuery(toCompilableQuery(query));
}

export interface ViewCounts {
  today: number;
  upcoming: number;
  overdue: number;
  all: number;
  trash: number;
}

const COUNTS_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN deleted_at IS NULL AND status IN ('todo','in_progress') AND due_date = ?1 THEN 1 ELSE 0 END), 0) AS today,
    COALESCE(SUM(CASE WHEN deleted_at IS NULL AND status IN ('todo','in_progress') AND due_date > ?1 THEN 1 ELSE 0 END), 0) AS upcoming,
    COALESCE(SUM(CASE WHEN deleted_at IS NULL AND status IN ('todo','in_progress') AND due_date < ?1 THEN 1 ELSE 0 END), 0) AS overdue,
    COALESCE(SUM(CASE WHEN deleted_at IS NULL AND status IN ('todo','in_progress') THEN 1 ELSE 0 END), 0) AS "all",
    COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS trash
  FROM tasks WHERE parent_id IS NULL
`;

export function useViewCounts(today: LocalDate): ViewCounts | undefined {
  const { data } = useQuery<ViewCounts>(COUNTS_SQL, [today]);
  return data[0];
}

/** Jumlah tugas aktif per daftar. */
export function useListCounts() {
  const { data } = useQuery<{ list_id: string; n: number }>(
    `SELECT list_id, COUNT(*) AS n FROM tasks
      WHERE deleted_at IS NULL AND parent_id IS NULL AND list_id IS NOT NULL
        AND status IN ('todo','in_progress')
      GROUP BY list_id`,
  );
  return useMemo(() => new Map(data.map((r) => [r.list_id, r.n])), [data]);
}

export function useTaskLists(): TaskList[] {
  const { db } = useDatabase();
  const query = useMemo(
    () =>
      db
        .select()
        .from(taskLists)
        .where(and(isNull(taskLists.deleted_at), eq(taskLists.is_archived, 0)))
        .orderBy(asc(taskLists.position), asc(taskLists.created_at)),
    [db],
  );
  return useQuery(toCompilableQuery(query)).data;
}

export function useTask(id: string | null): Task | undefined {
  const { db } = useDatabase();
  const query = useMemo(
    () =>
      db
        .select()
        .from(tasks)
        .where(eq(tasks.id, id ?? ''))
        .limit(1),
    [db, id],
  );
  return useQuery(toCompilableQuery(query)).data[0];
}

export function useSubtasks(parentId: string): Task[] {
  const { db } = useDatabase();
  const query = useMemo(
    () =>
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.parent_id, parentId), isNull(tasks.deleted_at)))
        .orderBy(asc(tasks.position), asc(tasks.created_at)),
    [db, parentId],
  );
  return useQuery(toCompilableQuery(query)).data;
}

export interface Progress {
  done: number;
  total: number;
}

/** Progres subtask per tugas induk: Map<parent_id, {done, total}>. */
export function useSubtaskProgress() {
  const { data } = useQuery<{ parent_id: string; total: number; done: number }>(
    `SELECT parent_id, COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tasks
      WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND status <> 'cancelled'
      GROUP BY parent_id`,
  );
  return useMemo(
    () =>
      new Map<string, Progress>(data.map((r) => [r.parent_id, { done: r.done, total: r.total }])),
    [data],
  );
}

/** Tugas induk dengan due_date dalam rentang (untuk kalender). */
export function useTasksInRange(from: LocalDate, to: LocalDate): Task[] {
  const { db } = useDatabase();
  const query = useMemo(
    () =>
      db
        .select()
        .from(tasks)
        .where(
          and(
            isNull(tasks.parent_id),
            isNull(tasks.deleted_at),
            ne(tasks.status, 'cancelled'),
            sql`${tasks.due_date} BETWEEN ${from} AND ${to}`,
          ),
        )
        .orderBy(sql`${tasks.status} = 'done'`, ...activeOrder),
    [db, from, to],
  );
  return useQuery(toCompilableQuery(query)).data;
}

/** Tugas berulang aktif yang mulai sebelum/selama rentang (sumber kejadian virtual). */
export function useActiveRecurring(to: LocalDate): Task[] {
  const { db } = useDatabase();
  const query = useMemo(
    () =>
      db
        .select()
        .from(tasks)
        .where(
          and(
            isNull(tasks.parent_id),
            isNull(tasks.deleted_at),
            inArray(tasks.status, [...ACTIVE_STATUSES]),
            isNotNull(tasks.rrule),
            lte(tasks.due_date, to),
          ),
        ),
    [db, to],
  );
  return useQuery(toCompilableQuery(query)).data;
}
