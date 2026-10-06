import { CalendarDays, Clock, Flag, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { relativeDayLabel, todayLocal, type LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useTagActions } from '@/features/tags/tag-actions';
import { parseQuickAdd } from '../quick-parse';
import { useTaskActions } from '../task-actions';
import { PRIORITIES } from '../task-utils';

interface Props {
  /** Tanggal default jika input tidak menyebut tanggal */
  defaultDate?: LocalDate | null;
  listId?: string | null;
  placeholder?: string;
  className?: string;
}

/**
 * Tambah tugas dalam satu baris. Mengerti "besok", "lusa", nama hari, "jam 9", "14.30", "!1–!3".
 * Pratinjau token yang terbaca ditampilkan di bawah input.
 */
export function QuickAdd({ defaultDate = null, listId = null, placeholder, className }: Props) {
  const actions = useTaskActions();
  const tagActions = useTagActions();
  const [value, setValue] = useState('');
  const today = todayLocal();
  const parsed = value.trim() ? parseQuickAdd(value, today) : null;
  const date = parsed?.due_date ?? defaultDate;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed?.title) return;
    const id = await actions.create({
      title: parsed.title,
      due_date: date,
      due_time: parsed.due_time ?? null,
      priority: parsed.priority ?? 0,
      list_id: listId,
    });
    if (parsed.tags?.length) await tagActions.addByName('task', id, parsed.tags);
    setValue('');
  };

  return (
    <form onSubmit={submit} className={cn('rounded-2xl px-3 py-2 glass', className)}>
      <div className="flex items-center gap-2">
        <span className="shine flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-tasks text-white">
          <Plus className="size-4" />
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? 'Tambah tugas… (mis. "Bayar listrik besok jam 9 !3")'}
          aria-label="Tambah tugas"
          enterKeyHint="done"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted/70"
        />
        {parsed && (
          <button
            type="submit"
            className="rounded-lg bg-gradient-tasks px-3 py-1.5 text-xs font-bold text-white shadow-md"
          >
            Tambah
          </button>
        )}
      </div>
      {parsed && (date || parsed.due_time || parsed.priority || parsed.tags?.length) && (
        <div className="flex flex-wrap gap-2 pt-1.5 pb-0.5 pl-9 text-xs font-semibold text-primary">
          {date && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" /> {relativeDayLabel(date, today)}
            </span>
          )}
          {parsed.due_time && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> {parsed.due_time}
            </span>
          )}
          {parsed.priority ? (
            <span className="inline-flex items-center gap-1">
              <Flag className="size-3.5" /> {PRIORITIES[parsed.priority]?.label}
            </span>
          ) : null}
          {parsed.tags?.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </div>
      )}
    </form>
  );
}
