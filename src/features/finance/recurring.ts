/**
 * Transaksi berulang (langganan, tagihan, gaji).
 *
 *  - `rrule` memakai format yang sama dengan tugas berulang (features/tasks/recurrence.ts),
 *    dengan DTSTART = start_on.
 *  - `next_run_on` = kejadian berikutnya yang belum dicatat (null = seri selesai).
 *  - auto_post = 1 → dicatat otomatis saat aplikasi dibuka (useRecurringProcessor).
 *    auto_post = 0 → hanya muncul sebagai "Jatuh tempo" dengan tombol Catat / Lewati.
 *
 * ID transaksi hasil seri bersifat DETERMINISTIK (hash recurring_id + tanggal), jadi dua
 * perangkat yang sama-sama memproses saat offline menghasilkan baris yang sama → tidak dobel.
 */
import { occurrencesBetween, nextOccurrence } from '@/features/tasks/recurrence';
import type { LocalDate } from '@/lib/date';

export interface RecurringSchedule {
  rrule: string;
  start_on: LocalDate;
  end_on: LocalDate | null;
  next_run_on: LocalDate | null;
}

/** Kejadian pertama mulai `from` (inklusif), dibatasi end_on. */
export function firstOccurrenceFrom(s: Omit<RecurringSchedule, 'next_run_on'>, from: LocalDate) {
  const [first] = occurrencesBetween(s.rrule, s.start_on, from, s.end_on ?? '9999-12-31', 1);
  return first ?? null;
}

/** Kejadian setelah `after`, menghormati end_on. */
export function occurrenceAfter(s: Omit<RecurringSchedule, 'next_run_on'>, after: LocalDate) {
  const next = nextOccurrence(s.rrule, s.start_on, after);
  return next && (!s.end_on || next <= s.end_on) ? next : null;
}

/** Semua kejadian jatuh tempo (≤ today) yang belum dicatat, + next_run_on baru. */
export function dueOccurrences(s: RecurringSchedule, today: LocalDate, max = 60) {
  if (!s.next_run_on || s.next_run_on > today)
    return { dates: [] as LocalDate[], next: s.next_run_on };
  const until = s.end_on && s.end_on < today ? s.end_on : today;
  const dates = occurrencesBetween(s.rrule, s.start_on, s.next_run_on, until, max);
  const last = dates.at(-1) ?? s.next_run_on;
  return { dates, next: occurrenceAfter(s, last) };
}

/** UUID deterministik (format v8) dari string — via SHA-256. */
export async function deterministicUuid(input: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
  );
  const b = hash.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x80; // versi 8
  b[8] = (b[8]! & 0x3f) | 0x80; // varian RFC 4122
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const recurringTxId = (recurringId: string, date: LocalDate) =>
  deterministicUuid(`taskify:recurring:${recurringId}:${date}`);
