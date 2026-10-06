/**
 * Utilitas tanggal berbasis zona waktu aplikasi (default WIB / Asia/Jakarta).
 *
 * Aturan penting:
 *  - "Tanggal lokal" (tanpa jam) selalu string 'YYYY-MM-DD' → kolom `date` di DB.
 *  - Timestamp absolut selalu ISO UTC (`new Date().toISOString()`).
 *  - Jangan pernah memakai `new Date('2026-10-05')` untuk tanggal lokal: itu UTC tengah malam
 *    dan bisa bergeser 1 hari. Gunakan `parseLocalDate` di bawah.
 */
import { addDays, format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

export const APP_TIMEZONE = 'Asia/Jakarta';
export const WEEK_STARTS_ON = 1 as const; // Senin

export type LocalDate = string; // 'YYYY-MM-DD'

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Komponen tanggal & jam dari sebuah instant, dilihat dari zona waktu aplikasi. */
export function zonedParts(instant: Date = new Date()) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Tanggal hari ini di zona waktu aplikasi, mis. '2026-10-05'. */
export function todayLocal(instant: Date = new Date()): LocalDate {
  const { year, month, day } = zonedParts(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 'YYYY-MM-DD' → Date pada jam 00:00 waktu perangkat (aman untuk aritmetika kalender). */
export function parseLocalDate(value: LocalDate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Date (komponen lokal perangkat) → 'YYYY-MM-DD'. Pasangan dari `parseLocalDate`. */
export function toLocalDate(date: Date): LocalDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addLocalDays(value: LocalDate, amount: number): LocalDate {
  return toLocalDate(addDays(parseLocalDate(value), amount));
}

/** Format tampilan berbahasa Indonesia, mis. formatLocalDate('2026-10-05', 'EEEE, d MMMM') */
export function formatLocalDate(value: LocalDate, pattern = 'd MMMM yyyy'): string {
  return format(parseLocalDate(value), pattern, { locale: localeId });
}

/** Sapaan berdasarkan jam WIB. */
export function greeting(instant: Date = new Date()): string {
  const { hour } = zonedParts(instant);
  if (hour < 4) return 'Selamat malam';
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}

/**
 * Offset untuk SQLite saat mengubah timestamp UTC → tanggal lokal:
 *   date(created_at, '+7 hours')
 * WIB tetap UTC+7 tanpa daylight saving, jadi offset konstan aman.
 * Jika suatu saat zona waktu bisa diubah di pengaturan, hitung dari user_settings.timezone.
 */
export const SQLITE_TZ_MODIFIER = '+7 hours';

/** Timestamp ISO UTC untuk kolom created_at/updated_at/deleted_at. */
export const nowIso = () => new Date().toISOString();

const WIB_OFFSET_MS = 7 * 3600_000;

/**
 * Parse timestamp dari DB. PowerSync mengirim timestamptz sebagai
 * '2026-10-05 07:00:00Z' (spasi, bukan 'T'), sedangkan tulisan lokal memakai ISO.
 */
export function parseTimestamp(value: string): Date {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T'));
}

/** Tanggal + jam lokal WIB → ISO UTC. Tanpa jam = 00:00. */
export function localDateTimeToIso(date: LocalDate, time: string | null = null): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time ?? '00:00').split(':').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hh!, mm!) - WIB_OFFSET_MS).toISOString();
}

/** ISO UTC → { date, time } dalam WIB. */
export function isoToLocal(value: string): { date: LocalDate; time: string } {
  const { year, month, day, hour, minute } = zonedParts(parseTimestamp(value));
  return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}` };
}

/** 'YYYY-MM-01' bulan dari tanggal lokal. */
export const monthStart = (date: LocalDate): LocalDate => `${date.slice(0, 7)}-01`;

/** Tanggal terakhir bulan dari tanggal lokal. */
export function monthEnd(date: LocalDate): LocalDate {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${pad(last)}`;
}

/** Geser bulan: addMonthsLocal('2026-10-01', -1) → '2026-09-01' (selalu tgl 1). */
export function addMonthsLocal(date: LocalDate, amount: number): LocalDate {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + amount, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

/** Jumlah hari dalam bulan. */
export const daysInMonth = (date: LocalDate) => Number(monthEnd(date).slice(8));

/** Selisih hari kalender (b − a). */
export function diffLocalDays(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}

/** 'HH:MM:SS' / 'HH:MM' → 'HH:MM' */
export const shortTime = (time: string | null | undefined) => (time ? time.slice(0, 5) : '');

/** Normalisasi input jam → 'HH:MM:00' (sama dengan format kolom `time` Postgres). */
export const toDbTime = (time: string | null | undefined) =>
  time ? `${time.slice(0, 5)}:00` : null;

/** Label relatif: "Hari ini", "Besok", "Kemarin", "Rab, 8 Okt", "8 Okt 2027". */
export function relativeDayLabel(date: LocalDate, today: LocalDate = todayLocal()): string {
  const diff = diffLocalDays(today, date);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Besok';
  if (diff === -1) return 'Kemarin';
  if (date.slice(0, 4) !== today.slice(0, 4)) return formatLocalDate(date, 'd MMM yyyy');
  if (diff > 1 && diff < 7) return formatLocalDate(date, 'EEEE');
  return formatLocalDate(date, 'EEE, d MMM');
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export { localeId };
