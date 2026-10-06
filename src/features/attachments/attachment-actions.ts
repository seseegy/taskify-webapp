/**
 * Lampiran (file di Cloudflare R2, metadata di tabel `attachments` yang disinkron).
 *
 * Alur upload (local-first):
 *   1. Baris `attachments` dibuat di SQLite lokal (status 'pending') → ikut antrean sync
 *   2. Minta presigned URL ke Edge Function `files`, PUT langsung ke R2 (dengan progres)
 *   3. Sukses → status 'uploaded' + file disimpan ke cache offline; gagal → 'failed' (bisa diulang)
 * Hapus: soft delete lokal (instan, bisa offline) + coba hapus objek di R2; sisanya dibersihkan cron.
 */
import { useQuery } from '@powersync/react';
import { and, eq, isNull } from 'drizzle-orm';
import { useMemo } from 'react';
import { create } from 'zustand';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { attachments, type Attachment, type EntityType } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { formatBytes } from '@/lib/bytes';
import { nowIso } from '@/lib/date';
import {
  compressImage,
  deleteCachedFile,
  deleteFromR2,
  fetchFileBlob,
  MAX_FILE_BYTES,
  putCachedFile,
  saveBlob,
  sha256Hex,
  storageKey,
  uploadToR2,
} from '@/lib/files';

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

export function useAttachmentActions() {
  const { db, powerSync } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const send = async (row: Pick<Attachment, 'id' | 'storage_key'>, file: File) => {
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
        await putCachedFile(row.id, file).catch(() => undefined);
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
        toast(aborted ? 'Upload dibatalkan' : e instanceof Error ? e.message : String(e), {
          tone: aborted ? 'default' : 'danger',
        });
        return false;
      } finally {
        setProgress(row.id, null);
      }
    };

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
        await db.insert(attachments).values(row);
        const ok = await send(row, file);
        if (ok) toast(`${file.name} terunggah`, { tone: 'success' });
        return row.id;
      },

      /** Ulangi upload yang gagal (file masih di memori sesi ini). */
      async retry(att: Attachment, file?: File) {
        const f = file ?? useUploads.getState().files[att.id];
        if (!f) return false;
        await db
          .update(attachments)
          .set(touch({ status: 'pending' as const }))
          .where(eq(attachments.id, att.id));
        return send(att, f);
      },

      cancel(id: string) {
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
