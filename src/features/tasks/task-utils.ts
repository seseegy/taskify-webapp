import type { Task } from '@/db/schema';
import { formatLocalDate, relativeDayLabel, type LocalDate } from '@/lib/date';
import { PALETTE, paletteOf, type PaletteColor } from '@/lib/palette';

export const PRIORITIES = [
  { value: 0, label: 'Tanpa', short: '–' },
  { value: 1, label: 'Rendah', short: 'Rendah' },
  { value: 2, label: 'Sedang', short: 'Sedang' },
  { value: 3, label: 'Tinggi', short: 'Tinggi' },
] as const;

/** Warna daftar — palet bersama (lib/palette.ts). */
export const LIST_COLORS = PALETTE;
export type ListColor = PaletteColor;
export const listColor = (name: string | null | undefined) => paletteOf(name);

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
