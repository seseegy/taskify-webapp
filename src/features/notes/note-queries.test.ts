import { DatabaseSync } from 'node:sqlite';
import type { PowerSyncDatabase } from '@powersync/web';
import { describe, expect, it } from 'vitest';
import { setupSearchIndex, toFtsQuery } from '@/db/search-index';
import { CALENDAR_ACTIVITY_SQL } from '@/features/calendar/useCalendarActivity';
import { ENTITY_UNION } from '@/features/entities/entities';
import { SQLITE_TZ_MODIFIER } from '@/lib/date';
import { escapeLike, type NoteScope } from './note-utils';
import { NOTE_COUNTS_SQL, NOTES_ON_DATE_SQL, NOTES_SQL } from './note-queries';

/** SQLite sungguhan dengan skema `notes` (kolom sama dengan schema.ts / PowerSync view). */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE notes (
    id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
    note_date TEXT, title TEXT, content TEXT NOT NULL, is_pinned INTEGER NOT NULL)`);
  let seq = 0;
  const add = (
    id: string,
    o: {
      date?: string | null;
      title?: string | null;
      content?: string;
      pinned?: number;
      deleted?: string | null;
      created?: string;
    } = {},
  ) =>
    db
      .prepare(`INSERT INTO notes VALUES (?, 'u', ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        o.created ?? `2026-10-0${1 + (seq++ % 9)}T00:00:00Z`,
        '2026-10-01T00:00:00Z',
        o.deleted ?? null,
        o.date ?? null,
        o.title ?? null,
        o.content ?? 'isi',
        o.pinned ?? 0,
      );
  const list = (scope: NoteScope = 'all', search = '', trash = false) =>
    (
      db.prepare(NOTES_SQL).all(trash ? 1 : 0, scope, escapeLike(search.trim().toLowerCase())) as {
        id: string;
      }[]
    ).map((r) => r.id);
  return { db, add, list };
}

describe('NOTES_SQL (daftar catatan)', () => {
  it('urutan: disematkan dulu, lalu bertanggal (terbaru dulu), catatan bebas paling bawah', () => {
    const { add, list } = makeDb();
    add('bebas', { date: null });
    add('lama', { date: '2026-09-01' });
    add('baru', { date: '2026-10-07' });
    add('pin-bebas', { date: null, pinned: 1 });
    expect(list()).toEqual(['pin-bebas', 'baru', 'lama', 'bebas']);
  });

  it('di satu tanggal yang sama, yang dibuat terakhir tampil lebih dulu', () => {
    const { add, list } = makeDb();
    add('pagi', { date: '2026-10-07', created: '2026-10-07T01:00:00Z' });
    add('malam', { date: '2026-10-07', created: '2026-10-07T14:00:00Z' });
    expect(list()).toEqual(['malam', 'pagi']);
  });

  it('filter jenis: Bertanggal vs Bebas saling lepas, Semua gabungan', () => {
    const { add, list } = makeDb();
    add('d1', { date: '2026-10-01' });
    add('f1', { date: null });
    expect(list('dated')).toEqual(['d1']);
    expect(list('free')).toEqual(['f1']);
    expect(list('all').sort()).toEqual(['d1', 'f1']);
  });

  it('Sampah terpisah dari daftar utama', () => {
    const { add, list } = makeDb();
    add('hidup');
    add('terhapus', { deleted: '2026-10-05T00:00:00Z' });
    expect(list('all', '', false)).toEqual(['hidup']);
    expect(list('all', '', true)).toEqual(['terhapus']);
  });

  it('pencarian: judul & isi, tanpa beda huruf besar/kecil, digabung dengan filter jenis', () => {
    const { add, list } = makeDb();
    add('a', { title: 'Rapat Mingguan', content: 'bahas target', date: '2026-10-01' });
    add('b', { title: null, content: 'ide RAPAT baru', date: null });
    add('c', { title: 'Belanja', content: 'susu' });
    expect(list('all', 'rapat').sort()).toEqual(['a', 'b']);
    expect(list('free', 'rapat')).toEqual(['b']);
    expect(list('dated', 'rapat')).toEqual(['a']);
    expect(list('all', 'tidak-ada')).toEqual([]);
  });

  it('pencarian "%" dan "_" dibaca apa adanya (tidak cocok dengan semua)', () => {
    const { add, list } = makeDb();
    add('diskon', { content: 'diskon 50% hari ini' });
    add('berkas', { content: 'nama_file.txt' });
    add('biasa', { content: 'tidak ada simbol' });
    expect(list('all', '%')).toEqual(['diskon']);
    expect(list('all', '_')).toEqual(['berkas']);
    expect(list('all', '\\')).toEqual([]);
  });

  it('judul NULL tidak membuat pencarian di isi gagal', () => {
    const { add, list } = makeDb();
    add('x', { title: null, content: 'kata-kunci' });
    expect(list('all', 'kata-kunci')).toEqual(['x']);
  });
});

