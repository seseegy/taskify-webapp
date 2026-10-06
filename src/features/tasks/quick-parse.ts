/**
 * Parser input cepat berbahasa Indonesia.
 *   "Bayar listrik besok jam 9 !3"  → { title: 'Bayar listrik', due: besok, time: 09:00, prioritas 3 }
 *   "Rapat senin 14.30"             → Senin berikutnya, 14:30
 *   "Belanja lusa"                  → +2 hari
 * Token yang dikenali dihapus dari judul. Jika judul jadi kosong, input dianggap judul apa adanya.
 */
import { addLocalDays, type LocalDate } from '@/lib/date';
import { weekdayOf } from './recurrence';

export interface QuickParse {
  title: string;
  due_date?: LocalDate;
  due_time?: string; // 'HH:MM'
  priority?: number;
  tags?: string[];
}

const DAY_NAMES: Record<string, number> = {
  senin: 0,
  selasa: 1,
  rabu: 2,
  kamis: 3,
  jumat: 4,
  "jum'at": 4,
  sabtu: 5,
  minggu: 6,
  ahad: 6,
};

const pad = (n: number) => String(n).padStart(2, '0');

export function parseQuickAdd(input: string, today: LocalDate): QuickParse {
  let text = ` ${input.trim()} `;
  const result: Omit<QuickParse, 'title'> = {};

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean) => {
    const m = text.match(re);
    if (m && fn(m)) text = text.replace(m[0], ' ');
  };

  // Tag: #kerja
  const tags: string[] = [];
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, t: string) => {
    tags.push(t.toLowerCase());
    return ' ';
  });
  if (tags.length) result.tags = tags;

  // Prioritas: !1 !2 !3
  take(/\s!([1-3])(?=\s)/, (m) => ((result.priority = Number(m[1])), true));

  // Jam: "jam 9", "jam 14.30", "pukul 7:15", "14:30", "14.30"
  take(/\s(?:jam|pukul|pkl\.?)\s+(\d{1,2})(?:[.:](\d{2}))?(?=\s)/i, (m) => setTime(m[1], m[2]));
  if (!result.due_time) take(/\s(\d{1,2})[.:](\d{2})(?=\s)/, (m) => setTime(m[1], m[2]));

  // Tanggal relatif
  take(/\shari ini(?=\s)/i, () => ((result.due_date = today), true));
  take(/\sbesok(?=\s)/i, () => ((result.due_date = addLocalDays(today, 1)), true));
  take(/\slusa(?=\s)/i, () => ((result.due_date = addLocalDays(today, 2)), true));
  if (!result.due_date) {
    take(/\s(?:hari\s+)?(senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad)(?=\s)/i, (m) => {
      const target = DAY_NAMES[m[1]!.toLowerCase()];
      if (target === undefined) return false;
      // Hari bernama berikutnya (bukan hari ini)
      const diff = (target - weekdayOf(today) + 7) % 7 || 7;
      result.due_date = addLocalDays(today, diff);
      return true;
    });
  }

  // Jam tanpa tanggal → hari ini
  if (result.due_time && !result.due_date) result.due_date = today;

  const title = text.replace(/\s+/g, ' ').trim();
  return title ? { title, ...result } : { title: input.trim() };

  function setTime(h?: string, m?: string) {
    const hour = Number(h);
    const minute = Number(m ?? 0);
    if (hour > 23 || minute > 59) return false;
    result.due_time = `${pad(hour)}:${pad(minute)}`;
    return true;
  }
}
