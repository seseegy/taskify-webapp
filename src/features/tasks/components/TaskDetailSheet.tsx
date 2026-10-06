import { formatDistanceToNow } from 'date-fns';
import {
  Ban,
  BellRing,
  CalendarDays,
  Flag,
  Hash,
  Link2,
  ListTree,
  NotebookText,
  Repeat,
  RotateCcw,
  Tag,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import type { Task } from '@/db/schema';
import { useTxSheet } from '@/features/finance/tx-sheet-store';
import { LinksPanel } from '@/features/links/LinksPanel';
import { TagPicker } from '@/features/tags/TagPicker';
import { localeId, parseTimestamp, shortTime, todayLocal } from '@/lib/date';
import { cn } from '@/lib/utils';
import { buildRule, parseRule } from '../recurrence';
import { computeRemindAt, detectPreset } from '../reminder';
import { useTaskActions, type TaskPatch } from '../task-actions';
import { useTask, useTaskLists } from '../task-queries';
import { useTaskSheet } from '../task-sheet-store';
import { PRIORITIES } from '../task-utils';
import { RecurrenceEditor } from './RecurrenceEditor';
import { ReminderPicker } from './ReminderPicker';
import { SubtaskList } from './SubtaskList';
import { TaskCheckbox } from './TaskCheckbox';

/** Panel detail tugas global (dipasang sekali di AppShell). */
export function TaskDetailSheet() {
  const taskId = useTaskSheet((s) => s.taskId);
  const close = useTaskSheet((s) => s.close);
  const task = useTask(taskId);

  return (
    <Sheet
      open={taskId !== null && task !== undefined}
      onClose={close}
      title={task?.parent_id ? 'Subtask' : 'Detail tugas'}
      footer={task && <Footer task={task} onClose={close} />}
    >
      {/* key: form di-remount saat pindah tugas → nilai awal input selalu benar */}
      {task && <TaskForm key={task.id} task={task} />}
    </Sheet>
  );
}

function TaskForm({ task }: { task: Task }) {
  const actions = useTaskActions();
  const createTx = useTxSheet((s) => s.create);
  const lists = useTaskLists();
  const save = (patch: TaskPatch) => void actions.update(task.id, patch);
  const done = task.status === 'done';
  const inTrash = task.deleted_at !== null;

  /** Ubah tanggal/jam: sesuaikan rrule bulanan/tahunan & pengingat preset. */
  const changeSchedule = (due_date: string | null, due_time: string | null) => {
    if (!due_date) return save({ due_date: null });
    const patch: TaskPatch = { due_date, due_time };
    if (task.rrule) patch.rrule = buildRule(parseRule(task.rrule), due_date);
    const preset = detectPreset(task.remind_at, task.due_date, task.due_time);
    if (preset !== 'none' && preset !== 'custom') {
      // Preset yang tidak cocok lagi (mis. "10 menit sebelum" tapi jam dihapus) → hapus pengingat
      patch.remind_at = computeRemindAt(preset, due_date, due_time);
    }
    save(patch);
  };

  return (
    <div className="space-y-5">
      {inTrash && (
        <p
          role="status"
          className="rounded-xl bg-warning/10 px-3 py-2 text-sm font-medium text-warning"
        >
          Tugas ini ada di Sampah. Pulihkan untuk mengubahnya.
        </p>
      )}

      {/* <fieldset disabled> menonaktifkan SEMUA kontrol di dalamnya untuk mouse, sentuh, keyboard
          dan pembaca layar (isi tetap terbaca). pointer-events-none sebelumnya hanya memblokir mouse. */}
      <fieldset disabled={inTrash} className={cn('min-w-0 space-y-5', inTrash && 'opacity-75')}>
        <div className="flex items-start gap-3">
          <span className="pt-2">
            <TaskCheckbox
              checked={done}
              priority={task.priority}
              onToggle={() => void actions.toggle(task)}
              label={done ? 'Tandai belum selesai' : 'Selesaikan'}
            />
          </span>
          <textarea
            defaultValue={task.title}
            aria-label="Judul tugas"
            rows={1}
            maxLength={300}
            onBlur={(e) => {
              const v = e.target.value.replace(/\s+/g, ' ').trim();
              if (v && v !== task.title) save({ title: v });
              else e.target.value = task.title;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className={cn(
              'field-sizing-content min-h-10 w-full resize-none bg-transparent py-1 text-lg font-bold outline-none',
              done && 'text-muted line-through',
            )}
          />
        </div>

        <Field icon={CalendarDays} label="Jadwal">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="Tanggal"
              value={task.due_date ?? ''}
              onChange={(e) => changeSchedule(e.target.value || null, task.due_time)}
              className="h-10 w-auto flex-1"
            />
            <Input
              type="time"
              aria-label="Jam"
              value={shortTime(task.due_time)}
              disabled={!task.due_date}
              onChange={(e) => changeSchedule(task.due_date, e.target.value || null)}
              className="h-10 w-32"
            />
            {task.due_date && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Hapus jadwal"
                onClick={() => changeSchedule(null, null)}
              >
                <X />
              </Button>
            )}
          </div>
          {!task.due_date && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => changeSchedule(todayLocal(), null)}
              >
                Hari ini
              </Button>
            </div>
          )}
        </Field>

        {!task.parent_id && (
          <>
            <Field icon={Repeat} label="Berulang">
              {task.due_date ? (
                <RecurrenceEditor
                  rule={task.rrule}
                  anchor={task.due_date}
                  onChange={(rrule) => save({ rrule })}
                />
              ) : (
                <p className="text-sm text-muted">
                  Atur tanggal dulu untuk membuat tugas berulang.
                </p>
              )}
            </Field>

            <Field icon={BellRing} label="Pengingat">
              <ReminderPicker
                remindAt={task.remind_at}
                dueDate={task.due_date}
                dueTime={task.due_time}
                onChange={(remind_at) => save({ remind_at })}
              />
            </Field>
          </>
        )}

        <Field icon={Flag} label="Prioritas">
          <div className="flex rounded-xl p-1 glass" role="radiogroup" aria-label="Prioritas">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={task.priority === p.value}
                onClick={() => save({ priority: p.value })}
                className={cn(
                  'flex-1 rounded-lg py-2 text-xs font-bold transition',
                  task.priority === p.value
                    ? cn(
                        'text-white shadow-md',
                        p.value === 0 && 'bg-slate-500',
                        p.value === 1 && 'bg-sky-500',
                        p.value === 2 && 'bg-amber-500',
                        p.value === 3 && 'bg-rose-500',
                      )
                    : 'text-muted hover:text-fg',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        {!task.parent_id && (
          <Field icon={Tag} label="Daftar">
            <Select
              aria-label="Daftar"
              value={task.list_id ?? ''}
              onChange={(e) => save({ list_id: e.target.value || null })}
            >
              <option value="">Tanpa daftar</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {!task.parent_id && (
          <Field icon={ListTree} label="Subtask">
            <SubtaskList parent={task} />
          </Field>
        )}

        {!task.parent_id && (
          <>
            <Field icon={Hash} label="Tag">
              <TagPicker type="task" entityId={task.id} />
            </Field>
            <Field icon={Link2} label="Tautan">
              <LinksPanel type="task" id={task.id} />
              <button
                type="button"
                onClick={() =>
                  createTx({
                    title: task.title,
                    date: task.due_date ?? undefined,
                    linkTo: { type: 'task', id: task.id },
                  })
                }
                className="mt-1 flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-mod-finance hover:bg-surface"
              >
                <Wallet className="size-4" /> Catat sebagai transaksi
              </button>
            </Field>
          </>
        )}

        <Field icon={NotebookText} label="Catatan">
          <Textarea
            defaultValue={task.notes ?? ''}
            aria-label="Catatan"
            placeholder="Tulis detail, link, atau checklist…"
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (task.notes ?? null)) save({ notes: v });
            }}
            className="field-sizing-content min-h-24"
          />
        </Field>
      </fieldset>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Tag;
  label: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted uppercase">
        <Icon className="size-3.5" /> {label}
      </h3>
      {children}
    </section>
  );
}

function Footer({ task, onClose }: { task: Task; onClose: () => void }) {
  const actions = useTaskActions();
  const inTrash = task.deleted_at !== null;
  const created = formatDistanceToNow(parseTimestamp(task.created_at), {
    addSuffix: true,
    locale: localeId,
  });

  if (inTrash) {
    return (
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          className="text-danger"
          onClick={() => {
            if (!window.confirm('Hapus permanen? Tindakan ini tidak bisa dibatalkan.')) return;
            void actions.destroy([task.id]);
            onClose();
          }}
        >
          <Trash2 /> Hapus permanen
        </Button>
        <Button onClick={() => void actions.restore(task.id)}>
          <RotateCcw /> Pulihkan
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-xs text-muted">Dibuat {created}</span>
      <div className="flex gap-1">
        {!task.parent_id && task.status !== 'cancelled' && task.status !== 'done' && (
          <Button size="sm" variant="ghost" onClick={() => void actions.cancel(task)}>
            <Ban /> Batalkan
          </Button>
        )}
        {task.status === 'cancelled' && (
          <Button size="sm" variant="ghost" onClick={() => void actions.toggle(task)}>
            <RotateCcw /> Aktifkan
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          onClick={() => {
            void actions.remove(task);
            onClose();
          }}
        >
          <Trash2 /> Hapus
        </Button>
      </div>
    </div>
  );
}
