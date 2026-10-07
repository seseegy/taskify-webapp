import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SQLITE_TZ_MODIFIER } from '@/lib/date';
import { HEATMAP_SQL, heatLevel, percentChange } from './review-queries';

/** Skema minimal (hanya kolom yang dibaca query) di SQLite sungguhan. */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tasks (id TEXT, parent_id TEXT, status TEXT, completed_at TEXT, deleted_at TEXT);
    CREATE TABLE journal_entries (id TEXT, entry_date TEXT, deleted_at TEXT);
    CREATE TABLE transactions (id TEXT, occurred_on TEXT, deleted_at TEXT);
    CREATE TABLE snippets (id TEXT, created_at TEXT, deleted_at TEXT);
    CREATE TABLE code_projects (id TEXT, created_at TEXT, deleted_at TEXT);
    CREATE TABLE attachments (id TEXT, entity_type TEXT, created_at TEXT, deleted_at TEXT);
  `);
  return db;
}

const run = (db: DatabaseSync) => {
  const rows = db.prepare(HEATMAP_SQL).all('2026-10-01', '2026-10-31', SQLITE_TZ_MODIFIER) as {
    day: string;
    kind: string;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [`${r.day}:${r.kind}`, r.n]));
};

describe('HEATMAP_SQL', () => {
  it('menghitung tugas induk saja — subtask yang selesai tidak ikut (sama dengan Review)', () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO tasks VALUES ('p', NULL, 'done', '2026-10-07T03:00:00Z', NULL);
      INSERT INTO tasks VALUES ('s1', 'p', 'done', '2026-10-07T03:00:00Z', NULL);
      INSERT INTO tasks VALUES ('s2', 'p', 'done', '2026-10-07T03:00:00Z', NULL);
    `);
    expect(run(db)).toEqual({ '2026-10-07:tasks': 1 });
  });

  it('vault = snippet + project + versi file (sama dengan Kalender)', () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO snippets VALUES ('a', '2026-10-07T03:00:00Z', NULL);
      INSERT INTO code_projects VALUES ('b', '2026-10-07T04:00:00Z', NULL);
      INSERT INTO attachments VALUES ('c', 'code_project', '2026-10-07T05:00:00Z', NULL);
      INSERT INTO attachments VALUES ('d', 'transaction', '2026-10-07T05:00:00Z', NULL);
    `);
    expect(run(db)).toEqual({ '2026-10-07:vault': 3 });
  });

  it('yang di Sampah tidak dihitung', () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO tasks VALUES ('p', NULL, 'done', '2026-10-07T03:00:00Z', '2026-10-08T00:00:00Z');
      INSERT INTO code_projects VALUES ('b', '2026-10-07T04:00:00Z', '2026-10-08T00:00:00Z');
    `);
    expect(run(db)).toEqual({});
  });

  it('timestamp UTC dikonversi ke tanggal WIB (17:30 UTC = hari berikutnya)', () => {
    const db = makeDb();
    db.exec(`INSERT INTO snippets VALUES ('a', '2026-10-07T17:30:00Z', NULL);`);
    expect(run(db)).toEqual({ '2026-10-08:vault': 1 });
  });
});

describe('heatLevel & percentChange', () => {
  it('level relatif terhadap hari tersibuk', () => {
    expect([0, 1, 3, 5, 8].map((s) => heatLevel(s, 8))).toEqual([0, 1, 2, 3, 4]);
  });

  it('percentChange', () => {
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
  });
});
