/**
 * Pengingat = `tasks.remind_at` (timestamp absolut UTC). Server (Edge Function) mengirim
 * Web Push saat remind_at tercapai. Preset di bawah dihitung dari due_date/due_time WIB.
 */
import {
  addLocalDays,
  isoToLocal,
  localDateTimeToIso,
  shortTime,
  type LocalDate,
} from '@/lib/date';

export type ReminderPreset =
  | 'none'
  | 'at_time'
  | 'min_10'
  | 'min_30'
  | 'hour_1'
  | 'day_before'
  | 'morning'
  | 'morning_before'
  | 'custom';

export const MORNING = '09:00';

interface PresetDef {
  value: ReminderPreset;
  label: string;
  /** Hanya untuk tugas yang punya jam / tidak punya jam */
  needsTime?: boolean;
  allDayOnly?: boolean;
}

export const REMINDER_PRESETS: PresetDef[] = [
  { value: 'none', label: 'Tanpa pengingat' },
  { value: 'at_time', label: 'Saat jatuh tempo', needsTime: true },
  { value: 'min_10', label: '10 menit sebelum', needsTime: true },
  { value: 'min_30', label: '30 menit sebelum', needsTime: true },
  { value: 'hour_1', label: '1 jam sebelum', needsTime: true },
  { value: 'day_before', label: '1 hari sebelum', needsTime: true },
  { value: 'morning', label: `Hari itu, ${MORNING}`, allDayOnly: true },
  { value: 'morning_before', label: `Sehari sebelum, ${MORNING}`, allDayOnly: true },
  { value: 'custom', label: 'Waktu lain…' },
];

export function presetsFor(hasTime: boolean) {
  return REMINDER_PRESETS.filter((p) => (hasTime ? !p.allDayOnly : !p.needsTime));
}

const MINUTES: Partial<Record<ReminderPreset, number>> = {
  at_time: 0,
  min_10: 10,
  min_30: 30,
  hour_1: 60,
  day_before: 24 * 60,
};

/** Hitung remind_at (ISO UTC) dari preset. null = tidak ada / tidak valid. */
export function computeRemindAt(
  preset: ReminderPreset,
  dueDate: LocalDate | null,
  dueTime: string | null,
): string | null {
  if (preset === 'none' || preset === 'custom' || !dueDate) return null;
  if (preset === 'morning') return localDateTimeToIso(dueDate, MORNING);
  if (preset === 'morning_before') return localDateTimeToIso(addLocalDays(dueDate, -1), MORNING);
  const minutes = MINUTES[preset];
  if (minutes === undefined || !dueTime) return null;
  const due = Date.parse(localDateTimeToIso(dueDate, shortTime(dueTime)));
  return new Date(due - minutes * 60_000).toISOString();
}

/** Tebak preset dari remind_at yang tersimpan (untuk menampilkan pilihan di editor). */
export function detectPreset(
  remindAt: string | null,
  dueDate: LocalDate | null,
  dueTime: string | null,
): ReminderPreset {
  if (!remindAt) return 'none';
  const stored = isoToLocal(remindAt);
  for (const p of presetsFor(Boolean(dueTime))) {
    if (p.value === 'none' || p.value === 'custom') continue;
    const iso = computeRemindAt(p.value, dueDate, dueTime);
    if (iso) {
      const c = isoToLocal(iso);
      if (c.date === stored.date && c.time === stored.time) return p.value;
    }
  }
  return 'custom';
}

/** Geser remind_at sebanyak N hari (untuk kejadian berikutnya tugas berulang). */
export function shiftRemindAt(remindAt: string | null, days: number): string | null {
  if (!remindAt) return null;
  const { date, time } = isoToLocal(remindAt);
  return localDateTimeToIso(addLocalDays(date, days), time);
}
