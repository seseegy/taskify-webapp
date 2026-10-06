import { addLocalDays, type LocalDate } from '@/lib/date';

/** Hapus sintaks markdown untuk cuplikan di daftar. */
export function plainExcerpt(markdown: string, max = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+\.)\s*/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

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

/** Toggle checklist markdown di baris tertentu (1-based): "- [ ]" ↔ "- [x]". */
export function toggleChecklistLine(markdown: string, line: number): string {
  const lines = markdown.split('\n');
  const current = lines[line - 1];
  if (current === undefined) return markdown;
  lines[line - 1] = current.replace(
    /^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/,
    (_, prefix: string, mark: string) => `${prefix}[${mark === ' ' ? 'x' : ' '}]`,
  );
  return lines.join('\n');
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
