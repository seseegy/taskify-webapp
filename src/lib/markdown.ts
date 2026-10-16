/**
 * Helper teks Markdown yang dipakai lebih dari satu modul (Jurnal, Catatan).
 * Fungsi murni — tanpa DOM, jadi bisa diuji langsung (lihat markdown.test.ts).
 */

/**
 * Cuplikan teks polos dari Markdown, untuk baris daftar.
 *
 * Murah dipanggil berulang: hanya awal teks yang diproses (cuplikan maks. beberapa ratus karakter;
 * isi jurnal bisa ribuan), dan hasilnya di-cache per isi. Tanpa ini daftar Jurnal/Catatan
 * menjalankan 8 regex atas SELURUH isi setiap entri di setiap render (±100–350 ms per render
 * daftar, CPU 4× lebih lambat).
 */
const excerptCache = new Map<string, string>();
// Kunci = awal teks (maks. EXCERPT_SCAN karakter) → memori cache terbatas (±6 MB terburuk)
const EXCERPT_CACHE_MAX = 1500;
/** Cukup panjang untuk cuplikan setelah sintaks Markdown & blok kode dibuang. */
const EXCERPT_SCAN = 4000;

export function plainExcerpt(markdown: string, max = 160): string {
  const head = markdown.slice(0, EXCERPT_SCAN);
  const key = `${max}|${head}`;
  const hit = excerptCache.get(key);
  if (hit !== undefined) return hit;
  const out = computeExcerpt(head, max);
  if (excerptCache.size >= EXCERPT_CACHE_MAX) excerptCache.clear();
  excerptCache.set(key, out);
  return out;
}

function computeExcerpt(markdown: string, max: number): string {
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
