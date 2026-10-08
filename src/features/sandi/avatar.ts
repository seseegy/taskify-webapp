/**
 * Avatar huruf untuk item sandi. Warna dipilih deterministik dari judul (judul sama → warna sama
 * di semua perangkat). Hanya seri 600–700 agar huruf putih tetap terbaca. Kelas ditulis penuh
 * supaya ikut dihasilkan Tailwind.
 */
const GRADIENTS = [
  'from-violet-600 to-indigo-600',
  'from-rose-600 to-pink-600',
  'from-teal-700 to-emerald-700',
  'from-sky-700 to-blue-700',
  'from-amber-700 to-orange-700',
  'from-fuchsia-600 to-purple-700',
] as const;

export function avatarGradient(seed: string): string {
  let h = 5381;
  for (const ch of seed.toLowerCase()) h = ((h << 5) + h + ch.codePointAt(0)!) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length]!;
}

/** Huruf/angka pertama yang bermakna, kapital; "?" bila kosong. */
export function avatarInitial(title: string): string {
  const m = title.trim().match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '?';
}
