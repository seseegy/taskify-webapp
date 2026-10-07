/** Penjelasan singkat untuk kode error Postgres yang dianggap permanen (lihat connector.ts). */
export function explainErrorCode(code: string | null): string {
  if (!code) return 'Ditolak server';
  if (code === '23514')
    return 'Melanggar batas isian (mis. teks terlalu panjang atau nilai tidak valid)';
  if (code === '23503') return 'Mengacu ke data yang sudah tidak ada';
  if (code === '23502') return 'Ada isian wajib yang kosong';
  if (code === '23505') return 'Data dengan kunci yang sama sudah ada';
  if (code === '42501') return 'Ditolak izin akses (RLS)';
  if (code.startsWith('22')) return 'Format data tidak valid';
  return 'Ditolak server';
}