describe('query pendukung', () => {
  it('NOTES_ON_DATE_SQL: hanya tanggal itu, yang hidup, disematkan dulu', () => {
    const { db, add } = makeDb();
    add('a', { date: '2026-10-07', created: '2026-10-07T01:00:00Z' });
    add('pin', { date: '2026-10-07', pinned: 1, created: '2026-10-07T09:00:00Z' });
    add('lain', { date: '2026-10-08' });
    add('bebas', { date: null });
    add('sampah', { date: '2026-10-07', deleted: '2026-10-09T00:00:00Z' });
    const ids = (db.prepare(NOTES_ON_DATE_SQL).all('2026-10-07') as { id: string }[]).map(
      (r) => r.id,
    );
    expect(ids).toEqual(['pin', 'a']);
  });

  it('NOTE_COUNTS_SQL: total, bertanggal, disematkan — hanya yang hidup', () => {
    const { db, add } = makeDb();
    add('a', { date: '2026-10-07', pinned: 1 });
    add('b', { date: null });
    add('c', { date: '2026-10-08', deleted: '2026-10-09T00:00:00Z', pinned: 1 });
    expect(db.prepare(NOTE_COUNTS_SQL).get()).toMatchObject({ total: 2, dated: 1, pinned: 1 });
  });

  it('NOTE_COUNTS_SQL pada tabel kosong menghasilkan nol (bukan NULL)', () => {
    const { db } = makeDb();
    expect(db.prepare(NOTE_COUNTS_SQL).get()).toMatchObject({ total: 0, dated: 0, pinned: 0 });
  });
});

