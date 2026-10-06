import { and, eq, inArray, or } from 'drizzle-orm';
import type { AppDatabase } from './database';
import { entityLinks, taggings, type EntityType } from './schema';

type Writer = Pick<AppDatabase, 'delete'>;

/**
 * Hapus referensi polimorfik (tag & tautan) milik entitas yang dihapus PERMANEN.
 * taggings/entity_links tidak punya foreign key ke tabel entitas, jadi harus dibersihkan manual.
 */
export async function deleteEntityRefs(db: Writer, type: EntityType, ids: string[]) {
  if (ids.length === 0) return;
  await db
    .delete(taggings)
    .where(and(eq(taggings.entity_type, type), inArray(taggings.entity_id, ids)));
  await db
    .delete(entityLinks)
    .where(
      or(
        and(eq(entityLinks.source_type, type), inArray(entityLinks.source_id, ids)),
        and(eq(entityLinks.target_type, type), inArray(entityLinks.target_id, ids)),
      ),
    );
}
