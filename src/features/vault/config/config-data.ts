import { useQuery } from '@powersync/react';
import { eq } from 'drizzle-orm';
import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { configFiles, configVersions, type ConfigFile, type ConfigFormat } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { decryptConfig, encryptConfig, type ConfigPayload } from '@/features/sandi/crypto';
import { currentKeyRef } from '@/features/sandi/sandi-store';
import { clip, LIMITS } from '@/lib/limits';

/**
 * Data berkas konfigurasi Vault. Metadata dibaca biasa; ISI tiap versi hanya bisa dibuka dengan
 * DEK brankas Sandi, jadi dekripsinya terpisah (`useDecryptedVersions`) dan hanya dipakai
 * komponen yang di-mount saat brankas terbuka.
 */

/**
 * ⚠️ Urutan versi: `datetime(created_at)`, BUKAN `created_at` mentah.
 *
 * Baris yang sudah tersinkron kembali dari server berformat `'YYYY-MM-DD HH:MM:SSZ'`, sedangkan
 * tulisan lokal berformat ISO `'…T…'`. Dibandingkan sebagai teks, spasi (0x20) selalu lebih kecil
 * dari `T` (0x54) — jadi dua versi pada TANGGAL yang sama akan terurut menurut status sinkronnya,
 * bukan menurut waktunya. `datetime()` menormalkan keduanya. `id` (UUIDv7, terurut waktu) menjadi
 * pemutus seri yang stabil.
 */
const VERSION_ORDER = 'datetime(created_at), id';

export interface ConfigFileRow extends ConfigFile {
  versions: number;
  latest_at: string | null;
  /** Nama project induk; null bila berkas tidak terikat project (atau project sudah dihapus). */
  project_name: string | null;
}

export interface ConfigFilter {
  search?: string;
  /** `null` = semua lingkungan. */
  environment?: string | null;
  projectId?: string | null;
}

export function useConfigFiles(f: ConfigFilter = {}) {
  const q = f.search?.trim().toLowerCase() ?? '';
  const { data, isLoading } = useQuery<ConfigFileRow>(
    `SELECT c.*,
            (SELECT COUNT(*) FROM config_versions v WHERE v.file_id = c.id)      AS versions,
            (SELECT MAX(datetime(v.created_at)) FROM config_versions v WHERE v.file_id = c.id) AS latest_at,
            p.name AS project_name
       FROM config_files c
       LEFT JOIN code_projects p ON p.id = c.project_id AND p.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
        AND (?1 = '' OR LOWER(c.name) LIKE '%' || ?1 || '%'
                     OR LOWER(COALESCE(c.environment, '')) LIKE '%' || ?1 || '%')
        AND (?2 IS NULL OR c.environment = ?2)
        AND (?3 IS NULL OR c.project_id = ?3)
      ORDER BY COALESCE(p.name, '') , c.name, COALESCE(c.environment, '')`,
    [q, f.environment ?? null, f.projectId ?? null],
  );
  return { files: data, isLoading };
}

export function useConfigFile(id: string | null) {
  const { data } = useQuery<ConfigFile>('SELECT * FROM config_files WHERE id = ?1', [id ?? '']);
  return data[0] ?? null;
}

/** Lingkungan yang sudah dipakai, untuk chip filter dan usulan saat membuat berkas. */
export function useConfigEnvironments() {
  const { data } = useQuery<{ environment: string; n: number }>(
    `SELECT environment, COUNT(*) AS n FROM config_files
      WHERE deleted_at IS NULL AND environment IS NOT NULL AND environment <> ''
      GROUP BY environment ORDER BY n DESC, environment`,
  );
  return data;
}

export interface VersionRow {
  id: string;
  enc: string;
  created_at: string;
  /** Nomor urut tampilan (1 = paling lama). Dihitung, tidak disimpan. */
  number: number;
}

/** Versi sebuah berkas, TERBARU LEBIH DULU, dengan nomor urut yang sudah dihitung. */
export function useConfigVersions(fileId: string | null) {
  const { data, isLoading } = useQuery<{ id: string; enc: string; created_at: string }>(
    `SELECT id, enc, created_at FROM config_versions WHERE file_id = ?1 ORDER BY ${VERSION_ORDER}`,
    [fileId ?? ''],
  );
  // Nomor dihitung dari urutan menaik, lalu dibalik supaya yang terbaru di atas
  const versions = useMemo<VersionRow[]>(
    () => data.map((r, i) => ({ ...r, number: i + 1 })).reverse(),
    [data],
  );
  return { versions, isLoading };
}

