/**
 * Helper teks Markdown yang dipakai lebih dari satu modul (Jurnal, Catatan).
 * Fungsi murni — tanpa DOM, jadi bisa diuji langsung (lihat markdown.test.ts).
 */

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
