import { useQuery } from '@powersync/react';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { TempFile } from '@/db/schema';
import { putWithProgress } from '@/lib/files';
import { newId } from '@/lib/id';
import {
  completeUpload,
  createUpload,
  deleteFile,
  TempfileError,
  updateFile,
  type TempFilePatch,
} from './tempfile-api';
import { mergeOverlay, settledOverlayIds, type ExpiryOption } from './tempfile-utils';

/**
 * Unggahan yang sedang berjalan + hasil perubahan dari server yang belum tiba lewat sinkron.
 * Dipegang di store modul (bukan state halaman) supaya unggahan tetap jalan saat pengguna
 * berpindah halaman di dalam aplikasi.
 */
export interface UploadJob {
  /** id lokal (bukan id berkas) */
  key: string;
  name: string;
  size: number;
  progress: number;
  phase: 'reserving' | 'uploading' | 'verifying' | 'done' | 'failed' | 'cancelled';
  error?: string;
  /** id berkas di server setelah dipesan */
  fileId?: string;
  abort: AbortController;
}

interface State {
  jobs: UploadJob[];
  /** Baris terbaru dari server per id; null = sudah dihapus di server. */
  overlay: Record<string, TempFile | null>;
  patchJob: (key: string, patch: Partial<UploadJob>) => void;
  dropJob: (key: string) => void;
  setOverlay: (id: string, row: TempFile | null) => void;
  clearOverlay: (ids: string[]) => void;
}

export const useTempFileStore = create<State>((set) => ({
  jobs: [],
  overlay: {},
  patchJob: (key, patch) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.key === key ? { ...j, ...patch } : j)) })),
  dropJob: (key) => set((s) => ({ jobs: s.jobs.filter((j) => j.key !== key) })),
  setOverlay: (id, row) => set((s) => ({ overlay: { ...s.overlay, [id]: row } })),
  clearOverlay: (ids) =>
    set((s) => {
      const overlay = { ...s.overlay };
      for (const id of ids) delete overlay[id];
      return { overlay };
    }),
}));

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Unggah satu berkas: pesan tempat (kuota) → PUT ke R2 → periksa ukuran di server. */
export async function startUpload(file: File, expiry: ExpiryOption): Promise<void> {
  const store = useTempFileStore.getState();
  const job: UploadJob = {
    key: newId(),
    name: file.name,
    size: file.size,
    progress: 0,
    phase: 'reserving',
    abort: new AbortController(),
  };
  useTempFileStore.setState((s) => ({ jobs: [job, ...s.jobs] }));
  const patch = (p: Partial<UploadJob>) => useTempFileStore.getState().patchJob(job.key, p);

  try {
    const { file: reserved, uploadUrl } = await createUpload(file, expiry);
    store.setOverlay(reserved.id, reserved);
    patch({ fileId: reserved.id, phase: 'uploading' });
    if (job.abort.signal.aborted) throw new DOMException('Dibatalkan', 'AbortError');
    await putWithProgress(uploadUrl, file, (f) => patch({ progress: f }), job.abort.signal);
    patch({ phase: 'verifying', progress: 1 });
    // Jaringan putus tepat setelah PUT selesai: ulangi pemeriksaan beberapa kali
    let ready: TempFile | null = null;
    for (let attempt = 0; attempt < 3 && !ready; attempt++) {
      try {
        ready = await completeUpload(reserved.id);
      } catch (e) {
        if (attempt === 2 || (e instanceof TempfileError && e.code && e.code !== 'TF004')) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    store.setOverlay(reserved.id, ready);
    patch({ phase: 'done' });
    setTimeout(() => useTempFileStore.getState().dropJob(job.key), 4000);
  } catch (e) {
    const current = useTempFileStore.getState().jobs.find((j) => j.key === job.key);
    if (isAbort(e)) {
      patch({ phase: 'cancelled' });
      // Bebaskan kuota yang sudah dipesan
      if (current?.fileId) await removeFile(current.fileId).catch(() => undefined);
      setTimeout(() => useTempFileStore.getState().dropJob(job.key), 2500);
      return;
    }
    patch({ phase: 'failed', error: e instanceof Error ? e.message : 'Gagal mengunggah.' });
    // PUT tidak selesai: pesanan tidak berguna dan memakan kuota selama 2 jam → lepaskan.
    // (Gagal saat MEMERIKSA tidak dilepas: objeknya mungkin sudah lengkap di server.)
    if (current?.fileId && current.phase === 'uploading')
      await removeFile(current.fileId).catch(() => undefined);
  }
}

export function cancelUpload(key: string) {
  useTempFileStore
    .getState()
    .jobs.find((j) => j.key === key)
    ?.abort.abort();
}

export async function changeFile(id: string, patch: TempFilePatch): Promise<TempFile> {
  const row = await updateFile(id, patch);
  useTempFileStore.getState().setOverlay(id, row);
  return row;
}

export async function removeFile(id: string): Promise<void> {
  await deleteFile(id);
  useTempFileStore.getState().setOverlay(id, null);
}

/**
 * Daftar berkas dari database lokal (sinkron), digabung dengan hasil server yang lebih baru.
 * Overlay yang sudah tersusul sinkron dibuang otomatis.
 */
export function useTempFiles() {
  const { data, isLoading } = useQuery<TempFile>(
    `SELECT * FROM temp_files WHERE deleted_at IS NULL
      ORDER BY datetime(created_at) DESC, id DESC`,
  );
  const overlay = useTempFileStore((s) => s.overlay);
  const clearOverlay = useTempFileStore((s) => s.clearOverlay);

  // Berkas yang baru dipesan/diunggah belum ada di lokal → tampilkan dari overlay dulu
  const files = useMemo(() => {
    const merged = mergeOverlay(data, overlay);
    const known = new Set(data.map((r) => r.id));
    const fresh = Object.values(overlay).filter(
      (o): o is TempFile => o !== null && !known.has(o.id) && o.deleted_at === null,
    );
    return [...fresh, ...merged];
  }, [data, overlay]);

  useEffect(() => {
    const settled = settledOverlayIds(data, overlay);
    if (settled.length) clearOverlay(settled);
  }, [data, overlay, clearOverlay]);

  return { files, isLoading };
}
