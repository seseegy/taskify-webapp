/**
 * Panggilan ke Edge Function `tempfiles`. Tabel `temp_files` hanya dibaca dari database lokal
 * (sinkron); SEMUA perubahan lewat sini, karena kuota dan pencabutan tautan harus berlaku di
 * server saat itu juga. Butuh internet.
 */
import type { TempFile } from '@/db/schema';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { tempfileErrorMessage, type ExpiryOption } from './tempfile-utils';

/** Baris dari server (boolean asli Postgres) → bentuk lokal SQLite (0/1, teks). */
export type ServerFile = Omit<TempFile, 'is_public' | 'size_bytes'> & {
  is_public: boolean;
  size_bytes: number | string;
};

export const toLocalRow = (f: ServerFile): TempFile => ({
  ...f,
  is_public: f.is_public ? 1 : 0,
  size_bytes: Number(f.size_bytes),
});

export class TempfileError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TempfileError';
    this.code = code;
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new TempfileError('Butuh koneksi internet.');
  const { data, error } = await supabase.functions.invoke<T>('tempfiles', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx
      ? await ctx.json().catch(() => null as { error?: string; code?: string } | null)
      : null;
    const d = detail as { error?: string; code?: string } | null;
    throw new TempfileError(tempfileErrorMessage(d?.code, d?.error ?? error.message), d?.code);
  }
  return data as T;
}

export async function createUpload(file: File, expiry: ExpiryOption) {
  const res = await call<{ file: ServerFile; uploadUrl: string }>({
    action: 'create',
    name: file.name,
    size: file.size,
    mime: file.type,
    expiry,
  });
  return { file: toLocalRow(res.file), uploadUrl: res.uploadUrl };
}

export const completeUpload = async (id: string) =>
  toLocalRow((await call<{ file: ServerFile }>({ action: 'complete', id })).file);

export interface TempFilePatch {
  name?: string;
  isPublic?: boolean;
  expiry?: ExpiryOption;
  /** Buat tautan baru; tautan lama langsung tidak berlaku. */
  regenerate?: true;
}

export const updateFile = async (id: string, patch: TempFilePatch) =>
  toLocalRow((await call<{ file: ServerFile }>({ action: 'update', id, ...patch })).file);

export const deleteFile = (id: string) => call<{ ok: true }>({ action: 'delete', id });

export const ownerDownloadUrl = async (id: string) =>
  (await call<{ url: string }>({ action: 'download', id })).url;

// ----------------------------------------------------------------------------- publik
export interface PublicFileInfo {
  file_name: string;
  mime_type: string;
  size_bytes: number;
  expires_at: string | null;
  created_at: string;
}

/**
 * Info berkas untuk halaman publik — TANPA login dan tanpa supabase-js (halaman ini tidak memuat
 * sesi siapa pun). null = tidak ada / sudah kedaluwarsa / tidak publik.
 */
export async function fetchPublicInfo(
  token: string,
  signal?: AbortSignal,
): Promise<PublicFileInfo | null> {
  const res = await fetch(`${env.supabaseUrl.replace(/\/+$/, '')}/functions/v1/tempfiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'info', token }),
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Server menjawab ${res.status}`);
  return (await res.json()) as PublicFileInfo;
}
