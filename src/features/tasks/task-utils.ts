import type { Task } from '@/db/schema';
import { formatLocalDate, relativeDayLabel, type LocalDate } from '@/lib/date';

export const PRIORITIES = [
  { value: 0, label: 'Tanpa', short: '–' },
  { value: 1, label: 'Rendah', short: 'Rendah' },
  { value: 2, label: 'Sedang', short: 'Sedang' },
  { value: 3, label: 'Tinggi', short: 'Tinggi' },
] as const;

/** Warna daftar (nama disimpan di DB, kelas Tailwind statis di sini). */
export const LIST_COLORS = {
  violet: { dot: 'bg-violet-500', soft: 'bg-violet-500/15 text-violet-600 dark:text-violet-300' },
  indigo: { dot: 'bg-indigo-500', soft: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300' },
  sky: { dot: 'bg-sky-500', soft: 'bg-sky-500/15 text-sky-600 dark:text-sky-300' },
  teal: { dot: 'bg-teal-500', soft: 'bg-teal-500/15 text-teal-600 dark:text-teal-300' },
  emerald: {
    dot: 'bg-emerald-500',
    soft: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  },
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
  orange: { dot: 'bg-orange-500', soft: 'bg-orange-500/15 text-orange-600 dark:text-orange-300' },
  rose: { dot: 'bg-rose-500', soft: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
  pink: { dot: 'bg-pink-500', soft: 'bg-pink-500/15 text-pink-600 dark:text-pink-300' },
  slate: { dot: 'bg-slate-500', soft: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
} as const;

export type ListColor = keyof typeof LIST_COLORS;
export const listColor = (name: string | null | undefined) =>
  LIST_COLORS[(name as ListColor) in LIST_COLORS ? (name as ListColor) : 'violet'];

export interface TaskGroup {
  key: string;
  label: string;
  tone?: 'danger' | 'muted';
  items: Task[];
}

/** Kelompokkan tugas per tanggal: Terlambat → per hari → Tanpa tanggal. */
export function groupByDate(items: Task[], today: LocalDate): TaskGroup[] {
  const overdue: Task[] = [];
  const noDate: Task[] = [];
  const byDay = new Map<string, Task[]>();

  for (const t of items) {
    if (!t.due_date) noDate.push(t);
    else if (t.due_date < today && t.status !== 'done') overdue.push(t);
    else byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t]);
  }

  const groups: TaskGroup[] = [];
  if (overdue.length)
    groups.push({ key: 'overdue', label: 'Terlambat', tone: 'danger', items: overdue });
  for (const [day, list] of [...byDay.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    groups.push({ key: day, label: dayGroupLabel(day, today), items: list });
  }
  if (noDate.length)
    groups.push({ key: 'none', label: 'Tanpa tanggal', tone: 'muted', items: noDate });
  return groups;
}

export function dayGroupLabel(day: LocalDate, today: LocalDate) {
  const rel = relativeDayLabel(day, today);
  const full = formatLocalDate(day, 'EEEE, d MMMM');
  return rel === 'Hari ini' || rel === 'Besok' || rel === 'Kemarin' ? `${rel} · ${full}` : full;
}

export const isDone = (t: Pick<Task, 'status'>) => t.status === 'done';
export const isActive = (t: Pick<Task, 'status'>) =>
  t.status === 'todo' || t.status === 'in_progress';
