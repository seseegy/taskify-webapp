/**
 * Tag global lintas modul (tabel `tags` + `taggings` polimorfik).
 * Nama tag unik secara case-insensitive — dijaga di sini, bukan dengan UNIQUE di DB
 * (constraint UNIQUE bisa membuang perubahan offline saat upload).
 */
import { useQuery } from '@powersync/react';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { useMemo } from 'react';
import { useDatabase } from '@/db/database-context';
import type { AppDatabase } from '@/db/database';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { taggings, tags, type EntityType } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { PALETTE_NAMES } from '@/lib/palette';

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

/** "#Kerja Penting" → "kerja-penting" (huruf kecil, tanpa spasi, maks. 50). */
export function normalizeTagName(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 50);
}

export function useAllTags() {
  const { data } = useQuery<TagRow>(
    `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM taggings g WHERE g.tag_id = t.id) AS count
       FROM tags t WHERE t.deleted_at IS NULL ORDER BY count DESC, t.name`,
  );
  return data;
}

export function useEntityTags(type: EntityType, id: string | null) {
  const { data } = useQuery<TagRow>(
    `SELECT t.id, t.name, t.color, 0 AS count FROM taggings g JOIN tags t ON t.id = g.tag_id
      WHERE g.entity_type = ?1 AND g.entity_id = ?2 AND t.deleted_at IS NULL ORDER BY t.name`,
    [type, id ?? ''],
  );
  return data;
}

/** Map entity_id → tag untuk satu jenis entitas (chip di daftar). */
export function useTagMap(type: EntityType) {
  const { data } = useQuery<{ entity_id: string; id: string; name: string; color: string | null }>(
    `SELECT g.entity_id, t.id, t.name, t.color FROM taggings g JOIN tags t ON t.id = g.tag_id
      WHERE g.entity_type = ?1 AND t.deleted_at IS NULL ORDER BY t.name`,
    [type],
  );
  return useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string | null }[]>();
    for (const r of data) map.set(r.entity_id, [...(map.get(r.entity_id) ?? []), r]);
    return map;
  }, [data]);
}

/** Cari tag berdasarkan nama; buat jika belum ada. Mengembalikan id sesuai urutan input. */
export async function ensureTags(
  db: AppDatabase,
  userId: string,
  names: string[],
): Promise<string[]> {
  const clean = [...new Set(names.map(normalizeTagName).filter(Boolean))];
  if (clean.length === 0) return [];
  const existing = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(isNull(tags.deleted_at), inArray(sql`lower(${tags.name})`, clean)));
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
  const total = (await db.select({ n: sql<number>`count(*)` }).from(tags))[0]?.n ?? 0;
  const ids: string[] = [];
  for (const [i, name] of clean.entries()) {
    let id = byName.get(name);
    if (!id) {
      const row = withMeta(userId, {
        name,
        color: PALETTE_NAMES[(total + i) % PALETTE_NAMES.length]!,
      });
      await db.insert(tags).values(row);
      id = row.id;
    }
    ids.push(id);
  }
  return ids;
}

export async function addTags(
  db: AppDatabase,
  userId: string,
  type: EntityType,
  entityId: string,
  tagIds: string[],
) {
  if (tagIds.length === 0) return;
  const current = await db
    .select({ tag_id: taggings.tag_id })
    .from(taggings)
    .where(and(eq(taggings.entity_type, type), eq(taggings.entity_id, entityId)));
  const have = new Set(current.map((c) => c.tag_id));
  for (const tagId of tagIds) {
    if (!have.has(tagId))
      await db
        .insert(taggings)
        .values(withMeta(userId, { tag_id: tagId, entity_type: type, entity_id: entityId }));
  }
}

export function useTagActions() {
  const { db } = useDatabase();
  const userId = useUser().id;

  return useMemo(
    () => ({
      /** Tambah tag (nama) ke entitas; tag baru dibuat otomatis. */
      async addByName(type: EntityType, entityId: string, names: string[]) {
        const ids = await ensureTags(db, userId, names);
        await addTags(db, userId, type, entityId, ids);
      },
      async remove(type: EntityType, entityId: string, tagId: string) {
        await db
          .delete(taggings)
          .where(
            and(
              eq(taggings.entity_type, type),
              eq(taggings.entity_id, entityId),
              eq(taggings.tag_id, tagId),
            ),
          );
      },
      async rename(tagId: string, name: string) {
        const clean = normalizeTagName(name);
        if (clean)
          await db
            .update(tags)
            .set(touch({ name: clean }))
            .where(eq(tags.id, tagId));
      },
      async setColor(tagId: string, color: string) {
        await db.update(tags).set(touch({ color })).where(eq(tags.id, tagId));
      },
      /** Hapus tag dari semua item. */
      async deleteTag(tagId: string) {
        await db.transaction(async (tx) => {
          await tx.delete(taggings).where(eq(taggings.tag_id, tagId));
          await tx.update(tags).set(softDeleted()).where(eq(tags.id, tagId));
        });
      },
    }),
    [db, userId],
  );
}
