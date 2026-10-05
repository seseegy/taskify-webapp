import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { parseLocalDate, toLocalDate, WEEK_STARTS_ON, type LocalDate } from '@/lib/date';

export interface MonthCell {
  date: LocalDate;
  day: number;
  inMonth: boolean;
}

/** Grid bulan dimulai hari Senin. Panjang 35 atau 42 sel (5–6 minggu). */
export function buildMonthGrid(month: LocalDate): MonthCell[] {
  const anchor = parseLocalDate(month);
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON });
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON });

  const cells: MonthCell[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    cells.push({ date: toLocalDate(d), day: d.getDate(), inMonth: isSameMonth(d, anchor) });
  }
  return cells;
}

/** 7 hari mulai Senin minggu ini (untuk strip mingguan di Beranda). */
export function buildWeek(day: LocalDate): LocalDate[] {
  const start = startOfWeek(parseLocalDate(day), { weekStartsOn: WEEK_STARTS_ON });
  return Array.from({ length: 7 }, (_, i) => toLocalDate(addDays(start, i)));
}

export const firstOfMonth = (day: LocalDate): LocalDate => `${day.slice(0, 7)}-01`;

export const shiftMonth = (month: LocalDate, amount: number): LocalDate =>
  toLocalDate(addMonths(parseLocalDate(month), amount));

export const WEEKDAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

/** Legenda warna modul di kalender (selaras dengan --color-mod-* di styles/index.css). */
export const ACTIVITY_LEGEND = [
  { label: 'Tugas', className: 'bg-mod-tasks' },
  { label: 'Jurnal', className: 'bg-mod-journal' },
  { label: 'Keuangan', className: 'bg-mod-finance' },
  { label: 'Vault', className: 'bg-mod-vault' },
];
