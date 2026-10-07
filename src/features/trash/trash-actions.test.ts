import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from '@/db/database';
import { purgeExpiredSupportRows } from './trash-actions';

const TABLES = [
  'budgets',
  'debts',
  'recurring_transactions',
  'task_lists',
  'tags',
  // kontrol: TIDAK boleh disentuh walau sudah lama dihapus
  'wallets',
  'categories',
] as const;

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const t of TABLES) sqlite.exec(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, deleted_at TEXT)`);
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
    for (const t of ['budgets', 'debts', 'recurring_transactions', 'task_lists', 'tags']) {
      sqlite.exec(`
        INSERT INTO ${t} VALUES ('lama', '2026-08-01T00:00:00.000Z');
        INSERT INTO ${t} VALUES ('baru', '2026-10-01T00:00:00.000Z');
        INSERT INTO ${t} VALUES ('hidup', NULL);
      `);
    }
    return purgeExpiredSupportRows(db, CUTOFF).then(() => {
      for (const t of ['budgets', 'debts', 'recurring_transactions', 'task_lists', 'tags'])
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
