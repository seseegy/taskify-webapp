import { BellRing, CalendarDays, Clock, ListTree, NotebookText, Repeat } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Task, TaskList } from '@/db/schema';
import { relativeDayLabel, shortTime, type LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { Progress } from '../task-queries';
import { useTaskSheet } from '../task-sheet-store';
import { listColor } from '../task-utils';
import { TagChip } from '@/features/tags/TagPicker';
import { TaskCheckbox } from './TaskCheckbox';

interface Props {
  task: Task;
  today: LocalDate;
  onToggle: (task: Task) => void;
  progress?: Progress;
  list?: TaskList;
  /** Tampilkan chip tanggal (false di dalam grup per tanggal) */
  showDate?: boolean;
  showList?: boolean;
  /** Tanggal kejadian virtual (tugas berulang mendatang) */
  virtualDate?: LocalDate;
  compact?: boolean;
  trailing?: ReactNode;
  tags?: { id: string; name: string; color: string | null }[];
}

export function TaskRow({
  task,
  today,
  onToggle,
  progress,
  list,
  showDate = true,
  showList = true,
  virtualDate,
  compact,
  trailing,
  tags,
}: Props) {
  const openSheet = useTaskSheet((s) => s.open);
  const done = task.status === 'done';
  const cancelled = task.status === 'cancelled';
  const date = virtualDate ?? task.due_date;
  const overdue = !done && !cancelled && !virtualDate && !!task.due_date && task.due_date < today;

  const meta: ReactNode[] = [];
  if (showDate && date)
    meta.push(
      <Chip
        key="date"
        className={overdue ? 'text-danger' : date === today ? 'text-primary' : undefined}
      >
        <CalendarDays /> {relativeDayLabel(date, today)}
      </Chip>,
    );
  if (task.due_time)
    meta.push(
      <Chip key="time">
        <Clock /> {shortTime(task.due_time)}
      </Chip>,
    );
  if (task.rrule || virtualDate)
    meta.push(
      <Chip key="rep">
        <Repeat />
      </Chip>,
    );
  if (task.remind_at && !done)
    meta.push(
      <Chip key="bell">
        <BellRing />
      </Chip>,
    );
  if (progress && progress.total > 0)
    meta.push(
      <Chip key="sub" className={progress.done === progress.total ? 'text-success' : undefined}>
        <ListTree /> {progress.done}/{progress.total}
      </Chip>,
    );
  if (task.notes?.trim())
    meta.push(
      <Chip key="notes">
        <NotebookText />
      </Chip>,
    );
  if (showList && list) {
    const c = listColor(list.color);
    meta.push(
      <span
        key="list"
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          c.soft,
        )}
      >
        {list.name}
      </span>,
    );
  }

  for (const t of tags ?? []) meta.push(<TagChip key={`tag-${t.id}`} tag={t} size="sm" />);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openSheet(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openSheet(task.id);
      }}
      className={cn(
        'group flex w-full cursor-pointer items-start gap-3 rounded-2xl text-left transition hover:bg-surface focus-visible:bg-surface',
        compact ? 'px-2 py-2' : 'px-3 py-2.5',
        virtualDate && 'opacity-75',
      )}
    >
      <span className={compact ? 'pt-px' : 'pt-0.5'}>
        <TaskCheckbox
          checked={done}
          priority={task.priority}
          onToggle={() => onToggle(task)}
          virtual={!!virtualDate}
          size={compact ? 'sm' : 'md'}
          label={done ? `Tandai belum selesai: ${task.title}` : `Selesaikan: ${task.title}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-sm font-semibold break-words',
            (done || cancelled) && 'text-muted line-through decoration-primary/40 decoration-2',
          )}
        >
          {task.title}
        </span>
        {meta.length > 0 && (
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            {meta}
          </span>
        )}
      </span>
      {trailing}
    </div>
  );
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium [&_svg]:size-3.5', className)}>
      {children}
    </span>
  );
}