describe('CALENDAR_ACTIVITY_SQL', () => {
  const run = (db: DatabaseSync) =>
    Object.fromEntries(
      (
        db.prepare(CALENDAR_ACTIVITY_SQL).all('2026-10-01', '2026-10-31', SQLITE_TZ_MODIFIER) as {
          day: string;
          kind: string;
          count: number;
        }[]
      ).map((r) => [`${r.day}:${r.kind}`, r.count]),
    );

  it('catatan dihitung per hari bila bertanggal; bebas, Sampah, dan di luar rentang tidak', () => {
    const { db, add } = makeDb();
    db.exec(`
      CREATE TABLE journal_entries (id TEXT, entry_date TEXT, mood INTEGER, deleted_at TEXT);
      CREATE TABLE transactions (id TEXT, occurred_on TEXT, kind TEXT, amount INTEGER, debt_id TEXT, deleted_at TEXT);
      CREATE TABLE snippets (id TEXT, created_at TEXT, deleted_at TEXT);
      CREATE TABLE code_projects (id TEXT, created_at TEXT, deleted_at TEXT);
      CREATE TABLE attachments (id TEXT, entity_type TEXT, created_at TEXT, deleted_at TEXT);
    `);
    add('a', { date: '2026-10-07' });
    add('b', { date: '2026-10-07' });
    add('bebas', { date: null });
    add('sampah', { date: '2026-10-07', deleted: '2026-10-09T00:00:00Z' });
    add('luar', { date: '2026-11-02' });
    expect(run(db)).toEqual({ '2026-10-07:notes': 2 });
  });

  it('transaksi: hanya pemasukan/pengeluaran biasa — transfer & transaksi hutang tidak dihitung', () => {
    const { db } = makeDb();
    db.exec(`
      CREATE TABLE journal_entries (id TEXT, entry_date TEXT, mood INTEGER, deleted_at TEXT);
      CREATE TABLE transactions (id TEXT, occurred_on TEXT, kind TEXT, amount INTEGER, debt_id TEXT, deleted_at TEXT);
      CREATE TABLE snippets (id TEXT, created_at TEXT, deleted_at TEXT);
      CREATE TABLE code_projects (id TEXT, created_at TEXT, deleted_at TEXT);
      CREATE TABLE attachments (id TEXT, entity_type TEXT, created_at TEXT, deleted_at TEXT);
      INSERT INTO transactions VALUES ('makan', '2026-10-07', 'expense', 25000, NULL, NULL);
      INSERT INTO transactions VALUES ('gaji', '2026-10-07', 'income', 5000000, NULL, NULL);
      INSERT INTO transactions VALUES ('pinjamkan', '2026-10-07', 'expense', 100000, 'hutang-1', NULL);
      INSERT INTO transactions VALUES ('pelunasan', '2026-10-07', 'income', 100000, 'hutang-1', NULL);
      INSERT INTO transactions VALUES ('pindah', '2026-10-07', 'transfer', 70000, NULL, NULL);
      INSERT INTO transactions VALUES ('sampah', '2026-10-07', 'expense', 9, NULL, '2026-10-08T00:00:00Z');
    `);
    const rows = db
      .prepare(CALENDAR_ACTIVITY_SQL)
      .all('2026-10-01', '2026-10-31', SQLITE_TZ_MODIFIER) as {
      day: string;
      kind: string;
      count: number;
      amount: number;
    }[];
    expect(
      Object.fromEntries(rows.map((r) => [`${r.day}:${r.kind}`, [r.count, r.amount]])),
    ).toEqual({ '2026-10-07:expense': [1, 25000], '2026-10-07:income': [1, 5000000] });
  });
});

describe('ENTITY_UNION (judul untuk pencarian, Tag, Tautan)', () => {
  const titleOf = (db: DatabaseSync, id: string) =>
    (
      db
        .prepare(
          `WITH entities AS (
             SELECT 'note' AS type, id, COALESCE(NULLIF(title, ''), NULLIF(substr(content, 1, 80), ''), 'Catatan') AS title,
                    note_date AS subtitle, deleted_at, updated_at FROM notes)
           SELECT title FROM entities WHERE id = ?`,
        )
        .get(id) as { title: string }
    ).title;

  it('potongan SQL catatan di ENTITY_UNION benar-benar ada dan sama dengan yang diuji', () => {
    expect(ENTITY_UNION).toContain(
      "SELECT 'note', id, COALESCE(NULLIF(title, ''), NULLIF(substr(content, 1, 80), ''), 'Catatan'), note_date",
    );
  });

  it('judul: judul sendiri → awal isi → "Catatan" (bukan string kosong)', () => {
    const { db, add } = makeDb();
    add('t', { title: 'Judul', content: 'isi' });
    add('k', { title: '', content: 'hanya isi' });
    add('kosong', { title: null, content: '' });
    expect(titleOf(db, 't')).toBe('Judul');
    expect(titleOf(db, 'k')).toBe('hanya isi');
    expect(titleOf(db, 'kosong')).toBe('Catatan');
  });
});

