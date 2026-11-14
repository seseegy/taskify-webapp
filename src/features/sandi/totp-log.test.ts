import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from '@/db/database';
import { createVault, decryptTotpLog, MIN_ITERATIONS } from './crypto';
import {
  clearTotpLog,
  deleteTotpLogRow,
  listTotpLogRows,
  purgeExpiredTotpLog,
  recordTotpUse,
  TOTP_LOG_RETENTION_DAYS,
  totpLogCutoff,
} from './totp-log';

const USER = '0192f3a0-aaaa-7000-8000-000000000001';
const REF = '0123456789abcdef';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE pw_totp_log (
      id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, updated_at TEXT,
      enc TEXT, v INTEGER
    );
  `);
  const db = drizzle(async (sql, params, method) => {
    const stmt = sqlite.prepare(sql);
    if (method === 'run') {
      stmt.run(...(params as never[]));
      return { rows: [] };
    }
    return { rows: stmt.all(...(params as never[])).map((r) => Object.values(r)) };
  }) as unknown as AppDatabase;

  const count = () =>
    (sqlite.prepare('SELECT count(*) AS n FROM pw_totp_log').get() as { n: number }).n;
  const backdate = (id: string, iso: string) =>
    sqlite.prepare('UPDATE pw_totp_log SET created_at = ? WHERE id = ?').run(iso, id);
  const ids = () =>
    (sqlite.prepare('SELECT id FROM pw_totp_log ORDER BY id').all() as { id: string }[]).map(
      (r) => r.id,
    );
  return { db, count, backdate, ids };
}

const vault = () => createVault('kuda-biru-minum-kopi-pagi', USER, { iterations: MIN_ITERATIONS });

describe('recordTotpUse', () => {
  it('menyimpan nama, kode, dan waktu — hanya bisa dibuka dengan DEK brankas', async () => {
    const { db, count } = setup();
    const v = await vault();
    const id = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'item-1',
      name: 'GitHub',
      code: '123456',
      usedAt: '2026-10-07T10:00:00.000Z',
    });

    expect(count()).toBe(1);
    const [row] = await listTotpLogRows(db);
    expect(row!.id).toBe(id);
    expect(await decryptTotpLog(v.dek, USER, id, row!.enc)).toEqual({
      itemId: 'item-1',
      name: 'GitHub',
      code: '123456',
      usedAt: '2026-10-07T10:00:00.000Z',
    });

    // kunci brankas lain tidak bisa membukanya
    const other = await vault();
    await expect(decryptTotpLog(other.dek, USER, id, row!.enc)).rejects.toThrow();
  });

  it('kode dan nama tidak tersimpan sebagai teks terang di kolom mana pun', async () => {
    const { db } = setup();
    const v = await vault();
    const id = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'item-1',
      name: 'Binance',
      code: '987654',
    });
    const [row] = await listTotpLogRows(db);
    expect(JSON.stringify(row)).not.toContain('Binance');
    expect(JSON.stringify(row)).not.toContain('987654');
    expect(row!.id).toBe(id);
  });

  it('baris tidak bisa ditukar: enc dari baris lain gagal dibuka di id ini', async () => {
    const { db } = setup();
    const v = await vault();
    const a = await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'A', code: '111111' });
    await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'B', code: '222222' });
    const rows = await listTotpLogRows(db);
    const other = rows.find((r) => r.id !== a)!;
    await expect(decryptTotpLog(v.dek, USER, a, other.enc)).rejects.toThrow();
  });

  it('usedAt diisi otomatis bila tidak diberikan', async () => {
    const { db } = setup();
    const v = await vault();
    const before = Date.now();
    const id = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'i',
      name: 'X',
      code: '000000',
    });
    const [row] = await listTotpLogRows(db);
    const entry = await decryptTotpLog(v.dek, USER, id, row!.enc);
    expect(Date.parse(entry.usedAt)).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('listTotpLogRows', () => {
  it('terbaru lebih dulu dan menghormati batas', async () => {
    const { db, backdate } = setup();
    const v = await vault();
    const older = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'i',
      name: 'A',
      code: '111111',
    });
    const newer = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'i',
      name: 'B',
      code: '222222',
    });
    backdate(older, '2026-01-01T00:00:00.000Z');
    backdate(newer, '2026-10-01T00:00:00.000Z');

    expect((await listTotpLogRows(db)).map((r) => r.id)).toEqual([newer, older]);
    expect(await listTotpLogRows(db, 1)).toHaveLength(1);
  });
});

describe('retensi', () => {
  it('cutoff dihitung dari hari retensi', () => {
    const now = Date.parse('2026-10-07T00:00:00.000Z');
    expect(totpLogCutoff(now, 90)).toBe('2026-07-09T00:00:00.000Z');
    expect(totpLogCutoff(now)).toBe(totpLogCutoff(now, TOTP_LOG_RETENTION_DAYS));
  });

  it('membuang yang lebih tua dari cutoff dan menyisakan yang baru', async () => {
    const { db, backdate, ids } = setup();
    const v = await vault();
    const old1 = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'i',
      name: 'A',
      code: '111111',
    });
    const keep = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'i',
      name: 'B',
      code: '222222',
    });
    backdate(old1, '2026-01-01T00:00:00.000Z');
    backdate(keep, '2026-10-01T00:00:00.000Z');

    await purgeExpiredTotpLog(db, '2026-07-09T00:00:00.000Z');
    expect(ids()).toEqual([keep]);
  });

  it('tepat di batas cutoff tidak dibuang', async () => {
    const { db, backdate, count } = setup();
    const v = await vault();
    const id = await recordTotpUse(db, USER, v.dek, REF, {
      itemId: 'i',
      name: 'A',
      code: '111111',
    });
    backdate(id, '2026-07-09T00:00:00.000Z');
    await purgeExpiredTotpLog(db, '2026-07-09T00:00:00.000Z');
    expect(count()).toBe(1);
  });

  it('baris yang tersinkron dari server (format "YYYY-MM-DD HH:MM:SSZ") dibandingkan menurut WAKTU, bukan teks', async () => {
    const { db, backdate, ids } = setup();
    const v = await vault();
    // Sore di hari cutoff (masih dalam retensi) dan pagi sehari sebelumnya (sudah lewat)
    const keep = await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'A', code: '1' });
    const drop = await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'B', code: '2' });
    backdate(keep, '2026-07-09 15:00:00Z');
    backdate(drop, '2026-07-08 09:00:00Z');
    // Sebagai teks, '2026-07-09 15…' < '2026-07-09T00…' (spasi < T) → dulu ikut terhapus
    await purgeExpiredTotpLog(db, '2026-07-09T00:00:00.000Z');
    expect(ids()).toEqual([keep]);
  });

  it('urutan riwayat benar walau format waktu bercampur (lokal ISO vs tersinkron)', async () => {
    const { db, backdate } = setup();
    const v = await vault();
    const synced = await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'A', code: '1' });
    const local = await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'B', code: '2' });
    backdate(synced, '2026-10-01 18:00:00Z'); // lebih baru
    backdate(local, '2026-10-01T09:00:00.000Z');
    expect((await listTotpLogRows(db)).map((r) => r.id)).toEqual([synced, local]);
  });
});

describe('hapus', () => {
  it('satu baris dan seluruh riwayat', async () => {
    const { db, count } = setup();
    const v = await vault();
    const a = await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'A', code: '111111' });
    await recordTotpUse(db, USER, v.dek, REF, { itemId: 'i', name: 'B', code: '222222' });

    await deleteTotpLogRow(db, a);
    expect(count()).toBe(1);
    await clearTotpLog(db);
    expect(count()).toBe(0);
  });
});
