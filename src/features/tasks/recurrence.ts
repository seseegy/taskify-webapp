/**
 * Tugas berulang dengan RRULE (RFC 5545) — disimpan di kolom `tasks.rrule`.
 *
 * Model "bergulir" (seperti Todoist):
 *  - Dalam satu seri (series_id) hanya SATU baris aktif yang membawa rrule.
 *  - Saat diselesaikan, baris itu menjadi riwayat (status done, rrule = null) dan baris baru
 *    dibuat untuk kejadian berikutnya (lihat task-actions.ts → complete()).
 *  - Kejadian masa depan di kalender adalah VIRTUAL: dihitung dari rrule, bukan disimpan.
 *
 * Rule selalu dibuat dengan BY* eksplisit (BYDAY / BYMONTHDAY / BYMONTH) sehingga tidak
 * bergantung pada DTSTART — DTSTART = due_date baris aktif.
 *
 * Tanggal 29–31: menurut RFC 5545 bulan yang tidak punya tanggal itu DILEWATI, sehingga
 * "tiap tanggal 31" tidak pernah jatuh di Feb/Apr/Jun/Sep/Nov. Itu bukan yang diharapkan untuk
 * gaji atau tagihan, jadi di sini jatuh di HARI TERAKHIR bulan itu: BYMONTHDAY=28,29,30,31 +
 * BYSETPOS=-1 (ambil yang terakhir yang ada). Rule lama yang tersimpan sebagai
 * `BYMONTHDAY=31` dinormalkan saat dibaca (lihat `clampToMonthEnd`), jadi tanpa migrasi data.
 *
 * Semua aritmetika memakai Date UTC tengah malam sebagai "tanggal mengambang" agar
 * tidak terpengaruh zona waktu perangkat.
 */
import { RRule, Weekday, type Options } from 'rrule';
import { addLocalDays, formatLocalDate, type LocalDate } from '@/lib/date';

export type RecurrenceFreq = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceState {
  freq: RecurrenceFreq;
  interval: number;
  /** 0 = Senin … 6 = Minggu (konvensi rrule) */
  byDay: number[];
  until: LocalDate | null;
}

export const NO_RECURRENCE: RecurrenceState = { freq: 'none', interval: 1, byDay: [], until: null };

export const WEEKDAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

const toUTC = (date: LocalDate) => new Date(`${date}T00:00:00Z`);
const fromUTC = (date: Date): LocalDate => date.toISOString().slice(0, 10);

const asArray = (value: number | number[] | null | undefined): number[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];

/** 29 → [28, 29], 30 → [28, 29, 30], 31 → [28, 29, 30, 31] (dipakai bersama BYSETPOS=-1). */
const monthEndDays = (day: number) => Array.from({ length: day - 27 }, (_, i) => 28 + i);

/**
 * Ubah rule "tanggal N" (N = 29–31, atau 29 Feb tahunan) menjadi "tanggal N, atau hari terakhir
 * bulan itu bila tidak ada". Rule yang sudah memakai BYSETPOS dibiarkan.
 */
function clampToMonthEnd(options: Partial<Options>): Partial<Options> {
  if (options.bysetpos !== null && options.bysetpos !== undefined) return options;
  const days = asArray(options.bymonthday);
  if (days.length !== 1) return options;
  const day = days[0]!;
  const months = asArray(options.bymonth);
  const clamp =
    options.freq === RRule.MONTHLY
      ? day >= 29 && day <= 31
      : options.freq === RRule.YEARLY && day === 29 && months.length === 1 && months[0] === 2;
  return clamp ? { ...options, bymonthday: monthEndDays(day), bysetpos: [-1] } : options;
}

/** Hari dalam minggu untuk tanggal lokal, 0 = Senin. */
export const weekdayOf = (date: LocalDate) => (toUTC(date).getUTCDay() + 6) % 7;

/** Bangun string RRULE dari state editor. `anchor` = due_date (untuk bulanan/tahunan). */
export function buildRule(state: RecurrenceState, anchor: LocalDate): string | null {
  if (state.freq === 'none') return null;
  const interval = Math.max(1, Math.floor(state.interval) || 1);
  const anchorDate = toUTC(anchor);
  const opts: Partial<Options> = { interval };

  switch (state.freq) {
    case 'daily':
      opts.freq = RRule.DAILY;
      break;
    case 'weekdays':
      opts.freq = RRule.WEEKLY;
      opts.interval = 1;
      opts.byweekday = [0, 1, 2, 3, 4];
      break;
    case 'weekly':
      opts.freq = RRule.WEEKLY;
      opts.byweekday = (state.byDay.length ? state.byDay : [weekdayOf(anchor)]).toSorted();
      break;
    case 'monthly':
      opts.freq = RRule.MONTHLY;
      opts.bymonthday = [anchorDate.getUTCDate()];
      break;
    case 'yearly':
      opts.freq = RRule.YEARLY;
      opts.bymonth = [anchorDate.getUTCMonth() + 1];
      opts.bymonthday = [anchorDate.getUTCDate()];
      break;
  }
  if (state.until) opts.until = new Date(`${state.until}T23:59:59Z`);
  Object.assign(opts, clampToMonthEnd(opts));

  // Format kanonik: tanpa prefix "RRULE:", FREQ di depan (mis. FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH)
  const parts = RRule.optionsToString(opts)
    .replace(/^RRULE:/, '')
    .split(';');
  return [
    ...parts.filter((p) => p.startsWith('FREQ=')),
    ...parts.filter((p) => !p.startsWith('FREQ=')),
  ].join(';');
}

