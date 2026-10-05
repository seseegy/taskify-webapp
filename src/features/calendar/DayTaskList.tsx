import type { TaskList } from '@/db/schema';
import { TaskRow } from '@/features/tasks/components/TaskRow';
import { useTaskActions } from '@/features/tasks/task-actions';
import { useSubtaskProgress } from '@/features/tasks/task-queries';
import type { LocalDate } from '@/lib/date';
import type { CalendarTaskItem } from './useDayActivity';

interface Props {
  items: CalendarTaskItem[];
  today: LocalDate;
  lists: Map<string, TaskList>;
  compact?: boolean;
  empty?: string;
}

/** Daftar tugas satu hari di kalender (nyata + kejadian berulang virtual). */
export function DayTaskList({ items, today, lists, compact, empty }: Props) {
  const actions = useTaskActions();
  const progress = useSubtaskProgress();

  if (items.length === 0) {
    return empty ? <p className="px-2 py-1 text-sm text-muted">{empty}</p> : null;
  }

  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <TaskRow
          key={`${item.task.id}-${item.date}`}
          task={item.task}
          today={today}
          onToggle={(t) => void actions.toggle(t)}
          progress={item.virtual ? undefined : progress.get(item.task.id)}
          list={item.task.list_id ? lists.get(item.task.list_id) : undefined}
          virtualDate={item.virtual ? item.date : undefined}
          showDate={false}
          compact={compact}
        />
      ))}
    </div>
  );
}
