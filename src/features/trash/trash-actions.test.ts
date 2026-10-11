import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from '@/db/database';
import { purgeExpiredConfigFiles, purgeExpiredSupportRows } from './trash-actions';

const TABLES = [
  'budgets',
  'debts',
  'recurring_transactions',
  'task_lists',
  'tags',
  'pw_items',
  'config_files',
  // kontrol: TIDAK boleh disentuh walau sudah lama dihapus
  'wallets',
  'categories',
] as const;

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const t of TABLES) sqlite.exec(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, deleted_at TEXT)`);
  // config_versions tidak punya deleted_at: ia ikut berkas induknya
  sqlite.exec(`CREATE TABLE config_versions (id TEXT PRIMARY KEY, file_id TEXT)`);
  const db = drizzle(async (sql, params, method) => {
    const stmt = sqlite.prepare(sql);
    if (method === 'run') {
      stmt.run(...(params as never[]));
      return { rows: [] };
    }
    return { rows: stmt.all(...(params as never[])).map((r) => Object.values(r)) };
  });
  const ids = (t: string) =>
    (sqlite.prepare(`SELECT id FROM ${t} ORDER BY id`).all() as { id: string }[]).map((r) => r.id);
  return { sqlite, db: db as unknown as AppDatabase, ids };
}

const CUTOFF = '2026-09-07T00:00:00.000Z'; // 30 hari sebelum 7 Okt

describe('purgeExpiredSupportRows', () => {
  it('menghapus yang di-soft-delete SEBELUM batas; menyisakan yang baru dihapus & yang hidup', () => {
    const { sqlite, db, ids } = setup();
    for (const t of [
      'budgets',
      'debts',
      'recurring_transactions',
      'task_lists',
      'tags',
      'pw_items',
    ]) {
      sqlite.exec(`
        INSERT INTO ${t} VALUES ('lama', '2026-08-01T00:00:00.000Z');
        INSERT INTO ${t} VALUES ('baru', '2026-10-01T00:00:00.000Z');
        INSERT INTO ${t} VALUES ('hidup', NULL);
      `);
    }
    return purgeExpiredSupportRows(db, CUTOFF).then(() => {
      for (const t of [
        'budgets',
        'debts',
        'recurring_transactions',
        'task_lists',
        'tags',
        'pw_items',
      ])
        expect(ids(t), t).toEqual(['baru', 'hidup']);
    });
  });

  it('dompet & kategori tidak pernah disentuh (RESTRICT / CASCADE di server)', async () => {
    const { sqlite, db, ids } = setup();
    for (const t of ['wallets', 'categories'])
      sqlite.exec(`INSERT INTO ${t} VALUES ('lama-sekali', '2020-01-01T00:00:00.000Z')`);
    await purgeExpiredSupportRows(db, CUTOFF);
    expect(ids('wallets')).toEqual(['lama-sekali']);
    expect(ids('categories')).toEqual(['lama-sekali']);
  });

  it('tabel kosong tidak menimbulkan error', async () => {
    const { db } = setup();
    await expect(purgeExpiredSupportRows(db, CUTOFF)).resolves.toBeUndefined();
  });
});

describe('purgeExpiredConfigFiles', () => {
  /**
   * Versi HARUS ikut terhapus di sini. `ON DELETE CASCADE` hanya ada di Postgres; tabel lokal
   * PowerSync tidak punya foreign key, jadi tanpa penghapusan eksplisit ciphertext versi akan
   * menggantung di perangkat setelah berkasnya hilang.
   */
  it('menghapus berkas kedaluwarsa BESERTA seluruh versinya, menyisakan milik berkas lain', async () => {
    const { sqlite, db, ids } = setup();
    sqlite.exec(`
      INSERT INTO config_files VALUES ('lama', '2026-08-01T00:00:00.000Z');
      INSERT INTO config_files VALUES ('baru', '2026-10-01T00:00:00.000Z');
      INSERT INTO config_files VALUES ('hidup', NULL);
      INSERT INTO config_versions VALUES ('v-lama-1', 'lama');
      INSERT INTO config_versions VALUES ('v-lama-2', 'lama');
      INSERT INTO config_versions VALUES ('v-baru', 'baru');
      INSERT INTO config_versions VALUES ('v-hidup', 'hidup');
    `);

    await purgeExpiredConfigFiles(db, CUTOFF);

    expect(ids('config_files')).toEqual(['baru', 'hidup']);
    expect(ids('config_versions')).toEqual(['v-baru', 'v-hidup']);
  });

  it('ikut dijalankan oleh purgeExpiredSupportRows', async () => {
    const { sqlite, db, ids } = setup();
    sqlite.exec(`
      INSERT INTO config_files VALUES ('lama', '2026-08-01T00:00:00.000Z');
      INSERT INTO config_versions VALUES ('v1', 'lama');
    `);
    await purgeExpiredSupportRows(db, CUTOFF);
    expect(ids('config_files')).toEqual([]);
    expect(ids('config_versions')).toEqual([]);
  });

  it('tanpa berkas kedaluwarsa tidak menyentuh versi apa pun', async () => {
    const { sqlite, db, ids } = setup();
    sqlite.exec(`
      INSERT INTO config_files VALUES ('hidup', NULL);
      INSERT INTO config_versions VALUES ('v1', 'hidup');
    `);
    await purgeExpiredConfigFiles(db, CUTOFF);
    expect(ids('config_versions')).toEqual(['v1']);
  });
});
