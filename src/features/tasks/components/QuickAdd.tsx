import { CalendarDays, Clock, Flag, Plus } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
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
    <form
      onSubmit={submit}
      className={cn(
        'rounded-2xl px-3 py-2 glass focus-within:ring-2 focus-within:ring-primary/50',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shine flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-tasks text-white">
          <Plus className="size-4" />
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? 'Tambah tugas… (mis. "Bayar listrik besok jam 9 !3")'}
          aria-label="Tambah tugas"
          aria-describedby={helpId}
          autoComplete="off"
          enterKeyHint="done"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted"
        />
        {/* Selalu ada (tidak muncul/hilang → tidak ada lompatan tata letak) dan ≥ 36px.
            Saat kosong, mengetuknya memfokuskan kolom alih-alih tidak berbuat apa-apa. */}
        <button
          type={parsed ? 'submit' : 'button'}
          onClick={parsed ? undefined : () => inputRef.current?.focus()}
          className={cn(
            'min-h-9 rounded-lg px-3 text-xs font-bold transition',
            parsed
              ? 'bg-gradient-tasks text-white shadow-md'
              : 'bg-surface text-muted hover:text-fg',
          )}
        >
          Tambah
        </button>
      </div>
      {/* Petunjuk sintaks persisten untuk pembaca layar (placeholder hilang saat mengetik) */}
      <span id={helpId} className="sr-only">
        Bisa menulis tanggal dan waktu langsung: besok, lusa, nama hari, jam 9, 14.30. Awali
        prioritas dengan tanda seru satu sampai tiga, dan tag dengan tanda pagar. Tekan Enter untuk
        menambah.
      </span>
      {parsed && (date || parsed.due_time || parsed.priority || parsed.tags?.length) && (
        // Pratinjau hasil baca diumumkan agar pengguna pembaca layar tahu "besok jam 9 !3" terbaca
        <div
          role="status"
          aria-label="Terbaca"
          className="flex flex-wrap gap-2 pt-1.5 pb-0.5 pl-9 text-xs font-semibold text-primary"
        >
          {date && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden="true" />{' '}
              {relativeDayLabel(date, today)}
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
