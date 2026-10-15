import { addLocalDays, type LocalDate } from '@/lib/date';

// `plainExcerpt`, `wordCount`, dan `toggleChecklistLine` dipakai juga oleh Catatan → lihat
// `@/lib/markdown`. Di sini hanya yang khusus Jurnal.

/**
 * Streak = jumlah hari berturut-turut berjurnal, berakhir hari ini
 * (atau kemarin, supaya streak tidak "putus" sebelum sempat menulis hari ini).
 * `days` = tanggal unik, urut menurun.
 */
export function journalStreak(days: LocalDate[], today: LocalDate): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : addLocalDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = addLocalDays(cursor, -1);
  }
  return streak;
}

/** Ekspor semua jurnal menjadi satu file Markdown. */
export function journalToMarkdown(
  entries: { entry_date: string; title: string | null; content: string; mood: number | null }[],
  moodLabel: (m: number | null) => string,
): string {
  return entries
    .map((e) => {
      const head = `## ${e.entry_date}${e.title ? ` — ${e.title}` : ''}`;
      const mood = e.mood ? `\n_Mood: ${moodLabel(e.mood)}_\n` : '';
      return `${head}\n${mood}\n${e.content.trim()}\n`;
    })
    .join('\n---\n\n');
}