describe('indeks pencarian global (setupSearchIndex) untuk catatan', () => {
  /** Adaptor minimal: meniru ps_data__notes + API PowerSync yang dipakai setupSearchIndex. */
  function makeIndex() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE ps_data__notes (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    for (const t of ['tasks', 'journal_entries', 'transactions', 'snippets', 'code_projects'])
      sqlite.exec(`CREATE TABLE ps_data__${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    const adapter = {
      execute: async (sql: string, p: unknown[] = []) =>
        void sqlite.prepare(sql).run(...(p as never[])),
      getOptional: async (sql: string, p: unknown[] = []) =>
        sqlite.prepare(sql).get(...(p as never[])) ?? null,
      writeTransaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({ execute: adapter.execute });
      },
    };
    // Tulisan lokal PowerSync (view → INSTEAD OF trigger) berupa INSERT lalu UPDATE pada
    // ps_data__*. UPSERT di sini menjalankan jalur UPDATE yang sama. Sengaja BUKAN
    // `INSERT OR REPLACE`: itu jalur sync dari server dan pemicu DELETE tidak ikut berjalan
    // di SQLite bawaan (lihat catatan di laporan; berlaku untuk semua modul, bukan hanya Catatan).
    const put = (id: string, row: Record<string, unknown>) =>
      sqlite
        .prepare(
          `INSERT INTO ps_data__notes VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        )
        .run(id, JSON.stringify(row));
    const search = (q: string) =>
      (
        sqlite
          .prepare(
            `SELECT entity_id FROM search_index WHERE entity_type = 'note' AND search_index MATCH ?`,
          )
          .all(toFtsQuery(q)!) as { entity_id: string }[]
      ).map((r) => r.entity_id);
    return { sqlite, adapter: adapter as unknown as PowerSyncDatabase, put, search };
  }

  it('catatan baru, diubah, di-soft-delete, dan dihapus mengikuti indeks lewat pemicu', async () => {
    const { sqlite, adapter, put, search } = makeIndex();
    expect(await setupSearchIndex(adapter)).toBe(true);

    put('n1', { title: 'Rencana Liburan', content: 'tiket pesawat ke Bali', deleted_at: null });
    expect(search('liburan')).toEqual(['n1']); // judul
    expect(search('bali')).toEqual(['n1']); // isi

    put('n1', { title: 'Rencana Liburan', content: 'ganti tujuan ke Lombok', deleted_at: null });
    expect(search('bali')).toEqual([]); // isi lama hilang dari indeks
    expect(search('lombok')).toEqual(['n1']);

    put('n1', {
      title: 'Rencana Liburan',
      content: 'ganti tujuan ke Lombok',
      deleted_at: '2026-10-09T00:00:00Z',
    });
    expect(search('lombok')).toEqual([]); // soft delete → keluar dari indeks

    put('n1', { title: 'Rencana Liburan', content: 'ganti tujuan ke Lombok', deleted_at: null });
    expect(search('lombok')).toEqual(['n1']); // dipulihkan → kembali

    sqlite.prepare(`DELETE FROM ps_data__notes WHERE id = 'n1'`).run();
    expect(search('lombok')).toEqual([]); // hapus permanen
  });

  it('catatan tanpa judul (title null) tetap bisa dicari lewat isinya', async () => {
    const { adapter, put, search } = makeIndex();
    await setupSearchIndex(adapter);
    put('n2', { title: null, content: 'daftar belanja mingguan', deleted_at: null });
    expect(search('belanja')).toEqual(['n2']);
  });

  it('indeks versi lama dibangun ulang: catatan yang sudah ada ikut terindeks (INDEX_VERSION naik)', async () => {
    const { sqlite, adapter, put, search } = makeIndex();
    await setupSearchIndex(adapter); // pasang pemicu + versi saat ini
    // Simulasi klien lama: data sudah ada, tetapi indeks & versi tertinggal di versi 1
    sqlite.exec(
      `DROP TRIGGER search_notes_ins; DROP TRIGGER search_notes_upd; DROP TRIGGER search_notes_del`,
    );
    put('lama', { title: 'Catatan lama', content: 'sudah ada sebelum update', deleted_at: null });
    sqlite.exec(
      `DELETE FROM search_index; UPDATE search_meta SET value = '1' WHERE key = 'version'`,
    );
    expect(search('sebelum')).toEqual([]);

    await setupSearchIndex(adapter); // aplikasi baru dibuka
    expect(search('sebelum')).toEqual(['lama']);
    expect(search('lama')).toEqual(['lama']);
  });
});
