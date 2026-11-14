/**
 * Berkas publik (tempfile) — logika murni di sisi klien. Server adalah sumber kebenaran (kuota,
 * kedaluwarsa); fungsi di sini hanya untuk tampilan dan pemeriksaan awal yang ramah.
 * Angka HARUS sama dengan supabase/functions/_shared/tempfiles.ts dan migrasi …_temp_files.sql
 * (diuji di supabase/tests/migrations.test.ts).
 */
import type { TempFile } from '@/db/schema';
import { parseTimestamp } from '@/lib/date';

import { PENDING_HOLD_MS, TEMP_QUOTA_BYTES } from './tempfile-limits';

export {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  isPublicDownloadPath,
  PENDING_HOLD_MS,
  shareTokenFromPath,
  TEMP_QUOTA_BYTES,
  type ExpiryOption,
} from './tempfile-limits';

type Row = Pick<
  TempFile,
  'status' | 'expires_at' | 'deleted_at' | 'created_at' | 'size_bytes' | 'is_public'
>;

export const isExpired = (f: Pick<Row, 'expires_at'>, nowMs: number) =>
  f.expires_at !== null && parseTimestamp(f.expires_at).getTime() <= nowMs;

/** Masih memakan kuota? Aturan SAMA dengan public.temp_files_used_bytes(). */
export function countsTowardQuota(f: Row, nowMs: number): boolean {
  if (f.deleted_at !== null || isExpired(f, nowMs)) return false;
  return f.status === 'ready' || nowMs - parseTimestamp(f.created_at).getTime() < PENDING_HOLD_MS;
}

export function usedBytes(rows: Row[], nowMs: number): number {
  return rows.reduce((sum, f) => (countsTowardQuota(f, nowMs) ? sum + f.size_bytes : sum), 0);
}

export type TempFileState = 'ready' | 'pending' | 'expired';

export function fileState(f: Row, nowMs: number): TempFileState {
  if (isExpired(f, nowMs)) return 'expired';
  return f.status === 'ready' ? 'ready' : 'pending';
}

/** Tautan bisa dibagikan sekarang? */
export const isShareable = (f: Row, nowMs: number) =>
  f.is_public === 1 && fileState(f, nowMs) === 'ready';

/** Halaman publik di aplikasi ini: `/unduh/<token>`. */
export const shareUrl = (origin: string, token: string) =>
  `${origin.replace(/\/+$/, '')}/unduh/${token}`;

/** URL unduhan langsung (Edge Function, tanpa login) untuk token. */
export const directDownloadUrl = (supabaseUrl: string, token: string) =>
  `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/tempfiles/d/${token}`;

/** Sisa waktu sebagai "3 hari" / "5 jam" / "12 menit"; `null` = tanpa batas; `''` = sudah lewat. */
function timeLeft(expiresAt: string | null, nowMs: number): string | null {
  if (expiresAt === null) return null;
  const left = parseTimestamp(expiresAt).getTime() - nowMs;
  if (left <= 0) return '';
  // Pembulatan ke satuan terdekat: tepat setelah memilih "7 hari" tertulis 7 hari (bukan 6),
  // dan sisa 59,9 menit tertulis "60 menit"/"1 jam" (bukan "0 jam").
  if (left < 59.5 * 60_000) return `${Math.max(1, Math.ceil(left / 60_000))} menit`;
  if (left < 47.5 * 3600_000) return `${Math.round(left / 3600_000)} jam`;
  return `${Math.round(left / 86_400_000)} hari`;
}

/** "Kedaluwarsa dalam 3 hari" / "… 5 jam" / "… 12 menit" / "Tanpa batas waktu" / "Kedaluwarsa". */
export function expiryLabel(expiresAt: string | null, nowMs: number): string {
  const left = timeLeft(expiresAt, nowMs);
  if (left === null) return 'Tanpa batas waktu';
  return left === '' ? 'Kedaluwarsa' : `Kedaluwarsa dalam ${left}`;
}

/**
 * Versi ringkas untuk baris daftar ("Sisa 3 hari" / "Tanpa batas" / "Kedaluwarsa"). Label penuh
 * terlalu panjang di HP 360 px: metadata baris patah tiga dan pemisah "·" menggantung di ujung.
 */
