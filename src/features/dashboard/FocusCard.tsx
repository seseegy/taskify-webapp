import { toCompilableQuery } from '@powersync/drizzle-driver';
import { useQuery } from '@powersync/react';
import { and, asc, desc, inArray, isNull, lte, sql } from 'drizzle-orm';
import { ArrowRight, Target } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useDatabase } from '@/db/database-context';
import { tasks } from '@/db/schema';
import { QuickAdd } from '@/features/tasks/components/QuickAdd';
import { TaskRow } from '@/features/tasks/components/TaskRow';
import { useTaskActions } from '@/features/tasks/task-actions';
import { useSubtaskProgress } from '@/features/tasks/task-queries';
import type { LocalDate } from '@/lib/date';

const LIMIT = 6;

/** Tugas aktif yang jatuh tempo hari ini atau terlambat — bisa langsung dicentang. */
export function FocusCard({ today }: { today: LocalDate }) {
  const { db } = useDatabase();
  const actions = useTaskActions();
  const progress = useSubtaskProgress();

  const query = useMemo(
    () =>
      db
        .select()
        .from(tasks)
        .where(
          and(
            isNull(tasks.parent_id),
            isNull(tasks.deleted_at),
            inArray(tasks.status, ['todo', 'in_progress']),
            lte(tasks.due_date, today),
          ),
        )
        .orderBy(
          asc(tasks.due_date),
          sql`${tasks.due_time} IS NULL`,
          asc(tasks.due_time),
          desc(tasks.priority),
        )
        .limit(LIMIT + 1),
    [db, today],
  );
  const { data } = useQuery(toCompilableQuery(query));

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-mod-tasks" /> Fokus hari ini
          </CardTitle>
          <CardDescription>Jatuh tempo hari ini & yang terlambat</CardDescription>
        </div>
        <Link
          to="/tugas"
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          Tugas <ArrowRight className="size-4" />
        </Link>
      </CardHeader>
      <QuickAdd defaultDate={today} placeholder="Tambah tugas hari ini…" className="mb-2" />
      {data.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted">Semua beres untuk hari ini 🎉</p>
      ) : (
        <div className="space-y-0.5">
          {data.slice(0, LIMIT).map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              today={today}
              compact
              showDate={t.due_date !== today}
              onToggle={(task) => void actions.toggle(task)}
              progress={progress.get(t.id)}
            />
          ))}
          {data.length > LIMIT && (
            <Link
              to="/tugas?view=today"
              className="block px-2 pt-2 text-xs font-semibold text-primary hover:underline"
            >
              Lihat semua…
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