/** Parse string RRULE kembali ke state editor. String tak dikenal → 'none'. */
export function parseRule(rule: string | null | undefined): RecurrenceState {
  if (!rule) return NO_RECURRENCE;
  try {
    const o = RRule.parseString(rule.replace(/^RRULE:/, ''));
    const byDay = toWeekdayNumbers(o.byweekday);
    const interval = o.interval ?? 1;
    const until = o.until ? fromUTC(o.until) : null;

    switch (o.freq) {
      case RRule.DAILY:
        return { freq: 'daily', interval, byDay: [], until };
      case RRule.WEEKLY:
        if (interval === 1 && byDay.join() === '0,1,2,3,4')
          return { freq: 'weekdays', interval: 1, byDay, until };
        return { freq: 'weekly', interval, byDay, until };
      case RRule.MONTHLY:
        return { freq: 'monthly', interval, byDay: [], until };
      case RRule.YEARLY:
        return { freq: 'yearly', interval, byDay: [], until };
      default:
        return NO_RECURRENCE;
    }
  } catch {
    return NO_RECURRENCE;
  }
}

function toWeekdayNumbers(value: Options['byweekday'] | undefined): number[] {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((d) => (typeof d === 'number' ? d : d instanceof Weekday ? d.weekday : -1))
    .filter((d) => d >= 0)
    .toSorted();
}

function makeRule(rule: string, dtstart: LocalDate) {
  const options = clampToMonthEnd(RRule.parseString(rule.replace(/^RRULE:/, '')));
  return new RRule({ ...options, dtstart: toUTC(dtstart) });
}

/** Tanggal dalam bulan untuk rule bulanan (untuk deskripsi). Rule akhir-bulan → tanggal terbesar. */
function monthlyDay(rule: string | null | undefined, anchor?: LocalDate | null) {
  try {
    const days = asArray(RRule.parseString((rule ?? '').replace(/^RRULE:/, '')).bymonthday);
    if (days.length) return Math.max(...days);
  } catch {
    /* jatuh ke anchor */
  }
  return anchor ? Number(anchor.slice(8)) : '';
}

/** Kejadian berikutnya SETELAH `after` (eksklusif). null = seri berakhir. */
export function nextOccurrence(
  rule: string,
  dtstart: LocalDate,
  after: LocalDate,
): LocalDate | null {
  try {
    const next = makeRule(rule, dtstart).after(toUTC(after), false);
    return next ? fromUTC(next) : null;
  } catch {
    return null;
  }
}

/**
 * Tanggal jatuh tempo berikutnya saat tugas berulang diselesaikan.
 * Jika tugas sudah lama terlambat, lompat ke kejadian pertama mulai hari ini
 * (agar tidak menumpuk kejadian di masa lalu).
 */
export function nextDueAfterCompletion(
  rule: string,
  dueDate: LocalDate,
  today: LocalDate,
): LocalDate | null {
  const next = nextOccurrence(rule, dueDate, dueDate);
  if (next === null || next >= today) return next;
  return nextOccurrence(rule, dueDate, addLocalDays(today, -1));
}

/** Semua kejadian dalam [from, to] (inklusif). Dibatasi `limit` untuk keamanan. */
export function occurrencesBetween(
  rule: string,
  dtstart: LocalDate,
  from: LocalDate,
  to: LocalDate,
  limit = 400,
): LocalDate[] {
  try {
    const result: LocalDate[] = [];
    makeRule(rule, dtstart).between(toUTC(from), toUTC(to), true, (date) => {
      result.push(fromUTC(date));
      return result.length < limit;
    });
    return result;
  } catch {
    return [];
  }
}

/** Deskripsi bahasa Indonesia, mis. "Setiap minggu: Sen, Kam". */
export function describeRule(rule: string | null | undefined, anchor?: LocalDate | null): string {
  const s = parseRule(rule);
  if (s.freq === 'none') return 'Tidak berulang';

  const every = (unit: string) =>
    s.interval > 1 ? `Setiap ${s.interval} ${unit}` : `Setiap ${unit}`;
  let text: string;
  switch (s.freq) {
    case 'daily':
      text = every('hari');
      break;
    case 'weekdays':
      text = 'Setiap hari kerja';
      break;
    case 'weekly':
      text = `${every('minggu')}: ${s.byDay.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
      break;
    case 'monthly': {
      const day = monthlyDay(rule, anchor);
      text = `${every('bulan')} tgl ${day}${Number(day) > 28 ? ' (atau hari terakhir bulan)' : ''}`;
      break;
    }
    case 'yearly':
      text = anchor ? `${every('tahun')}, ${formatLocalDate(anchor, 'd MMM')}` : every('tahun');
      break;
  }
  return s.until ? `${text} · s.d. ${formatLocalDate(s.until, 'd MMM yyyy')}` : text;
}
