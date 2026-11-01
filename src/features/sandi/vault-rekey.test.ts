import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from '@/db/database';
import {
  changePassword,
  createVault,
  decryptConfig,
  decryptItem,
  decryptTotpLog,
  encryptConfig,
  encryptItem,
  encryptTotpLog,
  keyRef,
  MIN_ITERATIONS,
  resetPasswordWithRecovery,
  rotateRecoveryKey,
  splitEnc,
  unlockWithRecoveryKey,
  type ItemPayload,
  type RewrittenVault,
} from './crypto';
import { rekeyVaultRows, skippedMessage } from './vault-rekey';

const FAST = { iterations: MIN_ITERATIONS };
const USER = '0192f3a0-aaaa-7000-8000-000000000001';
const PASSWORD = 'kuda-biru-minum-kopi-pagi';
const KEY_ID = 'key-1';
/** Label untuk data awal skenario; nilainya tidak memengaruhi dekripsi lokal. */
const REF = '0123456789abcdef';

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
      recovery_salt TEXT, recovery_wrapped_key TEXT, rotated_from TEXT, labels_required_at TEXT
    );
    CREATE TABLE pw_items (
      id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, updated_at TEXT,
      deleted_at TEXT, enc TEXT, v INTEGER
    );
    CREATE TABLE pw_totp_log (
      id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, updated_at TEXT,
      enc TEXT, v INTEGER
    );
    CREATE TABLE config_versions (
      id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, updated_at TEXT,
      file_id TEXT, enc TEXT, v INTEGER
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
      .prepare(
        `INSERT INTO pw_keys VALUES (?, ?, '2026-10-01', '2026-10-01', ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
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
      rotated_from: string | null;
    };
  const insertLog = (id: string, enc: string) =>
    sqlite
      .prepare(`INSERT INTO pw_totp_log VALUES (?, ?, '2026-10-01', '2026-10-01', ?, 1)`)
      .run(id, USER, enc);
  const logRow = (id: string) =>
    sqlite.prepare('SELECT * FROM pw_totp_log WHERE id = ?').get(id) as { enc: string };
  const insertConfig = (id: string, fileId: string, enc: string) =>
    sqlite
      .prepare(`INSERT INTO config_versions VALUES (?, ?, '2026-10-01', '2026-10-01', ?, ?, 1)`)
      .run(id, USER, fileId, enc);
  const configRow = (id: string) =>
    sqlite.prepare('SELECT * FROM config_versions WHERE id = ?').get(id) as {
      enc: string;
      updated_at: string;
    };
  return { db, insertKey, insertItem, insertLog, insertConfig, row, keyRow, logRow, configRow };
}

const EMPTY_COUNTS = {
  reencrypted: 0,
  skipped: 0,
  logReencrypted: 0,
  logSkipped: 0,
  configReencrypted: 0,
  configSkipped: 0,
};

async function scenario() {
  const t = setup();
  const v = await createVault(PASSWORD, USER, FAST);
  t.insertKey(v.record);
  t.insertItem('a', await encryptItem(v.dek, USER, 'a', item('a'), REF));
  t.insertItem('b', await encryptItem(v.dek, USER, 'b', item('b'), REF));
  t.insertItem('trash', await encryptItem(v.dek, USER, 'trash', item('trash'), REF), '2026-10-05');
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
      expect(res).toEqual({ ...EMPTY_COUNTS, reencrypted: 3 });

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

  it('baris yang tidak bisa dibuka: ISI dibiarkan persis apa adanya, tetapi disentuh agar server tahu baris itu tidak terlewat', async () => {
    const { db, v, row, insertItem } = await scenario();
    const foreign = await createVault('lain-lain-lain-lain', USER, FAST);
    const foreignEnc = await encryptItem(foreign.dek, USER, 'asing', item('asing'), REF);
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

    expect(res).toEqual({ ...EMPTY_COUNTS, reencrypted: 3, skipped: 2 });
    expect(row('asing').enc).toBe(foreignEnc);
    expect(row('rusak').enc).toBe('bukan-base64-valid!!');
    // `updated_at` saja yang berubah → baris ikut di transaksi rotasi (cek kelengkapan di server)
    expect(row('asing').updated_at).not.toBe('2026-10-01');
    expect(row('rusak').updated_at).not.toBe('2026-10-01');
  });

  it('riwayat TOTP ikut dienkripsi ulang; yang tak terbaca dibiarkan', async () => {
    const { db, v, insertLog, logRow } = await scenario();
    const entry = { itemId: 'a', name: 'GitHub', code: '123456', usedAt: '2026-10-01T00:00:00Z' };
    insertLog('log-1', await encryptTotpLog(v.dek, USER, 'log-1', entry, REF));
    const foreign = await createVault('lain-lain-lain-lain', USER, FAST);
    const foreignEnc = await encryptTotpLog(foreign.dek, USER, 'log-2', entry, REF);
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
    expect(await rekeyVaultRows(t.db, USER, KEY_ID, next)).toEqual(EMPTY_COUNTS);
    expect(t.keyRow().recovery_wrapped_key).toBe(next.record.recovery_wrapped_key);
  });

  // -------------------------------------------------------------------------------------
  // Konfigurasi Vault: kalau ini terlewat saat rotasi, SELURUH konfigurasi tidak bisa dibuka
  // lagi setelah ganti master password — kunci lama sudah ditimpa dan hanya ada di backup.
  // -------------------------------------------------------------------------------------
  it('versi konfigurasi ikut dienkripsi ulang dan terbaca dengan DEK baru saja', async () => {
    const { db, v, insertConfig, configRow } = await scenario();
    const payload = { text: 'API_URL=https://api.example.com\nTOKEN=rahasia', note: 'awal' };
    const encA = await encryptConfig(v.dek, USER, 'file-1', 'ver-1', payload, REF);
    insertConfig('ver-1', 'file-1', encA);
    insertConfig(
      'ver-2',
      'file-2',
      await encryptConfig(v.dek, USER, 'file-2', 'ver-2', { text: '{"a":1}', note: '' }, REF),
    );

    const next = (await changePassword(
      v.record,
      PASSWORD,
      'password-baru-yang-panjang',
      USER,
      FAST,
    )) as RewrittenVault;
    const res = await rekeyVaultRows(db, USER, KEY_ID, next);
    expect([res.configReencrypted, res.configSkipped]).toEqual([2, 0]);

    // AAD memakai file_id yang BENAR per baris (bukan satu nilai untuk semua)
    expect(await decryptConfig(next.dek, USER, 'file-1', 'ver-1', configRow('ver-1').enc)).toEqual(
      payload,
    );
    expect(
      (await decryptConfig(next.dek, USER, 'file-2', 'ver-2', configRow('ver-2').enc)).text,
    ).toBe('{"a":1}');

    await expect(
      decryptConfig(v.dek, USER, 'file-1', 'ver-1', configRow('ver-1').enc),
    ).rejects.toThrow(); // DEK lama mati
    expect(configRow('ver-1').enc).not.toBe(encA);
    expect(configRow('ver-1').updated_at).not.toBe('2026-10-01'); // ikut tersinkron
  });

  it('kunci pemulihan lama tidak membuka konfigurasi setelah rotasi', async () => {
    const { db, v, insertConfig, configRow } = await scenario();
    insertConfig(
      'ver-1',
      'file-1',
      await encryptConfig(v.dek, USER, 'file-1', 'ver-1', { text: 'TOKEN=x', note: '' }, REF),
    );
    const next = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST)) as RewrittenVault;
    await rekeyVaultRows(db, USER, KEY_ID, next);

    const stolen = await unlockWithRecoveryKey(v.record, v.recoveryKey, USER);
    await expect(
      decryptConfig(stolen!, USER, 'file-1', 'ver-1', configRow('ver-1').enc),
    ).rejects.toThrow();
  });

  it('versi konfigurasi yang tak terbaca dibiarkan apa adanya', async () => {
    const { db, v, insertConfig, configRow } = await scenario();
    const foreign = await createVault('lain-lain-lain-lain', USER, FAST);
    const foreignEnc = await encryptConfig(
      foreign.dek,
      USER,
      'file-1',
      'ver-asing',
      {
        text: 'A=1',
        note: '',
      },
      REF,
    );
    insertConfig('ver-asing', 'file-1', foreignEnc);
    insertConfig('ver-rusak', 'file-1', 'bukan-base64-valid!!');

    const next = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST)) as RewrittenVault;
    const res = await rekeyVaultRows(db, USER, KEY_ID, next);
    expect([res.configReencrypted, res.configSkipped]).toEqual([0, 2]);
    expect(configRow('ver-asing').enc).toBe(foreignEnc);
    expect(configRow('ver-asing').updated_at).not.toBe('2026-10-01'); // disentuh, isi tetap
  });

  // -------------------------------------------------------------------------------------
  // Penjaga rotasi di server: label kunci & compare-and-swap (migrasi …_vault_key_guard.sql)
  // -------------------------------------------------------------------------------------
  it('semua isi baru berlabel kunci BARU, dan rotated_from = label kunci ASAL', async () => {
    const { db, v, row, keyRow, insertLog, logRow, insertConfig, configRow } = await scenario();
    const entry = { itemId: 'a', name: 'X', code: '1', usedAt: '2026-10-01T00:00:00Z' };
    insertLog('log-1', await encryptTotpLog(v.dek, USER, 'log-1', entry, REF));
    insertConfig(
      'ver-1',
      'file-1',
      await encryptConfig(v.dek, USER, 'file-1', 'ver-1', { text: 'A=1', note: '' }, REF),
    );
    const next = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST)) as RewrittenVault;
    await rekeyVaultRows(db, USER, KEY_ID, next);

    const newRef = await keyRef(next.record.wrapped_key);
    expect(keyRow().rotated_from).toBe(await keyRef(v.record.wrapped_key));
    for (const enc of [row('a').enc, row('trash').enc, logRow('log-1').enc, configRow('ver-1').enc])
      expect(splitEnc(enc).ref).toBe(newRef);
  });

  it('kunci lokal sudah bukan kunci asal rotasi → batal TANPA mengubah apa pun', async () => {
    const { db, v, row, keyRow } = await scenario();
    const stale = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST)) as RewrittenVault;
    // Perangkat lain sudah merotasi dan hasilnya tiba lewat sinkron sebelum form ini disimpan
    const fromOtherDevice = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST))!;
    await rekeyVaultRows(db, USER, KEY_ID, fromOtherDevice);
    const before = { key: keyRow().wrapped_key, a: row('a').enc };

    await expect(rekeyVaultRows(db, USER, KEY_ID, stale)).rejects.toMatchObject({
      name: 'SandiError',
    });
    expect(keyRow().wrapped_key).toBe(before.key);
    expect(row('a').enc).toBe(before.a);
  });
});

describe('skippedMessage', () => {
  const counts = (over: Partial<typeof EMPTY_COUNTS> = {}) => ({ ...EMPTY_COUNTS, ...over });

  it('null bila semuanya berhasil', () => {
    expect(skippedMessage(counts())).toBeNull();
  });

  it('menyebut sandi dan versi konfigurasi, sendiri maupun bersama', () => {
    expect(skippedMessage(counts({ skipped: 2 }))).toMatch(/^2 sandi lama tidak bisa dibuka/);
    expect(skippedMessage(counts({ configSkipped: 1 }))).toMatch(
      /^1 versi konfigurasi lama tidak bisa dibuka/,
    );
    expect(skippedMessage(counts({ skipped: 2, configSkipped: 1 }))).toBe(
      '2 sandi dan 1 versi konfigurasi lama tidak bisa dibuka dan dibiarkan apa adanya.',
    );
  });

  it('riwayat TOTP yang dilewati TIDAK diberitahukan (hilang sendiri karena retensi)', () => {
    expect(skippedMessage(counts({ logSkipped: 5 }))).toBeNull();
  });
});