export interface DecryptedVersion extends VersionRow {
  payload: ConfigPayload;
}

/**
 * Mendekripsi versi di memori. Hanya dipakai komponen yang di-mount saat brankas TERBUKA, jadi
 * plaintext-nya ikut hilang begitu brankas dikunci (unmount). Versi yang tidak bisa dibuka
 * (ditulis dengan kunci brankas lain) dilaporkan di `failed`, tidak disembunyikan.
 */
export function useDecryptedVersions(
  fileId: string | null,
  versions: VersionRow[],
  dek: CryptoKey,
  userId: string,
) {
  const [state, setState] = useState<{
    dek: CryptoKey;
    fileId: string | null;
    items: DecryptedVersion[];
    failed: string[];
  } | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    void (async () => {
      const items: DecryptedVersion[] = [];
      const failed: string[] = [];
      for (const v of versions) {
        try {
          items.push({ ...v, payload: await decryptConfig(dek, userId, fileId, v.id, v.enc) });
        } catch {
          failed.push(v.id);
        }
      }
      if (!cancelled) setState({ dek, fileId, items, failed });
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, versions, dek, userId]);

  const current = state && state.dek === dek && state.fileId === fileId ? state : null;
  return {
    versions: current?.items ?? [],
    failed: current?.failed ?? [],
    ready: current !== null,
  };
}

// --------------------------------------------------------------------------- aksi
/** Huruf kecil & rapi, supaya "Production" dan "production" tidak jadi dua lingkungan. */
export function normalizeEnvironment(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, '-');
  return v === '' ? null : clip(v, LIMITS.configEnvironment);
}

export interface NewConfigFile {
  name: string;
  format: ConfigFormat;
  environment: string;
  projectId: string | null;
  text: string;
  note: string;
}

export function useConfigActions() {
  const { db } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const restore = async (id: string) => {
      await db
        .update(configFiles)
        .set(touch({ deleted_at: null }))
        .where(eq(configFiles.id, id));
    };

    return {
      /** Berkas baru + versi pertamanya dalam SATU transaksi: tidak ada berkas tanpa isi. */
      async createFile(dek: CryptoKey, v: NewConfigFile): Promise<string> {
        const file = withMeta(userId, {
          name: clip(v.name.trim(), LIMITS.configName),
          format: v.format,
          environment: normalizeEnvironment(v.environment),
          project_id: v.projectId,
          deleted_at: null,
        });
        const version = withMeta(userId, { file_id: file.id, enc: '', v: 1 });
        // id berkas DAN id versi dibuat dulu: keduanya bagian dari AAD
        const enc = await encryptConfig(
          dek,
          userId,
          file.id,
          version.id,
          { text: v.text, note: v.note.trim() },
          await currentKeyRef(dek),
        );
        await db.transaction(async (tx) => {
          await tx.insert(configFiles).values(file);
          await tx.insert(configVersions).values({ ...version, enc });
        });
        return file.id;
      },

      /**
       * Simpan versi BARU. Versi lama tidak pernah diubah atau dihapus — itu inti fiturnya,
       * jadi "pulihkan versi lama" pun menjadi versi baru.
       */
      async saveVersion(dek: CryptoKey, fileId: string, payload: ConfigPayload): Promise<string> {
        const row = withMeta(userId, { file_id: fileId, enc: '', v: 1 });
        const enc = await encryptConfig(
          dek,
          userId,
          fileId,
          row.id,
          { text: payload.text, note: payload.note.trim() },
          await currentKeyRef(dek),
        );
        await db.insert(configVersions).values({ ...row, enc });
        // `updated_at` berkas ikut bergerak agar daftar terurut masuk akal
        await db.update(configFiles).set(touch({})).where(eq(configFiles.id, fileId));
        return row.id;
      },

      async updateMeta(
        id: string,
        v: { name: string; environment: string; projectId: string | null },
      ) {
        await db
          .update(configFiles)
          .set(
            touch({
              name: clip(v.name.trim(), LIMITS.configName),
              environment: normalizeEnvironment(v.environment),
              project_id: v.projectId,
            }),
          )
          .where(eq(configFiles.id, id));
      },

      /** Hapus seluruh berkas (versi tidak bisa dihapus satu per satu). */
      async removeFile(id: string, name: string) {
        await db.update(configFiles).set(softDeleted()).where(eq(configFiles.id, id));
        toast(`"${name || 'Konfigurasi'}" dihapus`, {
          action: { label: 'Urungkan', onClick: () => restore(id) },
        });
      },
    };
  }, [db, userId]);
}
