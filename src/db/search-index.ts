/**
 * Indeks pencarian global (SQLite FTS5, LOKAL saja — tidak disinkron).
 *
 * PowerSync menyimpan setiap tabel sebagai `ps_data__<tabel>(id, data JSON)` dan
 * mengekspos view di atasnya. Trigger di tabel internal itu menangkap SEMUA perubahan
 * (tulisan lokal maupun hasil sync), lalu memperbarui tabel virtual `search_index`.
 *
 * Baris yang soft-deleted (deleted_at terisi) dikeluarkan dari indeks.
 * Jika FTS5 tidak tersedia, pencarian otomatis memakai LIKE (lihat useGlobalSearch).
 *
 * Naikkan INDEX_VERSION setiap kali definisi kolom/trigger berubah → indeks dibangun ulang.
 */
import type { PowerSyncDatabase } from '@powersync/web';

const INDEX_VERSION = 1;

interface Source {
  table: string;
  type: string;
  /** Ekspresi SQL untuk judul & isi; `d` = kolom JSON data */
  title: string;
  body: string;
}

const j = (field: string) => `COALESCE(json_extract(d, '$.${field}'), '')`;

const SOURCES: Source[] = [
  { table: 'tasks', type: 'task', title: j('title'), body: j('notes') },
  {
    table: 'journal_entries',
    type: 'journal_entry',
    title: `COALESCE(json_extract(d, '$.title'), json_extract(d, '$.entry_date'), '')`,
    body: j('content'),
  },
  {
    table: 'transactions',
    type: 'transaction',
    title: j('title'),
    body: `${j('note')} || ' ' || COALESCE(json_extract(d, '$.amount'), '')`,
  },
  {
    table: 'snippets',
    type: 'snippet',
    title: j('title'),
    body: `${j('description')} || ' ' || ${j('code')}`,
  },
  { table: 'code_projects', type: 'code_project', title: j('name'), body: j('description') },
];

/** Ganti alias `d` dengan kolom JSON dari baris trigger. */
const sub = (expr: string, ref: string) => expr.replace(/\bd\b(?=,)/g, ref);

export async function setupSearchIndex(db: PowerSyncDatabase): Promise<boolean> {
  try {
    await db.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
         entity_type UNINDEXED, entity_id UNINDEXED, title, body,
         tokenize = 'unicode61 remove_diacritics 2')`,
    );
  } catch (e) {
    console.warn('[search] FTS5 tidak tersedia, memakai pencarian LIKE', e);
    return false;
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY, value TEXT)`);
  const row = await db.getOptional<{ value: string }>(
    `SELECT value FROM search_meta WHERE key = 'version'`,
  );
  const fresh = row?.value !== String(INDEX_VERSION);

  await db.writeTransaction(async (tx) => {
    for (const s of SOURCES) {
      const internal = `ps_data__${s.table}`;
      const name = `search_${s.table}`;
      if (fresh) {
        for (const op of ['ins', 'upd', 'del'])
          await tx.execute(`DROP TRIGGER IF EXISTS ${name}_${op}`);
      }
      const insert = (ref: string) => `
        INSERT INTO search_index (entity_type, entity_id, title, body)
        SELECT '${s.type}', ${ref}.id, ${sub(s.title, `${ref}.data`)}, ${sub(s.body, `${ref}.data`)}
         WHERE json_extract(${ref}.data, '$.deleted_at') IS NULL;`;
      const remove = (ref: string) =>
        `DELETE FROM search_index WHERE entity_type = '${s.type}' AND entity_id = ${ref}.id;`;

      await tx.execute(
        `CREATE TRIGGER IF NOT EXISTS ${name}_ins AFTER INSERT ON ${internal} BEGIN ${insert('NEW')} END`,
      );
      await tx.execute(
        `CREATE TRIGGER IF NOT EXISTS ${name}_upd AFTER UPDATE ON ${internal} BEGIN ${remove('OLD')} ${insert('NEW')} END`,
      );
      await tx.execute(
        `CREATE TRIGGER IF NOT EXISTS ${name}_del AFTER DELETE ON ${internal} BEGIN ${remove('OLD')} END`,
      );
    }

    if (fresh) {
      // Bangun ulang dari data yang sudah ada
      await tx.execute(`DELETE FROM search_index`);
      for (const s of SOURCES) {
        await tx.execute(
          `INSERT INTO search_index (entity_type, entity_id, title, body)
           SELECT '${s.type}', id, ${sub(s.title, 'data')}, ${sub(s.body, 'data')}
             FROM ps_data__${s.table} WHERE json_extract(data, '$.deleted_at') IS NULL`,
        );
      }
      await tx.execute(`INSERT OR REPLACE INTO search_meta (key, value) VALUES ('version', ?)`, [
        String(INDEX_VERSION),
      ]);
    }
  });
  return true;
}

/** "bayar list" → `"bayar"* "list"*` (semua kata harus ada, awalan cocok). */
export function toFtsQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null;
}
