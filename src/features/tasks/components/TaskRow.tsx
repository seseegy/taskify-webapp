import {
  BellRing,
  CalendarDays,
  Clock,
  Flag,
  ListTree,
  NotebookText,
  Repeat,
  TriangleAlert,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { Task, TaskList } from '@/db/schema';
import { relativeDayLabel, shortTime, type LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { Progress } from '../task-queries';
import { useTaskSheet } from '../task-sheet-store';
import { listColor, PRIORITIES } from '../task-utils';
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
  const metaId = useId();
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
        {overdue ? <TriangleAlert /> : <CalendarDays />}{' '}
        {overdue && <span className="font-bold">Terlambat · </span>}
        {relativeDayLabel(date, today)}
      </Chip>,
    );
  if (task.priority > 0 && !done && !cancelled) {
    const p = PRIORITIES[task.priority];
    meta.push(
      <Chip
        key="prio"
        title={`Prioritas ${p?.label.toLowerCase()}`}
        className={cn(
          task.priority === 1 && 'text-sky-600 dark:text-sky-300',
          task.priority === 2 && 'text-amber-600 dark:text-amber-300',
          task.priority === 3 && 'text-rose-600 dark:text-rose-300',
        )}
      >
        <Flag />
        <span className="sr-only">Prioritas </span>
        {!compact && p?.label}
        {compact && <span className="sr-only">{p?.label}</span>}
      </Chip>,
    );
  }
  if (task.due_time)
    meta.push(
      <Chip key="time">
        <Clock /> {shortTime(task.due_time)}
      </Chip>,
    );
  if (task.rrule || virtualDate)
    meta.push(
      <Chip key="rep" title="Berulang">
        <Repeat />
        <span className="sr-only">Berulang</span>
      </Chip>,
    );
  if (task.remind_at && !done)
    meta.push(
      <Chip key="bell" title="Ada pengingat">
        <BellRing />
        <span className="sr-only">Ada pengingat</span>
      </Chip>,
    );
  if (progress && progress.total > 0)
    meta.push(
      <Chip key="sub" className={progress.done === progress.total ? 'text-success' : undefined}>
        <ListTree /> {progress.done}/{progress.total}
        <span className="sr-only"> subtask selesai</span>
      </Chip>,
    );
  if (task.notes?.trim())
    meta.push(
      <Chip key="notes" title="Ada catatan">
        <NotebookText />
        <span className="sr-only">Ada catatan</span>
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
    // Baris BUKAN role="button": berisi checkbox & tombol lain, dan kontrol interaktif tidak boleh
    // bersarang di dalam button. Jalur keyboard/pembaca layar = tombol judul di bawah; onClick
    // pada baris hanya kemudahan untuk pointer (mouse/sentuh).
    <div
      onClick={() => openSheet(task.id)}
      className={cn(
        'group flex w-full cursor-pointer items-start gap-3 rounded-2xl text-left transition focus-within:bg-surface hover:bg-surface',
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
        <button
          type="button"
          aria-haspopup="dialog"
          aria-describedby={meta.length > 0 ? metaId : undefined}
          onClick={(e) => {
            e.stopPropagation();
            openSheet(task.id);
          }}
          className={cn(
            'block w-full cursor-pointer rounded-md text-left text-sm font-semibold break-words',
            (done || cancelled) && 'text-muted line-through decoration-primary/40 decoration-2',
          )}
        >
          {task.title}
        </button>
        {meta.length > 0 && (
          <span
            id={metaId}
            className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted"
          >
            {meta}
          </span>
        )}
      </span>
      {trailing}
    </div>
  );
}

function Chip({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  /** Tooltip untuk pengguna mouse; teks `sr-only` di dalam anak tetap wajib untuk pembaca layar */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 font-medium [&_svg]:size-3.5', className)}
    >
      {children}
    </span>
  );
}
