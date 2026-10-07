/**
 * Lampiran (file di Cloudflare R2, metadata di tabel `attachments` yang disinkron).
 *
 * Alur upload (local-first):
 *   1. File disimpan ke Cache Storage perangkat DULU, baris `attachments` dibuat di SQLite lokal
 *      (status 'pending') → ikut antrean sync. Dengan begitu file tidak hilang saat offline/reload.
 *   2. Minta presigned URL ke Edge Function `files`, PUT langsung ke R2 (dengan progres)
 *   3. Sukses → status 'uploaded'; gagal → 'failed'. File diambil lagi dari cache untuk "Ulangi",
 *      dan `useAttachmentOutbox` mengulang otomatis saat perangkat kembali online.
 * Hapus: soft delete lokal (instan, bisa offline) + coba hapus objek di R2; sisanya dibersihkan cron.
 */
import { useQuery, useStatus } from '@powersync/react';
import { and, eq, isNull } from 'drizzle-orm';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { attachments, type Attachment, type AttachmentStatus, type EntityType } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { formatBytes } from '@/lib/bytes';
import { nowIso } from '@/lib/date';
import {
  compressImage,
  deleteCachedFile,
  deleteFromR2,
  fetchFileBlob,
  getCachedFile,
  MAX_FILE_BYTES,
  putCachedFile,
  saveBlob,
  sha256Hex,
  storageKey,
  uploadToR2,
} from '@/lib/files';
import { canAutoRetry, MAX_PER_RUN, withUploadLock, type AutoAttempt } from './upload-policy';

// --------------------------------------------------------------------------- progres upload
interface UploadState {
  progress: Record<string, number>;
  files: Record<string, File>;
  controllers: Record<string, AbortController>;
}
export const useUploads = create<UploadState>(() => ({ progress: {}, files: {}, controllers: {} }));

const setProgress = (id: string, value: number | null) =>
  useUploads.setState((s) => {
    const progress = { ...s.progress };
    if (value === null) delete progress[id];
    else progress[id] = value;
    return { progress };
  });

