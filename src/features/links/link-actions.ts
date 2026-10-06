/**
 * Tautan silang antar entitas (tabel `entity_links`). Tautan bersifat dua arah saat
 * ditampilkan: A→B juga muncul di B sebagai "tertaut dari A".
 */
import { useQuery } from '@powersync/react';
import { and, eq, or } from 'drizzle-orm';
import { useMemo } from 'react';
import { useDatabase } from '@/db/database-context';
import type { AppDatabase } from '@/db/database';
import { withMeta } from '@/db/mutations';
import { entityLinks, type EntityType } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { ENTITY_UNION, type EntityRef, type EntityRow } from '@/features/entities/entities';

export interface LinkedEntity extends EntityRow {
  link_id: string;
}

export function useEntityLinks(type: EntityType, id: string | null) {
  const { data } = useQuery<LinkedEntity>(
    `WITH entities AS (${ENTITY_UNION}),
          other AS (
            SELECT l.id AS link_id,
                   CASE WHEN l.source_type = ?1 AND l.source_id = ?2 THEN l.target_type ELSE l.source_type END AS type,
                   CASE WHEN l.source_type = ?1 AND l.source_id = ?2 THEN l.target_id ELSE l.source_id END AS id,
                   l.created_at
              FROM entity_links l
             WHERE (l.source_type = ?1 AND l.source_id = ?2) OR (l.target_type = ?1 AND l.target_id = ?2))
     SELECT o.link_id, e.type, e.id, e.title, e.subtitle, e.deleted_at
       FROM other o JOIN entities e ON e.type = o.type AND e.id = o.id
      ORDER BY o.created_at`,
    [type, id ?? ''],
  );
  return data;
}

/** Buat tautan jika belum ada (arah mana pun). */
export async function linkEntities(db: AppDatabase, userId: string, a: EntityRef, b: EntityRef) {
  if (a.type === b.type && a.id === b.id) return;
  const pair = (x: EntityRef, y: EntityRef) =>
    and(
      eq(entityLinks.source_type, x.type),
      eq(entityLinks.source_id, x.id),
      eq(entityLinks.target_type, y.type),
      eq(entityLinks.target_id, y.id),
    );
  const existing = await db
    .select({ id: entityLinks.id })
    .from(entityLinks)
    .where(or(pair(a, b), pair(b, a)));
  if (existing.length) return;
  await db.insert(entityLinks).values(
    withMeta(userId, {
      source_type: a.type,
      source_id: a.id,
      target_type: b.type,
      target_id: b.id,
    }),
  );
}

export function useLinkActions() {
  const { db } = useDatabase();
  const userId = useUser().id;
  return useMemo(
    () => ({
      link: (a: EntityRef, b: EntityRef) => linkEntities(db, userId, a, b),
      async unlink(linkId: string) {
        await db.delete(entityLinks).where(eq(entityLinks.id, linkId));
      },
    }),
    [db, userId],
  );
}
