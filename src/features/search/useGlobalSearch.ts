import { useEffect, useState } from 'react';
import { useDatabase } from '@/db/database-context';
import { toFtsQuery } from '@/db/search-index';
import { ENTITY_UNION, type EntityRow } from '@/features/entities/entities';

export interface SearchHit extends EntityRow {
  /** Cuplikan dengan penanda ⟪…⟫ di kata yang cocok */
  snippet: string | null;
}

export interface TagHit {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

const MARK_OPEN = '⟪';
const MARK_CLOSE = '⟫';

/**
 * Pencarian global (debounce 120 ms). FTS5 jika tersedia (peringkat bm25, judul lebih berbobot),
 * fallback LIKE pada judul. Hanya entitas yang tidak di Sampah.
 */
export function useGlobalSearch(query: string, limit = 30) {
  const { powerSync, fts } = useDatabase();
  const [state, setState] = useState<{ query: string; hits: SearchHit[]; tags: TagHit[] }>({
    query: '',
    hits: [],
    tags: [],
  });
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const match = toFtsQuery(q);
        let hits: SearchHit[] = [];
        if (fts && match) {
          hits = await powerSync.getAll<SearchHit>(
            `WITH entities AS (${ENTITY_UNION}),
                  r AS (SELECT entity_type, entity_id,
                               snippet(search_index, 3, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 12) AS snippet,
                               bm25(search_index, 0.0, 0.0, 6.0, 1.0) AS rank
                          FROM search_index WHERE search_index MATCH ?1 ORDER BY rank LIMIT ?2)
             SELECT e.type, e.id, e.title, e.subtitle, e.deleted_at, r.snippet
               FROM r JOIN entities e ON e.type = r.entity_type AND e.id = r.entity_id
              WHERE e.deleted_at IS NULL ORDER BY r.rank`,
            [match, limit],
          );
        } else {
          hits = await powerSync.getAll<SearchHit>(
            `WITH entities AS (${ENTITY_UNION})
             SELECT type, id, title, subtitle, deleted_at, NULL AS snippet FROM entities
              WHERE deleted_at IS NULL AND LOWER(title) LIKE '%' || LOWER(?1) || '%'
              ORDER BY updated_at DESC LIMIT ?2`,
            [q, limit],
          );
        }
        const tags = await powerSync.getAll<TagHit>(
          `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM taggings g WHERE g.tag_id = t.id) AS count
             FROM tags t WHERE t.deleted_at IS NULL AND t.name LIKE '%' || LOWER(?1) || '%' ORDER BY count DESC LIMIT 5`,
          [q.replace(/^#/, '')],
        );
        if (alive) setState({ query: q, hits, tags });
      } catch (e) {
        console.error('[search]', e);
        if (alive) setState({ query: q, hits: [], tags: [] });
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, limit, fts, powerSync]);

  const ready = q !== '' && state.query === q;
  return { hits: q ? state.hits : [], tags: q ? state.tags : [], ready, fts };
}

/** Pecah cuplikan menjadi bagian biasa & sorotan. */
export function splitSnippet(snippet: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  const re = new RegExp(`${MARK_OPEN}(.*?)${MARK_CLOSE}`, 'g');
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), hit: false });
    parts.push({ text: m[1]!, hit: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts;
}
