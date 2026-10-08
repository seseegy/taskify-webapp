import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from '@/db/database';
import {
  changePassword,
  createVault,
  decryptItem,
  decryptTotpLog,
  encryptItem,
  encryptTotpLog,
  MIN_ITERATIONS,
  resetPasswordWithRecovery,
  rotateRecoveryKey,
  unlockWithRecoveryKey,
  type ItemPayload,
  type RewrittenVault,
} from './crypto';
import { rekeyVaultRows } from './vault-rekey';

const FAST = { iterations: MIN_ITERATIONS };
const USER = '0192f3a0-aaaa-7000-8000-000000000001';
const PASSWORD = 'kuda-biru-minum-kopi-pagi';
const KEY_ID = 'key-1';

const item = (title: string): ItemPayload => ({
  title,
  url: '',
  username: 'rosyid',
  password: 'rahasia-' + title,
  notes: '',
  favorite: false,
  totp: null,
});

/** SQLite sungguhan (node:sqlite) dengan kolom persis seperti skema lokal PowerSync. */
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE pw_keys (
      id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, updated_at TEXT,
      version INTEGER, kdf TEXT, iterations INTEGER, salt TEXT, wrapped_key TEXT,
      recovery_salt TEXT, recovery_wrapped_key TEXT
    );
    CREATE TABLE pw_items (
      id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, updated_at TEXT,
      deleted_at TEXT, enc TEXT, v INTEGER
    );
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

  const insertKey = (r: Awaited<ReturnType<typeof createVault>>['record']) =>
    sqlite
      .prepare(`INSERT INTO pw_keys VALUES (?, ?, '2026-10-01', '2026-10-01', ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        KEY_ID,
        USER,
        r.version,
        r.kdf,
        r.iterations,
        r.salt,
        r.wrapped_key,
        r.recovery_salt,
        r.recovery_wrapped_key,
      );
  const insertItem = (id: string, enc: string, deleted: string | null = null) =>
    sqlite
      .prepare(`INSERT INTO pw_items VALUES (?, ?, '2026-10-01', '2026-10-01', ?, ?, 1)`)
      .run(id, USER, deleted, enc);
  const row = (id: string) =>
    sqlite.prepare('SELECT * FROM pw_items WHERE id = ?').get(id) as {
      enc: string;
      updated_at: string;
      deleted_at: string | null;
    };
  const keyRow = () =>
    sqlite.prepare('SELECT * FROM pw_keys WHERE id = ?').get(KEY_ID) as {
      wrapped_key: string;
      recovery_wrapped_key: string;
      updated_at: string;
    };
  const insertLog = (id: string, enc: string) =>
    sqlite
      .prepare(`INSERT INTO pw_totp_log VALUES (?, ?, '2026-10-01', '2026-10-01', ?, 1)`)
      .run(id, USER, enc);
  const logRow = (id: string) =>
    sqlite.prepare('SELECT * FROM pw_totp_log WHERE id = ?').get(id) as { enc: string };
  return { db, insertKey, insertItem, insertLog, row, keyRow, logRow };
}

async function scenario() {
  const t = setup();
  const v = await createVault(PASSWORD, USER, FAST);
  t.insertKey(v.record);
  t.insertItem('a', await encryptItem(v.dek, USER, 'a', item('a')));
  t.insertItem('b', await encryptItem(v.dek, USER, 'b', item('b')));
  t.insertItem('trash', await encryptItem(v.dek, USER, 'trash', item('trash')), '2026-10-05');
  return { ...t, v };
}

describe('rekeyVaultRows (SQLite sungguhan)', () => {
  for (const [name, make] of [
    [
      'ganti master password',
      (v: Awaited<ReturnType<typeof scenario>>['v']) =>
        changePassword(v.record, PASSWORD, 'password-baru-yang-panjang', USER, FAST),
    ],
    [
      'lupa password (kunci pemulihan)',
      (v: Awaited<ReturnType<typeof scenario>>['v']) =>
        resetPasswordWithRecovery(v.record, v.recoveryKey, 'master-baru-setelah-lupa', USER, FAST),
    ],
    [
      'kunci pemulihan baru',
      (v: Awaited<ReturnType<typeof scenario>>['v']) =>
        rotateRecoveryKey(v.record, PASSWORD, USER, FAST),
    ],
  ] as const) {
    it(`${name}: record kunci berganti, SEMUA item (termasuk Sampah) terbaca dengan DEK baru saja`, async () => {
      const { db, v, row, keyRow } = await scenario();
      const next = (await make(v)) as RewrittenVault;
      const before = { a: row('a').enc, trash: row('trash').enc };

      const res = await rekeyVaultRows(db, USER, KEY_ID, next);
      expect(res).toEqual({ reencrypted: 3, skipped: 0, logReencrypted: 0, logSkipped: 0 });

      expect(keyRow().wrapped_key).toBe(next.record.wrapped_key);
      expect(keyRow().recovery_wrapped_key).toBe(next.record.recovery_wrapped_key);
      expect(keyRow().updated_at).not.toBe('2026-10-01');

      for (const id of ['a', 'b', 'trash']) {
        const r = row(id);
        expect((await decryptItem(next.dek, USER, id, r.enc)).title).toBe(id);
        await expect(decryptItem(v.dek, USER, id, r.enc)).rejects.toThrow(); // DEK lama mati
        expect(r.updated_at).not.toBe('2026-10-01'); // ikut tersinkron
      }
      expect(row('a').enc).not.toBe(before.a);
      expect(row('trash').deleted_at).toBe('2026-10-05'); // status Sampah tidak berubah
    });
  }

  it('kunci pemulihan lama + record LAMA tidak membuka data hasil rotasi (inti temuan #3)', async () => {
    const { db, v, row } = await scenario();
    const next = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST)) as RewrittenVault;
    await rekeyVaultRows(db, USER, KEY_ID, next);

    // penyerang memegang salinan pw_keys LAMA + kunci pemulihan LAMA, dan data TERBARU
    const stolen = await unlockWithRecoveryKey(v.record, v.recoveryKey, USER);
    expect(stolen).not.toBeNull();
    for (const id of ['a', 'b', 'trash'])
      await expect(decryptItem(stolen!, USER, id, row(id).enc)).rejects.toThrow();
  });

  it('baris yang tidak bisa dibuka dibiarkan persis apa adanya dan tidak menggagalkan penggantian', async () => {
    const { db, v, row, insertItem } = await scenario();
    const foreign = await createVault('lain-lain-lain-lain', USER, FAST);
    const foreignEnc = await encryptItem(foreign.dek, USER, 'asing', item('asing'));
    insertItem('asing', foreignEnc);
    insertItem('rusak', 'bukan-base64-valid!!');

    const next = (await changePassword(
      v.record,
      PASSWORD,
      'password-baru-yang-panjang',
      USER,
      FAST,
    )) as RewrittenVault;
    const res = await rekeyVaultRows(db, USER, KEY_ID, next);

    expect(res).toEqual({ reencrypted: 3, skipped: 2, logReencrypted: 0, logSkipped: 0 });
    expect(row('asing').enc).toBe(foreignEnc);
    expect(row('asing').updated_at).toBe('2026-10-01');
    expect(row('rusak').enc).toBe('bukan-base64-valid!!');
  });

  it('riwayat TOTP ikut dienkripsi ulang; yang tak terbaca dibiarkan', async () => {
    const { db, v, insertLog, logRow } = await scenario();
    const entry = { itemId: 'a', name: 'GitHub', code: '123456', usedAt: '2026-10-01T00:00:00Z' };
    insertLog('log-1', await encryptTotpLog(v.dek, USER, 'log-1', entry));
    const foreign = await createVault('lain-lain-lain-lain', USER, FAST);
    const foreignEnc = await encryptTotpLog(foreign.dek, USER, 'log-2', entry);
    insertLog('log-2', foreignEnc);

    const next = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST)) as RewrittenVault;
    const res = await rekeyVaultRows(db, USER, KEY_ID, next);
    expect([res.logReencrypted, res.logSkipped]).toEqual([1, 1]);

    expect(await decryptTotpLog(next.dek, USER, 'log-1', logRow('log-1').enc)).toEqual(entry);
    await expect(decryptTotpLog(v.dek, USER, 'log-1', logRow('log-1').enc)).rejects.toThrow();
    expect(logRow('log-2').enc).toBe(foreignEnc); // tidak disentuh
  });

  it('brankas kosong: hanya record kunci yang berganti', async () => {
    const t = setup();
    const v = await createVault(PASSWORD, USER, FAST);
    t.insertKey(v.record);
    const next = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST)) as RewrittenVault;
    expect(await rekeyVaultRows(t.db, USER, KEY_ID, next)).toEqual({
      reencrypted: 0,
      skipped: 0,
      logReencrypted: 0,
      logSkipped: 0,
    });
    expect(t.keyRow().recovery_wrapped_key).toBe(next.record.recovery_wrapped_key);
  });
});
