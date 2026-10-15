/**
 * Batas panjang teks yang DITEGAKKAN Postgres lewat CHECK (supabase/migrations/…core_schema.sql).
 *
 * Kenapa perlu di client: tulisan dari form biasanya sudah dibatasi `maxLength`, tetapi jalur lain
 * (catat cepat, Bagikan ke Taskify, nama file) bisa menghasilkan teks lebih panjang. Baris itu
 * tersimpan lokal lalu DITOLAK server saat upload (kode 23514) dan masuk `upload_errors`,
 * jadi data hilang diam-diam. Memotong di sini mencegahnya.
 */
export const LIMITS = {
  taskTitle: 300,
  journalTitle: 200,
  noteTitle: 200,
  transactionTitle: 120,
  recurringTitle: 120,
  snippetTitle: 200,
  projectName: 120,
  counterparty: 100,
  configName: 120,
  configEnvironment: 40,
} as const;

/**
 * Potong ke `max` KARAKTER (code point, sama dengan `char_length` Postgres). Memakai `slice`
 * biasa bisa membelah pasangan surrogate (emoji) dan menghasilkan teks yang ditolak Postgres.
 */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value; // cepat: unit UTF-16 ≥ jumlah karakter
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}
