// Tanpa impor apa pun (termasuk alias '@/'): diimpor juga oleh supabase/tests untuk memastikan
// angka & aturan ini SAMA dengan migrasi …_temp_files.sql dan supabase/functions/_shared/tempfiles.ts.

/** 1 GB untuk SEMUA berkas satu akun. */
export const TEMP_QUOTA_BYTES = 1024 ** 3;
/** Pesanan unggah (pending) ikut kuota selama ini; sama dengan temp_files_used_bytes(). */
export const PENDING_HOLD_MS = 2 * 3600_000;

export type ExpiryOption = '1h' | '1d' | '7d' | '30d' | 'never';

export const EXPIRY_CHOICES: { value: ExpiryOption; label: string }[] = [
  { value: '1h', label: '1 jam' },
  { value: '1d', label: '1 hari' },
  { value: '7d', label: '7 hari' },
  { value: '30d', label: '30 hari' },
  { value: 'never', label: 'Tanpa batas' },
];
export const DEFAULT_EXPIRY: ExpiryOption = '7d';

/** Token di path halaman publik `/unduh/<token>`; null bila bukan halaman unduh. */
export function shareTokenFromPath(pathname: string): string | null {
  const m = /^\/unduh\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return m ? m[1]! : null;
}

/**
 * Semua path di bawah `/unduh` adalah halaman publik — termasuk tautan yang terpotong/rusak saat
 * disalin. Penerima tautan tidak boleh mendarat di layar login aplikasi pribadi; mereka cukup
 * melihat "Berkas tidak tersedia".
 */
export const isPublicDownloadPath = (pathname: string) => /^\/unduh(\/|$)/.test(pathname);