// --------------------------------------------------------------------------- query
export function useAttachments(type: EntityType, id: string | null) {
  const { data } = useQuery<Attachment>(
    `SELECT * FROM attachments WHERE entity_type = ?1 AND entity_id = ?2 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [type, id ?? ''],
  );
  return data;
}

export interface DuplicateInfo {
  file_name: string;
  version_label: string | null;
  entity_type: EntityType;
  entity_id: string;
}

// --------------------------------------------------------------------------- aksi
export interface UploadOptions {
  versionLabel?: string | null;
  note?: string | null;
  /** Perkecil gambar besar sebelum upload (default true) */
  compress?: boolean;
}

/** Lampiran yang unggahannya DIBATALKAN pengguna: jangan diulang otomatis oleh outbox. */
const userCancelled = new Set<string>();

export function useAttachmentActions() {
  const { db, powerSync } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const send = async (row: Pick<Attachment, 'id' | 'storage_key'>, file: File, quiet = false) => {
      const controller = new AbortController();
      useUploads.setState((s) => ({
        files: { ...s.files, [row.id]: file },
        controllers: { ...s.controllers, [row.id]: controller },
      }));
      setProgress(row.id, 0);
      try {
        await uploadToR2(row.storage_key, file, (f) => setProgress(row.id, f), controller.signal);
        await db
          .update(attachments)
          .set(touch({ status: 'uploaded' as const, uploaded_at: nowIso() }))
          .where(eq(attachments.id, row.id));
        useUploads.setState((s) => {
          const files = { ...s.files };
          delete files[row.id];
          return { files };
        });
        return true;
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        await db
          .update(attachments)
          .set(touch({ status: 'failed' as const }))
          .where(eq(attachments.id, row.id));
        if (!quiet) {
          if (aborted) toast('Upload dibatalkan');
          else if (!navigator.onLine)
            toast(
              'Tidak ada koneksi. File disimpan di perangkat dan diunggah otomatis saat online.',
            );
          else toast(e instanceof Error ? e.message : String(e), { tone: 'danger' });
        }
        return false;
      } finally {
        setProgress(row.id, null);
      }
    };

    /**
     * Satu percobaan unggah, dilindungi kunci antar-tab. Status dibaca ulang DI DALAM kunci:
     * jika tab lain sudah menyelesaikannya, jangan diturunkan kembali ke 'pending'.
     */
    const attempt = (
      att: Pick<Attachment, 'id' | 'storage_key'>,
      file: File,
      opts: { quiet?: boolean; markPending?: boolean } = {},
    ) =>
      withUploadLock(
        att.id,
        async () => {
          const current = await powerSync.getOptional<{
            status: AttachmentStatus;
            deleted_at: string | null;
          }>('SELECT status, deleted_at FROM attachments WHERE id = ?', [att.id]);
          if (!current || current.deleted_at) return false;
          if (current.status === 'uploaded') return true;
          userCancelled.delete(att.id);
          if (opts.markPending)
            await db
              .update(attachments)
              .set(touch({ status: 'pending' as const }))
              .where(eq(attachments.id, att.id));
          return send(att, file, opts.quiet);
        },
        false,
      );

    return {
      /** Cari file identik (SHA-256) milik user yang masih ada. */
      async findDuplicate(sha: string): Promise<DuplicateInfo | null> {
        return powerSync.getOptional<DuplicateInfo>(
          `SELECT file_name, version_label, entity_type, entity_id FROM attachments
            WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1`,
          [sha],
        );
      },

      hash: sha256Hex,

      async upload(type: EntityType, entityId: string, original: File, opts: UploadOptions = {}) {
        const file = opts.compress === false ? original : await compressImage(original);
        if (file.size > MAX_FILE_BYTES) {
          toast(`File terlalu besar (${formatBytes(file.size)}). Maksimal 100 MB.`, {
            tone: 'danger',
          });
          return null;
        }
        const sha = await sha256Hex(file);
        const row = withMeta(userId, {
          entity_type: type,
          entity_id: entityId,
          storage_key: '',
          file_name: file.name.slice(0, 255),
          mime_type: file.type || null,
          size_bytes: file.size,
          sha256: sha,
          version_label: opts.versionLabel?.trim() || null,
          note: opts.note?.trim() || null,
          status: 'pending' as const,
          uploaded_at: null,
        });
        row.storage_key = storageKey(userId, row.id, file.name);
        // Simpan salinan di perangkat SEBELUM mencoba mengunggah: jika offline/gagal/reload, file
        // masih ada untuk "Ulangi" & outbox. Gagal menyimpan (kuota) tidak menghalangi upload.
        await putCachedFile(row.id, file).catch(() => undefined);
        try {
          await db.insert(attachments).values(row);
        } catch (e) {
          await deleteCachedFile(row.id).catch(() => undefined); // jangan tinggalkan salinan yatim
          throw e;
        }
        const ok = await attempt(row, file);
        if (ok) toast(`${file.name} terunggah`, { tone: 'success' });
        return row.id;
      },

      /**
       * Ulangi upload yang gagal. File diambil dari memori sesi, atau dari cache perangkat
       * (bertahan setelah reload/tutup aplikasi). `quiet` = tanpa toast (untuk outbox otomatis).
       */
      async retry(att: Attachment, opts: { file?: File; quiet?: boolean } = {}) {
        const f = opts.file ?? useUploads.getState().files[att.id] ?? (await fileFromCache(att));
        if (!f) {
          if (!opts.quiet)
            toast('File aslinya tidak ada di perangkat ini. Hapus lalu unggah ulang.', {
              tone: 'danger',
            });
          return false;
        }
        return attempt(att, f, { quiet: opts.quiet, markPending: true });
      },

      cancel(id: string) {
        userCancelled.add(id);
        useUploads.getState().controllers[id]?.abort();
      },

      async remove(att: Attachment) {
        await db.update(attachments).set(softDeleted()).where(eq(attachments.id, att.id));
        await deleteCachedFile(att.id).catch(() => undefined);
        // Best effort — jika offline, objek dibersihkan cron harian
        await deleteFromR2(att.storage_key).catch(() => undefined);
      },

      async update(id: string, patch: { version_label?: string | null; note?: string | null }) {
        await db
          .update(attachments)
          .set(touch(patch))
          .where(and(eq(attachments.id, id), isNull(attachments.deleted_at)));
      },
    };
  }, [db, powerSync, userId]);
}

/** Unduh lampiran ke perangkat (dari cache atau R2). */
export async function downloadAttachment(
  att: Pick<Attachment, 'id' | 'storage_key' | 'file_name'>,
) {
  try {
    saveBlob(await fetchFileBlob(att.id, att.storage_key, att.file_name), att.file_name);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), { tone: 'danger' });
  }
}

/** Salinan file di Cache Storage perangkat ini (null jika tidak ada, mis. diunggah dari perangkat lain). */
async function fileFromCache(att: Pick<Attachment, 'id' | 'file_name' | 'mime_type'>) {
  const blob = await getCachedFile(att.id).catch(() => null);
  return blob ? new File([blob], att.file_name, { type: att.mime_type ?? blob.type }) : null;
}

const OUTBOX_INTERVAL_MS = 2 * 60_000;
/** Percobaan otomatis per lampiran: jumlah & waktu terakhir (jeda mencegah koneksi yang berkedip menghabiskannya). */
const autoAttempts = new Map<string, AutoAttempt>();

/**
 * Outbox lampiran: mengunggah otomatis lampiran yang belum terunggah (dibuat saat offline atau
 * gagal) begitu perangkat online & sync pertama selesai. Hanya memproses lampiran yang salinan
 * filenya ada di perangkat INI (baris dari perangkat lain tidak punya cache → dilewati).
 * Setiap lampiran dicoba maksimal 3 kali per sesi, dengan jeda minimal 1 menit, agar kegagalan
 * permanen atau koneksi yang berkedip tidak menghabiskan percobaan/berulang terus. Upload yang
 * DIBATALKAN pengguna tidak diulang. Pasang sekali di AppShell.
 */
export function useAttachmentOutbox() {
  const { powerSync } = useDatabase();
  const actions = useAttachmentActions();
  const { connected, hasSynced } = useStatus();

  useEffect(() => {
    if (!connected || !hasSynced) return;
    let alive = true;
    let running = false;

    const run = async () => {
      if (running) return;
      running = true;
      try {
        const rows = await powerSync.getAll<Attachment>(
          `SELECT * FROM attachments WHERE deleted_at IS NULL AND status <> 'uploaded'
            ORDER BY created_at`,
        );
        let handled = 0;
        for (const att of rows) {
          if (!alive || handled >= MAX_PER_RUN) break;
          if (userCancelled.has(att.id)) continue;
          if (useUploads.getState().progress[att.id] !== undefined) continue; // sedang diunggah
          const prev = autoAttempts.get(att.id);
          if (!canAutoRetry(prev, Date.now())) continue;
          // Baris dari perangkat lain tidak punya salinan di sini → dilewati (tanpa memakan jatah)
          if (!(await getCachedFile(att.id).catch(() => null))) continue;
          autoAttempts.set(att.id, { n: (prev?.n ?? 0) + 1, at: Date.now() });
          handled++;
          const ok = await actions.retry(att, { quiet: true });
          if (ok) toast(`${att.file_name} terunggah`, { tone: 'success' });
        }
      } catch (e) {
        console.error('[attachments] outbox gagal', e);
      } finally {
        running = false;
      }
    };

    void run();
    const timer = setInterval(() => void run(), OUTBOX_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [connected, hasSynced, powerSync, actions]);
}