export function expiryShort(expiresAt: string | null, nowMs: number): string {
  const left = timeLeft(expiresAt, nowMs);
  if (left === null) return 'Tanpa batas';
  return left === '' ? 'Kedaluwarsa' : `Sisa ${left}`;
}

/**
 * Pemeriksaan awal sebelum memesan tempat ke server. `pending` = byte berkas lain di antrean
 * unggah yang sama (belum tercatat di `rows`).
 */
export function quotaProblem(size: number, rows: Row[], nowMs: number, pending = 0): string | null {
  if (size <= 0) return 'Berkas kosong tidak bisa diunggah.';
  if (size > TEMP_QUOTA_BYTES) return 'Ukuran berkas melebihi 1 GB.';
  if (usedBytes(rows, nowMs) + pending + size > TEMP_QUOTA_BYTES)
    return 'Kuota 1 GB tidak cukup. Hapus berkas lain dulu.';
  return null;
}

/**
 * Hasil perubahan dari server lebih baru daripada salinan lokal sampai sinkron menyusul.
 * `overlay` = baris dari respons Edge Function; dipakai bila `updated_at`-nya lebih baru.
 */
export function mergeOverlay<T extends Pick<TempFile, 'id' | 'updated_at'>>(
  local: T[],
  overlay: Record<string, T | null>,
): T[] {
  const out: T[] = [];
  for (const row of local) {
    if (!(row.id in overlay)) {
      out.push(row);
      continue;
    }
    const o = overlay[row.id];
    if (o === undefined) {
      out.push(row);
      continue;
    }
    if (o === null) continue; // dihapus di server, sinkron belum menyusul
    out.push(
      parseTimestamp(o.updated_at).getTime() > parseTimestamp(row.updated_at).getTime() ? o : row,
    );
  }
  return out;
}

/** Entri overlay yang sudah tersusul sinkron (boleh dibuang). */
export function settledOverlayIds<T extends Pick<TempFile, 'id' | 'updated_at'>>(
  local: T[],
  overlay: Record<string, T | null>,
): string[] {
  const byId = new Map(local.map((r) => [r.id, r]));
  return Object.entries(overlay)
    .filter(([id, o]) => {
      const row = byId.get(id);
      if (o === null) return !row; // dihapus: tuntas begitu barisnya hilang dari lokal
      return (
        !!row && parseTimestamp(row.updated_at).getTime() >= parseTimestamp(o.updated_at).getTime()
      );
    })
    .map(([id]) => id);
}

const ERROR_MESSAGE: Record<string, string> = {
  TF001: 'Kuota 1 GB penuh. Hapus berkas lain dulu.',
  TF002: 'Berkas tidak ditemukan (mungkin sudah dihapus).',
  TF003: 'Berkas sudah kedaluwarsa.',
  TF004: 'Unggahan tidak lengkap. Coba unggah ulang.',
  TF005: 'Permintaan tidak valid.',
};
export const tempfileErrorMessage = (code: string | undefined, fallback: string) =>
  (code && ERROR_MESSAGE[code]) || fallback;

export type FileKind =
  'image' | 'video' | 'audio' | 'archive' | 'sheet' | 'code' | 'document' | 'other';

/** Jenis berkas untuk ikon (MIME dulu, lalu ekstensi). */
export function fileKind(mime: string, name: string): FileKind {
  const ext = name.includes('.') ? (name.split('.').pop()?.toLowerCase() ?? '') : '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (/zip|rar|7z|tar|gzip/.test(mime) || ['zip', 'rar', '7z', 'gz', 'tgz'].includes(ext))
    return 'archive';
  if (/sheet|excel|csv/.test(mime) || ['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['js', 'ts', 'tsx', 'json', 'py', 'sql', 'sh', 'html', 'css', 'md'].includes(ext))
    return 'code';
  if (mime.startsWith('text/') || mime === 'application/pdf' || ['doc', 'docx'].includes(ext))
    return 'document';
  return 'other';
}

/** Ekstensi program yang bisa dijalankan: halaman publik memberi peringatan. */
export const isExecutableName = (name: string) =>
  /\.(exe|msi|bat|cmd|com|scr|apk|appimage|dmg|pkg|sh|ps1|vbs|js|jar|lnk)$/i.test(name.trim());
