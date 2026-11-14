/**
 * Menjalankan SEMUA migrasi berurutan di Postgres sungguhan (PGlite, WASM) lalu menguji perilaku
 * SQL yang penting. Menggantikan klaim lama di docs ("diuji di PGlite") yang tidak ada di repo.
 *
 * Stub minimal untuk objek bawaan Supabase: role anon/authenticated/service_role, tabel
 * auth.users & auth.mfa_factors, auth.uid(), dan auth.jwt() (claim dari setting `app.jwt`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzleSchema, VAULT_ENCRYPTED_TABLES } from '../../src/db/schema';
import { keyRef } from '../../src/features/sandi/crypto';
import { sha256Hex16 } from '../../src/lib/hash';
import { EXPORT_TABLES } from '../../src/features/settings/export-tables';
import { TEMP_QUOTA_BYTES as CLIENT_QUOTA } from '../../src/features/tempfiles/tempfile-limits';
import { TEMP_QUOTA_BYTES as EDGE_QUOTA } from '../functions/_shared/tempfiles';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const RETRY_MIGRATION = '20261008000100_reminder_retry.sql';
const LATER_MIGRATIONS = FILES.filter((f) => f > RETRY_MIGRATION);

let pg: PGlite;
let userId: string;

const rows = async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
  (await pg.query<T>(sql, params)).rows;

async function makeTask(title: string, remindMinutesAgo: number) {
  const [t] = await rows<{ id: string; remind_at: Date }>(
    `INSERT INTO public.tasks (id, user_id, title, status, remind_at, due_date)
     VALUES (gen_random_uuid(), $1, $2, 'todo', now() - ($3 || ' minutes')::interval, current_date)
     RETURNING id, remind_at`,
    [userId, title, String(remindMinutesAgo)],
  );
  return t!;
}
const claim = () => rows<{ task_id: string }>(`SELECT * FROM public.claim_due_reminders()`);
const age = (taskId: string, interval: string) =>
  pg.query(
    `UPDATE public.task_reminder_log SET claimed_at = now() - $2::interval WHERE task_id = $1`,
    [taskId, interval],
  );

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    -- Sama dengan Supabase: role Data API boleh memakai skema auth (auth.uid() dari fungsi SQL)
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.uid', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.jwt', true), ''), '{}')::jsonb $$;
    CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');
    CREATE TABLE auth.mfa_factors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
      status auth.factor_status NOT NULL DEFAULT 'unverified'
    );
  `);
  // Migrasi sebelum perbaikan pengingat dulu, supaya jalur upgrade (data lama) ikut teruji
  for (const f of FILES.filter((f) => f < RETRY_MIGRATION))
    await pg.exec(readFileSync(DIR + f, 'utf8'));
  userId = (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!
    .id;
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe('migrasi awal', () => {
  it('semua tabel tersinkron punya RLS aktif, FORCE, dan 4 policy pemilik', async () => {
    const t = await rows<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`,
    );
    expect(t.length).toBeGreaterThanOrEqual(16);
    for (const r of t) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }
  });

  it('publication powersync memuat 16 tabel awal dan REPLICA IDENTITY FULL', async () => {
    const pub = await rows<{ tablename: string }>(
      `SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync'`,
    );
    expect(pub).toHaveLength(16);
    const notFull = await rows(
      `SELECT c.relname FROM pg_class c JOIN pg_publication_tables p ON p.tablename = c.relname
        WHERE p.pubname = 'powersync' AND c.relreplident <> 'f'`,
    );
    expect(notFull).toEqual([]);
  });

  it('akun baru otomatis mendapat pengaturan, 2 dompet, dan kategori default', async () => {
    const [{ id }] = await rows<{ id: string }>(
      `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
    );
    const n = async (t: string) =>
      (
        await rows<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE user_id = $1`, [
          id,
        ])
      )[0]!.n;
    expect(await n('user_settings')).toBe(1);
    expect(await n('wallets')).toBe(2);
    expect(await n('categories')).toBe(13);
  });

  it('CHECK constraint menolak teks melebihi batas (yang dicerminkan src/lib/limits.ts)', async () => {
    const insert = (title: string) =>
      pg.query(
        `INSERT INTO public.tasks (id, user_id, title, status) VALUES (gen_random_uuid(), $1, $2, 'todo')`,
        [userId, title],
      );
    await expect(insert('x'.repeat(300))).resolves.toBeDefined();
    await expect(insert('x'.repeat(301))).rejects.toThrow(/check/i);
  });
});

describe('pengingat · jalur upgrade', () => {
  it('pengingat yang sudah diklaim fungsi LAMA tidak dikirim ulang setelah migrasi baru', async () => {
    const old = await makeTask('diklaim-fungsi-lama', 10);
    expect(await claim()).toHaveLength(1); // fungsi lama
    await pg.exec(readFileSync(DIR + RETRY_MIGRATION, 'utf8')); // upgrade
    for (const f of LATER_MIGRATIONS) await pg.exec(readFileSync(DIR + f, 'utf8'));

    const cols = (
      await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'task_reminder_log'`,
      )
    ).map((c) => c.column_name);
    expect(cols).toEqual(expect.arrayContaining(['claimed_at', 'delivered_at', 'attempts']));
    expect(cols).not.toContain('sent_at');

    await age(old.id, '1 hour');
    expect(await claim()).toHaveLength(0);
  });
});

describe('pengingat · klaim, coba ulang, selesai', () => {
  it('klaim atomik: eksekusi cron yang tumpang tindih tidak mendapat pengingat yang sama', async () => {
    const a = await makeTask('A', 5);
    expect((await claim()).map((r) => r.task_id)).toEqual([a.id]);
    expect(await claim()).toHaveLength(0);
  });

  it('push gagal (tidak ditandai delivered) → diklaim ulang tiap 3 menit, berhenti di percobaan ke-5', async () => {
    const t = await makeTask('gagal-terus', 5);
    expect((await claim()).map((r) => r.task_id)).toEqual([t.id]); // percobaan 1
    expect(await claim()).toHaveLength(0); // belum 3 menit

    for (let attempt = 2; attempt <= 5; attempt++) {
      await age(t.id, '4 minutes');
      expect(
        (await claim()).map((r) => r.task_id),
        `percobaan ${attempt}`,
      ).toEqual([t.id]);
    }
    await age(t.id, '4 minutes');
    expect(await claim()).toHaveLength(0); // batas 5 tercapai
    const [{ attempts }] = await rows<{ attempts: number }>(
      `SELECT attempts FROM public.task_reminder_log WHERE task_id = $1`,
      [t.id],
    );
    expect(attempts).toBe(5);
  });

  it('setelah ditandai delivered tidak pernah diklaim lagi, dan penandaan idempoten', async () => {
    const t = await makeTask('sukses', 5);
    await claim();
    const mark = async () =>
      (
        await rows<{ n: number }>(
          `SELECT public.mark_reminders_delivered($1::uuid[], $2::timestamptz[]) AS n`,
          [[t.id], [t.remind_at.toISOString()]],
        )
      )[0]!.n;
    expect(await mark()).toBe(1);
    await age(t.id, '1 hour');
    expect((await claim()).map((r) => r.task_id)).not.toContain(t.id);
    expect(await mark()).toBe(0);
  });

  it('mengubah remind_at membuat pengingat baru tetap terkirim', async () => {
    const t = await makeTask('digeser', 5);
    await claim();
    await pg.query(`UPDATE public.task_reminder_log SET delivered_at = now() WHERE task_id = $1`, [
      t.id,
    ]);
    await pg.query(
      `UPDATE public.tasks SET remind_at = now() - interval '1 minute' WHERE id = $1`,
      [t.id],
    );
    expect((await claim()).map((r) => r.task_id)).toContain(t.id);
  });

  it('tugas selesai/dihapus dan pengingat basi (>24 jam) tidak diklaim', async () => {
    const done = await makeTask('selesai', 5);
    await claim();
    await pg.query(`UPDATE public.tasks SET status = 'done', completed_at = now() WHERE id = $1`, [
      done.id,
    ]);
    await age(done.id, '1 hour');
    await makeTask('basi', 60 * 25);
    const claimed = (await claim()).map((r) => r.task_id);
    expect(claimed).not.toContain(done.id);
    expect(claimed).toHaveLength(0);
  });

  it('klien tidak boleh memanggil fungsi klaim / penandaan (hanya service_role)', async () => {
    const grants = await rows<{ proname: string; ok: boolean }>(
      `SELECT p.proname,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS ok
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('claim_due_reminders', 'mark_reminders_delivered', 'prune_reminder_log')`,
    );
    expect(grants).toHaveLength(3);
    for (const g of grants) expect(g.ok, g.proname).toBe(false);
  });
});

describe('lampiran · pembersihan memakai waktu server (received_at)', () => {
  async function makeAttachment(opts: {
    status: string;
    createdDaysAgo: number;
    receivedDaysAgo: number;
  }) {
    // Entitas induk yang hidup, supaya aturan "induk hilang" tidak ikut memicu
    const [task] = await rows<{ id: string }>(
      `INSERT INTO public.tasks (id, user_id, title, status) VALUES (gen_random_uuid(), $1, 'induk', 'todo') RETURNING id`,
      [userId],
    );
    const [a] = await rows<{ id: string }>(
      `INSERT INTO public.attachments
         (id, user_id, entity_type, entity_id, storage_key, file_name, size_bytes, status, created_at, received_at)
       VALUES (gen_random_uuid(), $1, 'task', $2, 'k/' || gen_random_uuid(), 'f.txt', 10, $3,
               now() - ($4 || ' days')::interval, now() - ($5 || ' days')::interval)
       RETURNING id`,
      [userId, task!.id, opts.status, String(opts.createdDaysAgo), String(opts.receivedDaysAgo)],
    );
    return a!.id;
  }
  const purgeable = async () =>
    (await rows<{ id: string }>(`SELECT id FROM public.attachments_to_purge(500)`)).map(
      (r) => r.id,
    );

  it('kolom received_at ada, default-nya waktu server, dan klien tidak perlu mengisinya', async () => {
    const [{ received_at, created_at }] = await rows<{ received_at: Date; created_at: Date }>(
      `WITH t AS (INSERT INTO public.tasks (id, user_id, title, status) VALUES (gen_random_uuid(), $1, 'x', 'todo') RETURNING id)
       INSERT INTO public.attachments (id, user_id, entity_type, entity_id, storage_key, file_name, size_bytes, status, created_at)
       SELECT gen_random_uuid(), $1, 'task', t.id, 'k/' || gen_random_uuid(), 'f', 1, 'pending', now() - interval '10 days' FROM t
       RETURNING received_at, created_at`,
      [userId],
    );
    expect(Date.now() - received_at.getTime()).toBeLessThan(60_000);
    expect(received_at.getTime() - created_at.getTime()).toBeGreaterThan(9 * 86_400_000);
  });

  it('dibuat offline 10 hari lalu tetapi BARU tiba di server → tidak dihapus', async () => {
    const id = await makeAttachment({ status: 'pending', createdDaysAgo: 10, receivedDaysAgo: 0 });
    expect(await purgeable()).not.toContain(id);
  });

  it('sudah > 2 hari di server tetapi masih belum terunggah → dihapus', async () => {
    const id = await makeAttachment({ status: 'failed', createdDaysAgo: 3, receivedDaysAgo: 3 });
    expect(await purgeable()).toContain(id);
  });

  it('yang sudah terunggah tidak pernah dihapus karena umur', async () => {
    const id = await makeAttachment({
      status: 'uploaded',
      createdDaysAgo: 400,
      receivedDaysAgo: 400,
    });
    expect(await purgeable()).not.toContain(id);
  });

  it('fungsi pembersih tetap hanya bisa dipanggil service_role', async () => {
    const [{ ok }] = await rows<{ ok: boolean }>(
      `SELECT has_function_privilege('authenticated', 'public.attachments_to_purge(integer)', 'EXECUTE') AS ok`,
    );
    expect(ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------
// Keselarasan: aturan "ubah di tiga tempat" (migrasi, sync-config, schema.ts) + publication + ekspor
// -----------------------------------------------------------------------------------------
describe('keselarasan skema Postgres ↔ klien ↔ sync ↔ ekspor', () => {
  const SERVER_ONLY = ['push_subscriptions', 'task_reminder_log'];

  const pgTables = async () => {
    const rowsT = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    return rowsT
      .map((r) => r.table_name)
      .filter((n) => !SERVER_ONLY.includes(n))
      .sort();
  };

  it('setiap tabel tersinkron punya kolom yang SAMA di Postgres dan di Drizzle (schema.ts)', async () => {
    const local = new Map<string, string[]>();
    for (const v of Object.values(drizzleSchema)) {
      try {
        const cfg = getTableConfig(v as never);
        if (cfg?.name) local.set(cfg.name, cfg.columns.map((c) => c.name).sort());
      } catch {
        /* objek relations */
      }
    }
    // received_at dan sejenisnya SENGAJA server-only; daftar di bawah harus eksplisit
    const serverOnlyColumns: Record<string, string[]> = { attachments: ['received_at'] };
    for (const table of await pgTables()) {
      const cols = (
        await rows<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        )
      )
        .map((c) => c.column_name)
        .filter((c) => !(serverOnlyColumns[table] ?? []).includes(c))
        .sort();
      expect(local.get(table), `tabel ${table} tidak ada di schema.ts`).toBeDefined();
      expect(local.get(table), `kolom ${table} berbeda`).toEqual(cols);
    }
  });

  it('sync-config.yaml, publication, dan EXPORT_TABLES memuat tepat tabel tersinkron yang sama', async () => {
    const synced = await pgTables();
    const yaml = readFileSync(
      fileURLToPath(new URL('../../powersync/sync-config.yaml', import.meta.url)),
      'utf8',
    );
    const inSync = [...yaml.matchAll(/FROM (\w+) WHERE/g)].map((m) => m[1]!).sort();
    const inPub = (
      await rows<{ tablename: string }>(
        `SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync'`,
      )
    )
      .map((r) => r.tablename)
      .sort();
    expect(inSync).toEqual(synced);
    expect(inPub).toEqual(synced);
    expect([...EXPORT_TABLES].sort()).toEqual(synced);
  });
});

// -----------------------------------------------------------------------------------------
// Sandi: pw_keys & pw_items
// -----------------------------------------------------------------------------------------
describe('Sandi · pw_keys & pw_items', () => {
  const b64 = (n: number) => 'A'.repeat(n);
  let alice: string;
  let bob: string;

  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await pg.exec('SET ROLE authenticated');
    await pg.query(`SELECT set_config('app.uid', $1, false)`, [uid]);
    try {
      return await fn();
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('app.uid', '', false)`);
    }
  }
  const key = (id: string, over: Record<string, unknown> = {}) => {
    const r = {
      version: 1,
      kdf: 'pbkdf2-sha256',
      iterations: 600000,
      salt: b64(24),
      wrapped_key: b64(80),
      recovery_salt: b64(24),
      recovery_wrapped_key: b64(80),
      ...over,
    };
    return pg.query(
      `INSERT INTO public.pw_keys (id, version, kdf, iterations, salt, wrapped_key, recovery_salt, recovery_wrapped_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        r.version,
        r.kdf,
        r.iterations,
        r.salt,
        r.wrapped_key,
        r.recovery_salt,
        r.recovery_wrapped_key,
      ],
    );
  };
  const item = (id: string, enc = b64(100)) =>
    pg.query(`INSERT INTO public.pw_items (id, enc) VALUES ($1, $2)`, [id, enc]);
  const uuid = () => rows<{ id: string }>(`SELECT gen_random_uuid() AS id`).then((r) => r[0]!.id);

  beforeAll(async () => {
    alice = (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!
      .id;
    bob = (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!.id;
  });

  it('user_id terisi otomatis dari auth.uid() (klien tidak perlu mengirimnya)', async () => {
    await asUser(alice, async () => key(await uuid()));
    const [k] = await rows<{ user_id: string }>(`SELECT user_id FROM public.pw_keys`);
    expect(k!.user_id).toBe(alice);
  });

  it('satu brankas per user: kunci kedua untuk user yang sama ditolak', async () => {
    await expect(asUser(alice, async () => key(await uuid()))).rejects.toThrow(/duplicate|unique/i);
  });

  it('RLS: bob tidak melihat, tidak mengubah, dan tidak menghapus brankas/sandi milik alice', async () => {
    const id = await uuid();
    await asUser(alice, () => item(id));

    const seen = await asUser(bob, () => rows(`SELECT id FROM public.pw_items`));
    expect(seen).toEqual([]);
    const keysSeen = await asUser(bob, () => rows(`SELECT id FROM public.pw_keys`));
    expect(keysSeen).toEqual([]);

    await asUser(bob, () =>
      pg.query(`UPDATE public.pw_items SET enc = $1 WHERE id = $2`, [b64(50), id]),
    );
    await asUser(bob, () => pg.query(`DELETE FROM public.pw_items WHERE id = $1`, [id]));
    const [still] = await rows<{ enc: string }>(`SELECT enc FROM public.pw_items WHERE id = $1`, [
      id,
    ]);
    expect(still!.enc).toBe(b64(100)); // tidak berubah & tidak terhapus

    // dan alice sendiri bisa melihatnya
    expect(
      await asUser(alice, () => rows(`SELECT id FROM public.pw_items WHERE id = $1`, [id])),
    ).toHaveLength(1);
  });

  it('RLS: bob tidak bisa menyisipkan baris atas nama alice', async () => {
    await expect(
      asUser(bob, async () =>
        pg.query(`INSERT INTO public.pw_items (id, user_id, enc) VALUES ($1, $2, $3)`, [
          await uuid(),
          alice,
          b64(100),
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('anon (belum login) tidak punya akses sama sekali', async () => {
    await pg.exec('SET ROLE anon');
    try {
      await expect(pg.query(`SELECT * FROM public.pw_items`)).rejects.toThrow(/permission denied/i);
      await expect(pg.query(`SELECT * FROM public.pw_keys`)).rejects.toThrow(/permission denied/i);
    } finally {
      await pg.exec('RESET ROLE');
    }
  });

  it('pw_keys tidak bisa DIHAPUS lewat API, bahkan oleh pemiliknya (pw_items tetap bisa)', async () => {
    const [k] = await rows<{ id: string }>(`SELECT id FROM public.pw_keys WHERE user_id = $1`, [
      alice,
    ]);
    await expect(
      asUser(alice, () => pg.query(`DELETE FROM public.pw_keys WHERE id = $1`, [k!.id])),
    ).rejects.toThrow(/permission denied/i);
    expect(await rows(`SELECT 1 FROM public.pw_keys WHERE id = $1`, [k!.id])).toHaveLength(1);

    const id = await uuid();
    await asUser(alice, () => item(id));
    await asUser(alice, () => pg.query(`DELETE FROM public.pw_items WHERE id = $1`, [id]));
    expect(await rows(`SELECT 1 FROM public.pw_items WHERE id = $1`, [id])).toEqual([]);
  });

  it('UPDATE kunci biasa (klien versi lama) DINETRALKAN: kunci tetap, tulisan tanpa label sejak itu ditolak', async () => {
    // Akun sendiri: tes ini menyalakan "label wajib", yang akan mengubah perilaku tes lain
    const dave = (
      await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`)
    )[0]!.id;
    const keyId = await uuid();
    await asUser(dave, () => key(keyId));
    await expect(asUser(dave, async () => item(await uuid()))).resolves.toBeDefined(); // lama: ok

    // Tidak dilempar: klien lama yang ditolak akan mengulang selamanya dan antreannya macet
    await expect(
      asUser(dave, () =>
        pg.query(`UPDATE public.pw_keys SET salt = $1, wrapped_key = $2 WHERE id = $3`, [
          b64(30),
          b64(90),
          keyId,
        ]),
      ),
    ).resolves.toBeDefined();
    const [after] = await rows<{
      salt: string;
      wrapped_key: string;
      labels_required_at: Date | null;
    }>(`SELECT salt, wrapped_key, labels_required_at FROM public.pw_keys WHERE id = $1`, [keyId]);
    expect(after).toMatchObject({ salt: b64(24), wrapped_key: b64(80) });
    expect(after!.labels_required_at).not.toBeNull();
    // Tulisan berikutnya klien itu memakai DEK yang tidak pernah diterima server → ditolak
    await expect(asUser(dave, async () => item(await uuid()))).rejects.toMatchObject({
      code: '23V03',
    });
    // UPDATE yang tidak menyentuh materi kunci tetap boleh
    await expect(
      asUser(dave, () =>
        pg.query(`UPDATE public.pw_keys SET updated_at = now() WHERE id = $1`, [keyId]),
      ),
    ).resolves.toBeDefined();
  });

  it('parameter KDF lemah ditolak: iterasi < 100 ribu, KDF tak dikenal, salt/kunci terlalu pendek', async () => {
    const bad: Record<string, unknown>[] = [
      { iterations: 1000 },
      { iterations: 100_000_000 },
      { kdf: 'md5' },
      { salt: b64(4) },
      { wrapped_key: b64(10) },
      { recovery_wrapped_key: '' },
      { version: 0 },
    ];
    for (const over of bad) {
      await expect(
        asUser(bob, async () => key(await uuid(), over)),
        JSON.stringify(over),
      ).rejects.toThrow(/check/i);
    }
  });

  it('batas ukuran enc: terlalu pendek (bukan ciphertext) dan > 256 KB ditolak', async () => {
    // Data terenkripsi butuh brankas (trigger vault_enc_guard); bob membuatnya di sini — setelah
    // tes RLS di atas yang memastikan bob tidak melihat kunci siapa pun.
    await asUser(bob, async () => key(await uuid()));
    for (const enc of ['', 'x'.repeat(10), 'x'.repeat(262145)]) {
      await expect(
        asUser(bob, async () => item(await uuid(), enc)),
        `${enc.length}`,
      ).rejects.toThrow(/check/i);
    }
    await expect(
      asUser(bob, async () => item(await uuid(), 'x'.repeat(262144))),
    ).resolves.toBeDefined();
  });

  it('hapus lunak: deleted_at terisi, baris tetap ada (disinkron sebagai perubahan biasa)', async () => {
    const id = await uuid();
    await asUser(bob, () => item(id));
    await asUser(bob, () =>
      pg.query(`UPDATE public.pw_items SET deleted_at = now() WHERE id = $1`, [id]),
    );
    const [r] = await rows<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM public.pw_items WHERE id = $1`,
      [id],
    );
    expect(r!.deleted_at).not.toBeNull();
  });

  it('pw_totp_log: RLS milik sendiri, anon tanpa akses, dan pemilik boleh menghapus (retensi)', async () => {
    const id = await uuid();
    await asUser(alice, () =>
      pg.query(`INSERT INTO public.pw_totp_log (id, enc) VALUES ($1, $2)`, [id, b64(100)]),
    );

    // bob tidak melihat & tidak bisa menghapus
    expect(await asUser(bob, () => rows(`SELECT id FROM public.pw_totp_log`))).toEqual([]);
    await asUser(bob, () => pg.query(`DELETE FROM public.pw_totp_log WHERE id = $1`, [id]));
    expect(await rows(`SELECT 1 FROM public.pw_totp_log WHERE id = $1`, [id])).toHaveLength(1);

    // bob tidak bisa menulis atas nama alice
    await expect(
      asUser(bob, async () =>
        pg.query(`INSERT INTO public.pw_totp_log (id, user_id, enc) VALUES ($1, $2, $3)`, [
          await uuid(),
          alice,
          b64(100),
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);

    await pg.exec('SET ROLE anon');
    try {
      await expect(pg.query(`SELECT * FROM public.pw_totp_log`)).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await pg.exec('RESET ROLE');
    }

    // pemilik boleh menghapus — dipakai pembersihan retensi di klien
    await asUser(alice, () => pg.query(`DELETE FROM public.pw_totp_log WHERE id = $1`, [id]));
    expect(await rows(`SELECT 1 FROM public.pw_totp_log WHERE id = $1`, [id])).toEqual([]);
  });

  it('menghapus akun menghapus seluruh brankas & sandinya (ON DELETE CASCADE)', async () => {
    const carol = (
      await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`)
    )[0]!.id;
    await asUser(carol, async () => key(await uuid()));
    await asUser(carol, async () => item(await uuid()));
    const logId = await uuid();
    await asUser(carol, () =>
      pg.query(`INSERT INTO public.pw_totp_log (id, enc) VALUES ($1, $2)`, [logId, b64(100)]),
    );
    expect(await rows(`SELECT 1 FROM public.pw_totp_log WHERE id = $1`, [logId])).toHaveLength(1);

    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [carol]);
    expect(await rows(`SELECT 1 FROM public.pw_keys WHERE user_id = $1`, [carol])).toEqual([]);
    expect(await rows(`SELECT 1 FROM public.pw_totp_log WHERE user_id = $1`, [carol])).toEqual([]);
    expect(await rows(`SELECT 1 FROM public.pw_items WHERE user_id = $1`, [carol])).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// Vault · Konfigurasi: config_files & config_versions
// -----------------------------------------------------------------------------------------
describe('Vault · konfigurasi berversi', () => {
  const ENC = 'A'.repeat(100);
  let alice: string;
  let bob: string;

  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await pg.exec('SET ROLE authenticated');
    await pg.query(`SELECT set_config('app.uid', $1, false)`, [uid]);
    try {
      return await fn();
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('app.uid', '', false)`);
    }
  }
  const uuid = () => rows<{ id: string }>(`SELECT gen_random_uuid() AS id`).then((r) => r[0]!.id);
  const file = async (
    over: { name?: string; format?: string; environment?: string | null; project_id?: string } = {},
  ) => {
    const id = await uuid();
    await pg.query(
      `INSERT INTO public.config_files (id, name, format, environment, project_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        over.name ?? '.env',
        over.format ?? 'env',
        over.environment === undefined ? 'production' : over.environment,
        over.project_id ?? null,
      ],
    );
    return id;
  };
  const version = async (fileId: string, enc = ENC) => {
    const id = await uuid();
    await pg.query(`INSERT INTO public.config_versions (id, file_id, enc) VALUES ($1, $2, $3)`, [
      id,
      fileId,
      enc,
    ]);
    return id;
  };
  const project = async () => {
    const id = await uuid();
    await pg.query(`INSERT INTO public.code_projects (id, name) VALUES ($1, 'proj')`, [id]);
    return id;
  };

  beforeAll(async () => {
    alice = (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!
      .id;
    bob = (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!.id;
    // Isi versi dienkripsi DEK brankas → butuh brankas (trigger vault_enc_guard)
    for (const uid of [alice, bob])
      await asUser(uid, () =>
        pg.query(
          `INSERT INTO public.pw_keys (id, kdf, iterations, salt, wrapped_key, recovery_salt, recovery_wrapped_key)
           VALUES (gen_random_uuid(), 'pbkdf2-sha256', 600000, $1, $2, $1, $2)`,
          ['S'.repeat(24), 'W'.repeat(80)],
        ),
      );
  });

  it('pemilik membuat berkas + beberapa versi; user_id terisi dari auth.uid(), tanpa UNIQUE nomor versi', async () => {
    const f = await asUser(alice, () => file());
    await asUser(alice, () => version(f));
    await asUser(alice, () => version(f)); // dua versi untuk berkas sama: boleh (nomor dihitung klien)
    const v = await rows<{ user_id: string }>(
      `SELECT user_id FROM public.config_versions WHERE file_id = $1`,
      [f],
    );
    expect(v).toHaveLength(2);
    expect(v.every((r) => r.user_id === alice)).toBe(true);
  });

  it('RLS: bob tidak melihat, mengubah, atau menghapus berkas & versi milik alice; anon tanpa akses', async () => {
    const f = await asUser(alice, () => file({ name: 'rahasia.env' }));
    const v = await asUser(alice, () => version(f));

    expect(await asUser(bob, () => rows(`SELECT id FROM public.config_files`))).toEqual([]);
    expect(await asUser(bob, () => rows(`SELECT id FROM public.config_versions`))).toEqual([]);
    await asUser(bob, () =>
      pg.query(`UPDATE public.config_files SET name = 'x' WHERE id = $1`, [f]),
    );
    await asUser(bob, () => pg.query(`DELETE FROM public.config_versions WHERE id = $1`, [v]));
    const [still] = await rows<{ name: string }>(
      `SELECT name FROM public.config_files WHERE id = $1`,
      [f],
    );
    expect(still!.name).toBe('rahasia.env');
    expect(await rows(`SELECT 1 FROM public.config_versions WHERE id = $1`, [v])).toHaveLength(1);

    await pg.exec('SET ROLE anon');
    try {
      for (const t of ['config_files', 'config_versions'])
        await expect(pg.query(`SELECT * FROM public.${t}`), t).rejects.toThrow(
          /permission denied/i,
        );
    } finally {
      await pg.exec('RESET ROLE');
    }
  });

  it('rujukan lintas akun ditolak: versi ke berkas orang lain, berkas ke project orang lain', async () => {
    const aliceFile = await asUser(alice, () => file());
    const aliceProject = await asUser(alice, () => project());

    await expect(asUser(bob, () => version(aliceFile))).rejects.toThrow(/milik user yang sama/);
    await expect(asUser(bob, () => file({ project_id: aliceProject }))).rejects.toThrow(
      /milik user yang sama/,
    );
    // Berkas milik sendiri tidak bisa dipindah ke project orang lain lewat UPDATE
    const bobFile = await asUser(bob, () => file());
    await expect(
      asUser(bob, () =>
        pg.query(`UPDATE public.config_files SET project_id = $1 WHERE id = $2`, [
          aliceProject,
          bobFile,
        ]),
      ),
    ).rejects.toThrow(/milik user yang sama/);
    // UUID yang tidak ada → pesan yang SAMA (tidak membocorkan apakah UUID itu ada)
    await expect(asUser(bob, async () => version(await uuid()))).rejects.toThrow(
      /milik user yang sama/,
    );
    // Project sendiri boleh
    const bobProject = await asUser(bob, () => project());
    await expect(asUser(bob, () => file({ project_id: bobProject }))).resolves.toBeDefined();
  });

  it('CHECK: format, panjang nama & lingkungan (selaras LIMITS), dan ukuran enc', async () => {
    const bad: Parameters<typeof file>[0][] = [
      { format: 'yaml' },
      { name: '' },
      { name: 'x'.repeat(121) },
      { environment: '' },
      { environment: 'x'.repeat(41) },
    ];
    for (const over of bad)
      await expect(
        asUser(alice, () => file(over)),
        JSON.stringify(over),
      ).rejects.toThrow(/check/i);
    await expect(
      asUser(alice, () => file({ name: 'x'.repeat(120), environment: 'x'.repeat(40) })),
    ).resolves.toBeDefined();
    await expect(asUser(alice, () => file({ environment: null }))).resolves.toBeDefined();

    const f = await asUser(alice, () => file());
    for (const enc of ['', 'x'.repeat(39), 'x'.repeat(360001)])
      await expect(
        asUser(alice, () => version(f, enc)),
        `${enc.length}`,
      ).rejects.toThrow(/check/i);
    await expect(asUser(alice, () => version(f, 'x'.repeat(360000)))).resolves.toBeDefined();
  });

  it('project dihapus permanen → berkas tetap ada sebagai "Tanpa project"; berkas dihapus → versinya ikut', async () => {
    const p = await asUser(alice, () => project());
    const f = await asUser(alice, () => file({ project_id: p }));
    const v = await asUser(alice, () => version(f));

    await asUser(alice, () => pg.query(`DELETE FROM public.code_projects WHERE id = $1`, [p]));
    const [after] = await rows<{ project_id: string | null }>(
      `SELECT project_id FROM public.config_files WHERE id = $1`,
      [f],
    );
    expect(after!.project_id).toBeNull();
    expect(await rows(`SELECT 1 FROM public.config_versions WHERE id = $1`, [v])).toHaveLength(1);

    await asUser(alice, () => pg.query(`DELETE FROM public.config_files WHERE id = $1`, [f]));
    expect(await rows(`SELECT 1 FROM public.config_versions WHERE id = $1`, [v])).toEqual([]);
  });

  it('menghapus akun menghapus seluruh konfigurasinya (ON DELETE CASCADE)', async () => {
    const carol = (
      await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`)
    )[0]!.id;
    await asUser(carol, () =>
      pg.query(
        `INSERT INTO public.pw_keys (id, kdf, iterations, salt, wrapped_key, recovery_salt, recovery_wrapped_key)
         VALUES (gen_random_uuid(), 'pbkdf2-sha256', 600000, $1, $2, $1, $2)`,
        ['S'.repeat(24), 'W'.repeat(80)],
      ),
    );
    const f = await asUser(carol, () => file());
    await asUser(carol, () => version(f));

    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [carol]);
    expect(await rows(`SELECT 1 FROM public.config_files WHERE user_id = $1`, [carol])).toEqual([]);
    expect(await rows(`SELECT 1 FROM public.config_versions WHERE user_id = $1`, [carol])).toEqual(
      [],
    );
  });

  it('fungsi pemeriksa pemilik tidak bisa dipanggil langsung oleh klien', async () => {
    const [{ ok }] = await rows<{ ok: boolean }>(
      `SELECT has_function_privilege('authenticated', 'public.config_check_owner()', 'execute') AS ok`,
    );
    expect(ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------
// Catatan: notes + tipe 'note' di tag/tautan
// -----------------------------------------------------------------------------------------
describe('Catatan · notes', () => {
  let alice: string;
  let bob: string;

  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await pg.exec('SET ROLE authenticated');
    await pg.query(`SELECT set_config('app.uid', $1, false)`, [uid]);
    try {
      return await fn();
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('app.uid', '', false)`);
    }
  }
  const uuid = () => rows<{ id: string }>(`SELECT gen_random_uuid() AS id`).then((r) => r[0]!.id);
  const note = async (
    over: { note_date?: string | null; title?: string | null; content?: string } = {},
  ) => {
    const id = await uuid();
    await pg.query(
      `INSERT INTO public.notes (id, note_date, title, content) VALUES ($1, $2, $3, $4)`,
      [
        id,
        over.note_date === undefined ? null : over.note_date,
        over.title === undefined ? null : over.title,
        over.content ?? 'isi',
      ],
    );
    return id;
  };
  const tag = async () => {
    const id = await uuid();
    await pg.query(`INSERT INTO public.tags (id, name) VALUES ($1, $2)`, [
      id,
      `t-${id.slice(0, 8)}`,
    ]);
    return id;
  };

  beforeAll(async () => {
    alice = (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!
      .id;
    bob = (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!.id;
  });

  it('catatan bebas (tanpa tanggal) dan bertanggal sama-sama valid; user_id terisi otomatis', async () => {
    const free = await asUser(alice, () => note({ note_date: null }));
    const dated = await asUser(alice, () => note({ note_date: '2026-10-15', title: 'Rapat' }));
    const r = await rows<{
      id: string;
      user_id: string;
      note_date: Date | null;
      is_pinned: boolean;
    }>(`SELECT id, user_id, note_date, is_pinned FROM public.notes WHERE id IN ($1, $2)`, [
      free,
      dated,
    ]);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.user_id === alice && x.is_pinned === false)).toBe(true);
    expect(r.find((x) => x.id === free)!.note_date).toBeNull();
    expect(r.find((x) => x.id === dated)!.note_date).not.toBeNull();
  });

  it('satu hari boleh punya banyak catatan (tidak ada UNIQUE pada tanggal)', async () => {
    await asUser(alice, () => note({ note_date: '2026-11-01' }));
    await expect(asUser(alice, () => note({ note_date: '2026-11-01' }))).resolves.toBeDefined();
    const [{ n }] = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.notes WHERE user_id = $1 AND note_date = '2026-11-01'`,
      [alice],
    );
    expect(n).toBe(2);
  });

  it('CHECK judul ≤ 200 karakter (selaras LIMITS.noteTitle)', async () => {
    await expect(asUser(alice, () => note({ title: 'x'.repeat(200) }))).resolves.toBeDefined();
    await expect(asUser(alice, () => note({ title: 'x'.repeat(201) }))).rejects.toThrow(/check/i);
  });

  it('RLS: bob tidak melihat, mengubah, atau menghapus catatan alice; anon tanpa akses', async () => {
    const id = await asUser(alice, () => note({ title: 'rahasia' }));
    expect(
      await asUser(bob, () => rows(`SELECT id FROM public.notes WHERE id = $1`, [id])),
    ).toEqual([]);
    await asUser(bob, () => pg.query(`UPDATE public.notes SET title = 'x' WHERE id = $1`, [id]));
    await asUser(bob, () => pg.query(`DELETE FROM public.notes WHERE id = $1`, [id]));
    const [still] = await rows<{ title: string }>(`SELECT title FROM public.notes WHERE id = $1`, [
      id,
    ]);
    expect(still!.title).toBe('rahasia');

    await expect(
      asUser(bob, async () =>
        pg.query(`INSERT INTO public.notes (id, user_id, content) VALUES ($1, $2, 'x')`, [
          await uuid(),
          alice,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);

    await pg.exec('SET ROLE anon');
    try {
      await expect(pg.query(`SELECT * FROM public.notes`)).rejects.toThrow(/permission denied/i);
    } finally {
      await pg.exec('RESET ROLE');
    }
  });

  it("tag boleh dipasang pada tipe 'note' (constraint taggings diperluas)", async () => {
    const n = await asUser(alice, () => note());
    const t = await asUser(alice, () => tag());
    await expect(
      asUser(alice, async () =>
        pg.query(
          `INSERT INTO public.taggings (id, tag_id, entity_type, entity_id) VALUES ($1, $2, 'note', $3)`,
          [await uuid(), t, n],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("tautan boleh menunjuk 'note' di sisi mana pun, dan note ↔ jurnal valid", async () => {
    const n = await asUser(alice, () => note());
    const other = await uuid();
    const link = (st: string, sid: string, tt: string, tid: string) =>
      asUser(alice, async () =>
        pg.query(
          `INSERT INTO public.entity_links (id, source_type, source_id, target_type, target_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [await uuid(), st, sid, tt, tid],
        ),
      );
    await expect(link('note', n, 'task', other)).resolves.toBeDefined();
    await expect(link('journal_entry', other, 'note', n)).resolves.toBeDefined();
    // tetap tidak boleh menautkan ke dirinya sendiri
    await expect(link('note', n, 'note', n)).rejects.toThrow(/check/i);
  });

  it('tipe entitas yang tidak dikenal TETAP ditolak (constraint tidak longgar)', async () => {
    const t = await asUser(alice, () => tag());
    await expect(
      asUser(alice, async () =>
        pg.query(
          `INSERT INTO public.taggings (id, tag_id, entity_type, entity_id) VALUES ($1, $2, 'bukan_tipe', $3)`,
          [await uuid(), t, await uuid()],
        ),
      ),
    ).rejects.toThrow(/check/i);
    await expect(
      asUser(alice, async () =>
        pg.query(
          `INSERT INTO public.entity_links (id, source_type, source_id, target_type, target_id)
           VALUES ($1, 'bukan_tipe', $2, 'task', $3)`,
          [await uuid(), await uuid(), await uuid()],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('lampiran belum mendukung catatan (entity_type attachments tidak diperluas)', async () => {
    const n = await asUser(alice, () => note());
    await expect(
      asUser(alice, async () =>
        pg.query(
          `INSERT INTO public.attachments (id, entity_type, entity_id, storage_key, file_name, size_bytes, status)
           VALUES ($1, 'note', $2, 'k/' || gen_random_uuid(), 'f.txt', 1, 'pending')`,
          [await uuid(), n],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('hapus lunak: deleted_at terisi, baris tetap ada; menghapus akun menghapus catatannya', async () => {
    const id = await asUser(alice, () => note());
    await asUser(alice, () =>
      pg.query(`UPDATE public.notes SET deleted_at = now() WHERE id = $1`, [id]),
    );
    const [r] = await rows<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM public.notes WHERE id = $1`,
      [id],
    );
    expect(r!.deleted_at).not.toBeNull();

    const carol = (
      await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`)
    )[0]!.id;
    await asUser(carol, () => note());
    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [carol]);
    expect(await rows(`SELECT 1 FROM public.notes WHERE user_id = $1`, [carol])).toEqual([]);
  });

  it('publication powersync memuat notes dengan REPLICA IDENTITY FULL', async () => {
    const [p] = await rows<{ relreplident: string }>(
      `SELECT c.relreplident FROM pg_class c JOIN pg_publication_tables t ON t.tablename = c.relname
        WHERE t.pubname = 'powersync' AND t.tablename = 'notes'`,
    );
    expect(p?.relreplident).toBe('f');
  });
});

// -----------------------------------------------------------------------------------------
// Rujukan antar tabel inti harus milik user yang sama (check_ref_owner)
// -----------------------------------------------------------------------------------------
describe('rujukan lintas akun · tabel inti', () => {
  let alice: string;
  let bob: string;

  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await pg.exec('SET ROLE authenticated');
    await pg.query(`SELECT set_config('app.uid', $1, false)`, [uid]);
    try {
      return await fn();
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('app.uid', '', false)`);
    }
  }
  const uuid = () => rows<{ id: string }>(`SELECT gen_random_uuid() AS id`).then((r) => r[0]!.id);
  /** Dompet default akun (dibuat trigger seed) — dibaca sebagai superuser. */
  const walletOf = async (uid: string) =>
    (
      await rows<{ id: string }>(`SELECT id FROM public.wallets WHERE user_id = $1 LIMIT 1`, [uid])
    )[0]!.id;
  const expense = (walletId: string, extra = '') =>
    pg.query(
      `INSERT INTO public.transactions (id, kind, amount, wallet_id, occurred_on${extra ? ', task_id' : ''})
       VALUES (gen_random_uuid(), 'expense', 1000, $1, current_date${extra ? ', $2' : ''})`,
      extra ? [walletId, extra] : [walletId],
    );

  beforeAll(async () => {
    const make = async () =>
      (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!.id;
    alice = await make();
    bob = await make();
  });

  it('transaksi ke dompet / tugas orang lain ditolak dengan pesan yang sama seperti UUID tak dikenal', async () => {
    const aliceWallet = await walletOf(alice);
    const bobWallet = await walletOf(bob);
    await expect(asUser(bob, () => expense(aliceWallet))).rejects.toThrow(/milik user yang sama/);

    const aliceTask = await uuid();
    await asUser(alice, () =>
      pg.query(`INSERT INTO public.tasks (id, title) VALUES ($1, 'rahasia')`, [aliceTask]),
    );
    await expect(asUser(bob, () => expense(bobWallet, aliceTask))).rejects.toThrow(
      /milik user yang sama/,
    );
    await expect(asUser(bob, () => expense(bobWallet))).resolves.toBeDefined();
  });

  it('UPDATE tidak bisa memindahkan rujukan ke milik orang lain', async () => {
    const aliceList = await uuid();
    await asUser(alice, () =>
      pg.query(`INSERT INTO public.task_lists (id, name) VALUES ($1, 'Kerja')`, [aliceList]),
    );
    const bobTask = await uuid();
    await asUser(bob, () =>
      pg.query(`INSERT INTO public.tasks (id, title) VALUES ($1, 'punya bob')`, [bobTask]),
    );
    await expect(
      asUser(bob, () =>
        pg.query(`UPDATE public.tasks SET list_id = $1 WHERE id = $2`, [aliceList, bobTask]),
      ),
    ).rejects.toThrow(/milik user yang sama/);
    // UPDATE kolom lain pada baris yang rujukannya sah tetap jalan
    await expect(
      asUser(bob, () =>
        pg.query(`UPDATE public.tasks SET title = 'ganti' WHERE id = $1`, [bobTask]),
      ),
    ).resolves.toBeDefined();
  });

  it('tag orang lain dan kategori orang lain (anggaran, sub-kategori) ditolak', async () => {
    const aliceTag = await uuid();
    await asUser(alice, () =>
      pg.query(`INSERT INTO public.tags (id, name) VALUES ($1, 'privat')`, [aliceTag]),
    );
    await expect(
      asUser(bob, () =>
        pg.query(
          `INSERT INTO public.taggings (id, tag_id, entity_type, entity_id)
           VALUES (gen_random_uuid(), $1, 'task', gen_random_uuid())`,
          [aliceTag],
        ),
      ),
    ).rejects.toThrow(/milik user yang sama/);

    const [{ id: aliceCat }] = await rows<{ id: string }>(
      `SELECT id FROM public.categories WHERE user_id = $1 LIMIT 1`,
      [alice],
    );
    await expect(
      asUser(bob, () =>
        pg.query(
          `INSERT INTO public.budgets (id, category_id, amount, start_month)
           VALUES (gen_random_uuid(), $1, 100, date_trunc('month', now())::date)`,
          [aliceCat],
        ),
      ),
    ).rejects.toThrow(/milik user yang sama/);
    await expect(
      asUser(bob, () =>
        pg.query(
          `INSERT INTO public.categories (id, name, kind, parent_id)
           VALUES (gen_random_uuid(), 'Anak', 'expense', $1)`,
          [aliceCat],
        ),
      ),
    ).rejects.toThrow(/milik user yang sama/);
  });

  it('upsert massal dengan subtugas SEBELUM induknya tetap diterima (seperti FK)', async () => {
    const parent = await uuid();
    const child = await uuid();
    await expect(
      asUser(alice, () =>
        pg.query(
          `INSERT INTO public.tasks (id, title, parent_id) VALUES ($1, 'anak', $2), ($2, 'induk', NULL)`,
          [child, parent],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('menghapus permanen daftar milik sendiri tetap mengosongkan list_id tugasnya', async () => {
    const list = await uuid();
    const task = await uuid();
    await asUser(alice, async () => {
      await pg.query(`INSERT INTO public.task_lists (id, name) VALUES ($1, 'Sementara')`, [list]);
      await pg.query(`INSERT INTO public.tasks (id, title, list_id) VALUES ($1, 'x', $2)`, [
        task,
        list,
      ]);
      await pg.query(`DELETE FROM public.task_lists WHERE id = $1`, [list]);
    });
    const [r] = await rows<{ list_id: string | null }>(
      `SELECT list_id FROM public.tasks WHERE id = $1`,
      [task],
    );
    expect(r!.list_id).toBeNull();
  });

  it('fungsi pemeriksa tidak bisa dipanggil langsung oleh klien', async () => {
    const [{ ok }] = await rows<{ ok: boolean }>(
      `SELECT has_function_privilege('authenticated', 'public.check_ref_owner()', 'execute') AS ok`,
    );
    expect(ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------
// MFA: akun dengan authenticator terverifikasi wajib token aal2 (policy restrictive mfa_aal2)
// -----------------------------------------------------------------------------------------
describe('MFA · policy restrictive mfa_aal2', () => {
  let withMfa: string;
  let withoutMfa: string;

  async function as<T>(uid: string, aal: 'aal1' | 'aal2', fn: () => Promise<T>): Promise<T> {
    await pg.exec('SET ROLE authenticated');
    await pg.query(`SELECT set_config('app.uid', $1, false)`, [uid]);
    await pg.query(`SELECT set_config('app.jwt', $1, false)`, [JSON.stringify({ sub: uid, aal })]);
    try {
      return await fn();
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('app.uid', '', false)`);
      await pg.query(`SELECT set_config('app.jwt', '', false)`);
    }
  }
  const myTasks = () => rows(`SELECT id FROM public.tasks`);
  const addTask = (title: string) =>
    pg.query(`INSERT INTO public.tasks (id, title) VALUES (gen_random_uuid(), $1)`, [title]);

  beforeAll(async () => {
    const make = async () =>
      (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!.id;
    withMfa = await make();
    withoutMfa = await make();
    await as(withMfa, 'aal1', () => addTask('dibuat sebelum MFA aktif'));
    await pg.query(`INSERT INTO auth.mfa_factors (user_id, status) VALUES ($1, 'verified')`, [
      withMfa,
    ]);
    // Faktor yang belum diverifikasi tidak mengaktifkan penegakan
    await pg.query(`INSERT INTO auth.mfa_factors (user_id, status) VALUES ($1, 'unverified')`, [
      withoutMfa,
    ]);
  });

  it('punya MFA + token aal1 (password saja): tidak bisa membaca maupun menulis', async () => {
    expect(await as(withMfa, 'aal1', myTasks)).toEqual([]);
    await expect(as(withMfa, 'aal1', () => addTask('penyusup'))).rejects.toThrow(
      /row-level security/,
    );
    await as(withMfa, 'aal1', () => pg.query(`DELETE FROM public.tasks`));
    expect(await as(withMfa, 'aal2', myTasks)).toHaveLength(1); // DELETE tadi tidak mengenai apa pun
  });

  it('punya MFA + token aal2: akses normal', async () => {
    await expect(as(withMfa, 'aal2', () => addTask('sah'))).resolves.toBeDefined();
    expect(await as(withMfa, 'aal2', myTasks)).toHaveLength(2);
  });

  it('belum punya MFA terverifikasi: aal1 tetap boleh (agar bisa mendaftarkan authenticator)', async () => {
    await expect(as(withoutMfa, 'aal1', () => addTask('x'))).resolves.toBeDefined();
    expect(await as(withoutMfa, 'aal1', myTasks)).toHaveLength(1);
  });

  it('SETIAP tabel yang dibuka untuk klien punya policy restrictive mfa_aal2', async () => {
    const owner = await rows<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'owner_select'`,
    );
    const granted = await rows<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee = 'authenticated'`,
    );
    const mfa = await rows<{ tablename: string; permissive: string }>(
      `SELECT tablename, permissive FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'mfa_aal2'`,
    );
    const names = (r: { tablename?: string; table_name?: string }[]) =>
      r.map((x) => x.tablename ?? x.table_name).sort();
    expect(names(granted)).toEqual(names(owner));
    expect(names(mfa)).toEqual(names(owner));
    expect(mfa.every((m) => m.permissive === 'RESTRICTIVE')).toBe(true);
    expect(names(mfa)).toContain('push_subscriptions');
  });

  it('fungsi mfa_satisfied tidak bisa dipanggil anon', async () => {
    const [{ ok }] = await rows<{ ok: boolean }>(
      `SELECT has_function_privilege('anon', 'public.mfa_satisfied()', 'execute') AS ok`,
    );
    expect(ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------
// Sandi · penjaga kunci brankas (migrasi …_vault_key_guard.sql)
// Rotasi kunci tidak boleh bisa menghasilkan data yang tidak terbuka selamanya.
// -----------------------------------------------------------------------------------------
describe('Sandi · penjaga kunci brankas (label kunci, rotasi atomik)', () => {
  const W1 = 'A'.repeat(60) + 'kunci-1';
  const W2 = 'B'.repeat(60) + 'kunci-2';
  const W3 = 'C'.repeat(60) + 'kunci-3';
  const body = 'Z'.repeat(80);
  let ref1: string;
  let ref2: string;
  let ref3: string;

  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await pg.exec('SET ROLE authenticated');
    await pg.query(`SELECT set_config('app.uid', $1, false)`, [uid]);
    try {
      return await fn();
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('app.uid', '', false)`);
    }
  }
  const uuid = () => rows<{ id: string }>(`SELECT gen_random_uuid() AS id`).then((r) => r[0]!.id);
  const newUser = async () =>
    (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!.id;
  const makeKey = async (uid: string, wrapped = W1) => {
    const id = await uuid();
    await asUser(uid, () =>
      pg.query(
        `INSERT INTO public.pw_keys (id, kdf, iterations, salt, wrapped_key, recovery_salt, recovery_wrapped_key)
         VALUES ($1, 'pbkdf2-sha256', 600000, $2, $3, $2, $3)`,
        [id, 'S'.repeat(24), wrapped],
      ),
    );
    return id;
  };
  const putItem = (uid: string, id: string, enc: string) =>
    asUser(uid, () => pg.query(`INSERT INTO public.pw_items (id, enc) VALUES ($1, $2)`, [id, enc]));
  const setItem = (uid: string, id: string, enc: string) =>
    asUser(uid, () => pg.query(`UPDATE public.pw_items SET enc = $1 WHERE id = $2`, [enc, id]));
  const encOf = async (id: string) =>
    (await rows<{ enc: string }>(`SELECT enc FROM public.pw_items WHERE id = $1`, [id]))[0]!.enc;
  const keyOf = async (uid: string) =>
    (
      await rows<{
        wrapped_key: string;
        salt: string;
        rotated_from: string | null;
        labels_required_at: Date | null;
      }>(
        `SELECT wrapped_key, salt, rotated_from, labels_required_at FROM public.pw_keys WHERE user_id = $1`,
        [uid],
      )
    )[0]!;
  const rotate = (uid: string, key: Record<string, unknown>, rowsArg: unknown[]) =>
    asUser(uid, async () => {
      const res = await pg.query<{ r: Record<string, unknown> }>(
        `SELECT public.apply_vault_rotation($1::jsonb, $2::jsonb) AS r`,
        [JSON.stringify(key), JSON.stringify(rowsArg)],
      );
      return res.rows[0]!.r;
    });

  beforeAll(async () => {
    [ref1, ref2, ref3] = await Promise.all([keyRef(W1), keyRef(W2), keyRef(W3)]);
  });

  it('vault_key_ref() di SQL = keyRef()/sha256Hex16() di klien (vektor SHA-256 yang sama + kunci acak)', async () => {
    const [{ a, w, e }] = await rows<{ a: string; w: string; e: string }>(
      `SELECT public.vault_key_ref('abc') AS a, public.vault_key_ref($1) AS w,
              public.vault_key_ref($2) AS e`,
      [W1, `${'0'.repeat(16)}.ciphertext ✨`],
    );
    expect(a).toBe('ba7816bf8f01cfea');
    expect(w).toBe(ref1);
    expect(e).toBe(await sha256Hex16(`${'0'.repeat(16)}.ciphertext ✨`)); // UTF-8 sama
  });

  it('tabel ber-trigger vault_enc_guard = VAULT_ENCRYPTED_TABLES di schema.ts', async () => {
    const t = await rows<{ relname: string }>(
      `SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
        WHERE g.tgname = 'vault_enc_guard' ORDER BY c.relname`,
    );
    expect(t.map((r) => r.relname)).toEqual([...VAULT_ENCRYPTED_TABLES].sort());
  });

  it('sebelum rotasi: label kunci saat ini & format lama diterima; label lain dan tanpa brankas ditolak', async () => {
    const u = await newUser();
    await expect(putItem(u, await uuid(), `${ref1}.${body}`)).rejects.toMatchObject({
      code: '23V03',
    }); // belum ada brankas
    await makeKey(u);
    await expect(putItem(u, await uuid(), `${ref1}.${body}`)).resolves.toBeDefined();
    await expect(putItem(u, await uuid(), body)).resolves.toBeDefined(); // klien versi lama
    await expect(putItem(u, await uuid(), `${ref2}.${body}`)).rejects.toMatchObject({
      code: '23V03',
    });
  });

  it('klien tidak bisa mengarang riwayat rotasi / "label wajib" saat membuat brankas', async () => {
    const u = await newUser();
    const id = await uuid();
    await asUser(u, () =>
      pg.query(
        `INSERT INTO public.pw_keys (id, kdf, iterations, salt, wrapped_key, recovery_salt, recovery_wrapped_key, rotated_from, labels_required_at)
         VALUES ($1, 'pbkdf2-sha256', 600000, $2, $3, $2, $3, $4, now())`,
        [id, 'S'.repeat(24), W1, ref2],
      ),
    );
    expect(await keyOf(u)).toMatchObject({ rotated_from: null, labels_required_at: null });
  });

  /** Brankas dengan isi lengkap: item berlabel, item lama, riwayat TOTP, dan versi konfigurasi. */
  async function vaultWithData() {
    const u = await newUser();
    const keyId = await makeKey(u);
    const ids = { i1: await uuid(), legacy: await uuid(), log: await uuid(), ver: await uuid() };
    const old = {
      i1: `${ref1}.${body}`,
      legacy: body,
      log: `${ref1}.log${body}`,
      ver: `${ref1}.ver${body}`,
    };
    await putItem(u, ids.i1, old.i1);
    await putItem(u, ids.legacy, old.legacy);
    await asUser(u, async () => {
      await pg.query(`INSERT INTO public.pw_totp_log (id, enc) VALUES ($1, $2)`, [
        ids.log,
        old.log,
      ]);
      const f = await uuid();
      await pg.query(
        `INSERT INTO public.config_files (id, name, format) VALUES ($1, '.env', 'env')`,
        [f],
      );
      await pg.query(`INSERT INTO public.config_versions (id, file_id, enc) VALUES ($1, $2, $3)`, [
        ids.ver,
        f,
        old.ver,
      ]);
    });
    /** Baris rotasi seperti dari connector: `b` = sidik enc LAMA yang didekripsi klien. */
    const allRows = async (enc: (r: string) => string | null) => [
      { t: 'pw_items', id: ids.i1, enc: enc('i1'), b: await sha256Hex16(old.i1) },
      // tak terbaca di klien: dipertimbangkan saja
      { t: 'pw_items', id: ids.legacy, enc: null, b: await sha256Hex16(old.legacy) },
      { t: 'pw_totp_log', id: ids.log, enc: enc('log'), b: await sha256Hex16(old.log) },
      { t: 'config_versions', id: ids.ver, enc: enc('ver'), b: await sha256Hex16(old.ver) },
    ];
    return { u, keyId, ids, allRows };
  }

  it('rotasi atomik: kunci + seluruh isi berganti dalam SATU transaksi; baris "dipertimbangkan" tidak diubah', async () => {
    const { u, keyId, ids, allRows } = await vaultWithData();
    const r = await rotate(
      u,
      { id: keyId, wrapped_key: W2, salt: 'T'.repeat(24), rotated_from: ref1 },
      await allRows((n) => `${ref2}.${n}${body}`),
    );
    expect(r).toEqual({ reencrypted: 3 });

    const k = await keyOf(u);
    expect(k).toMatchObject({ wrapped_key: W2, salt: 'T'.repeat(24), rotated_from: ref1 });
    expect(k.labels_required_at).not.toBeNull();
    expect(await encOf(ids.i1)).toBe(`${ref2}.i1${body}`);
    expect(await encOf(ids.legacy)).toBe(body);
    const [{ log }] = await rows<{ log: string }>(
      `SELECT enc AS log FROM public.pw_totp_log WHERE id = $1`,
      [ids.log],
    );
    const [{ ver }] = await rows<{ ver: string }>(
      `SELECT enc AS ver FROM public.config_versions WHERE id = $1`,
      [ids.ver],
    );
    expect([log, ver]).toEqual([`${ref2}.log${body}`, `${ref2}.ver${body}`]);
  });

  it('mengulang rotasi yang SUDAH diterima (respons hilang di jaringan) = sukses, bukan ditolak', async () => {
    const { u, keyId, allRows } = await vaultWithData();
    const key = { id: keyId, wrapped_key: W2, rotated_from: ref1 };
    const rowsArg = await allRows((n) => `${ref2}.${n}${body}`);
    await rotate(u, key, rowsArg);
    await expect(rotate(u, key, rowsArg)).resolves.toEqual({ reencrypted: 0, replayed: true });
    expect((await keyOf(u)).wrapped_key).toBe(W2);
  });

  it('SETELAH rotasi: tulisan dengan kunci lama atau tanpa label ditolak (perangkat yang offline); kunci baru & hapus lunak tetap jalan', async () => {
    const { u, keyId, ids, allRows } = await vaultWithData();
    await rotate(
      u,
      { id: keyId, wrapped_key: W2, rotated_from: ref1 },
      await allRows(() => `${ref2}.${body}`),
    );

    // Perangkat lain masih memakai DEK lama: edit & item baru ditolak, versi di server utuh
    await expect(setItem(u, ids.i1, `${ref1}.edit-offline${body}`)).rejects.toMatchObject({
      code: '23V03',
    });
    await expect(putItem(u, await uuid(), `${ref1}.${body}`)).rejects.toMatchObject({
      code: '23V03',
    });
    await expect(setItem(u, ids.i1, `edit-klien-lama${body}`)).rejects.toMatchObject({
      code: '23V03',
    });
    expect(await encOf(ids.i1)).toBe(`${ref2}.${body}`);

    await expect(setItem(u, ids.i1, `${ref2}.edit-baru${body}`)).resolves.toBeDefined();
    // UPDATE yang tidak mengubah isi tidak diperiksa (mis. hapus lunak baris format lama)
    await expect(
      asUser(u, () =>
        pg.query(`UPDATE public.pw_items SET deleted_at = now() WHERE id = $1`, [ids.legacy]),
      ),
    ).resolves.toBeDefined();
  });

  it('compare-and-swap: rotasi dari kunci yang SUDAH diganti perangkat lain ditolak (23V01), tidak ada yang berubah', async () => {
    const { u, keyId, ids, allRows } = await vaultWithData();
    await rotate(
      u,
      { id: keyId, wrapped_key: W2, rotated_from: ref1 },
      await allRows(() => `${ref2}.${body}`),
    );
    // Perangkat kedua masih mengira kuncinya W1
    await expect(
      rotate(
        u,
        { id: keyId, wrapped_key: W3, rotated_from: ref1 },
        await allRows(() => `${ref3}.${body}`),
      ),
    ).rejects.toMatchObject({ code: '23V01' });
    expect((await keyOf(u)).wrapped_key).toBe(W2);
    expect(await encOf(ids.i1)).toBe(`${ref2}.${body}`);
  });

  it('kelengkapan: ada baris di server yang tidak ikut dirotasi → ditolak (23V02), kunci TIDAK berganti', async () => {
    const { u, keyId, ids, allRows } = await vaultWithData();
    // Item yang dibuat perangkat lain dan belum sampai ke perangkat yang merotasi
    await putItem(u, await uuid(), `${ref1}.${body}`);
    await expect(
      rotate(
        u,
        { id: keyId, wrapped_key: W2, rotated_from: ref1 },
        await allRows(() => `${ref2}.${body}`),
      ),
    ).rejects.toMatchObject({ code: '23V02' });
    expect((await keyOf(u)).wrapped_key).toBe(W1);
    expect(await encOf(ids.i1)).toBe(`${ref1}.${body}`);
  });

  it('kelengkapan berlaku per tabel: riwayat TOTP / versi konfigurasi yang terlewat juga ditolak', async () => {
    for (const drop of ['pw_totp_log', 'config_versions']) {
      const { u, keyId, allRows } = await vaultWithData();
      const partial = (await allRows(() => `${ref2}.${body}`)).filter((r) => r.t !== drop);
      await expect(
        rotate(u, { id: keyId, wrapped_key: W2, rotated_from: ref1 }, partial),
        drop,
      ).rejects.toMatchObject({ code: '23V02' });
      expect((await keyOf(u)).wrapped_key, drop).toBe(W1);
    }
  });

  it('versi: baris yang diubah perangkat lain sejak dienkripsi ulang → ditolak (23V02), edit itu TIDAK tertimpa', async () => {
    const { u, keyId, ids, allRows } = await vaultWithData();
    const rowsArg = await allRows(() => `${ref2}.${body}`); // perangkat A memotret versi lama
    await setItem(u, ids.i1, `${ref1}.edit-perangkat-B${body}`); // B mengedit, masih kunci lama
    await expect(
      rotate(u, { id: keyId, wrapped_key: W2, rotated_from: ref1 }, rowsArg),
    ).rejects.toMatchObject({ code: '23V02' });
    expect(await encOf(ids.i1)).toBe(`${ref1}.edit-perangkat-B${body}`);
    expect((await keyOf(u)).wrapped_key).toBe(W1);
  });

  it('atomik: satu baris gagal (label salah) → SELURUH rotasi batal, termasuk kunci', async () => {
    const { u, keyId, ids, allRows } = await vaultWithData();
    const bad = await allRows(() => `${ref2}.${body}`);
    bad[2] = { ...bad[2]!, enc: `${ref3}.${body}` };
    await expect(
      rotate(u, { id: keyId, wrapped_key: W2, rotated_from: ref1 }, bad),
    ).rejects.toMatchObject({ code: '23V03' });
    expect((await keyOf(u)).wrapped_key).toBe(W1);
    expect(await encOf(ids.i1)).toBe(`${ref1}.${body}`);
  });

  it('baris yang sudah dihapus permanen di server boleh tetap disebut (dilewati, bukan error)', async () => {
    const { u, keyId, allRows } = await vaultWithData();
    const rowsArg = [
      ...(await allRows(() => `${ref2}.${body}`)),
      { t: 'pw_items', id: await uuid(), enc: `${ref2}.${body}`, b: '0'.repeat(16) },
    ];
    await expect(
      rotate(u, { id: keyId, wrapped_key: W2, rotated_from: ref1 }, rowsArg),
    ).resolves.toBeDefined();
    expect((await keyOf(u)).wrapped_key).toBe(W2);
  });

  it('rotasi FORMAT LAMA (antrean klien lama, tanpa rotated_from) tidak diterapkan, tapi tulisan tanpa label sejak itu ditolak', async () => {
    const { u, keyId, ids } = await vaultWithData();
    const r = await rotate(u, { id: keyId, wrapped_key: W2, salt: 'T'.repeat(24) }, [
      { t: 'pw_items', id: ids.i1, enc: `isi-dg-DEK-ditolak${body}` }, // tanpa label, tanpa b
    ]);
    expect(r).toMatchObject({ code: '23V05' });
    const k = await keyOf(u);
    expect(k.wrapped_key).toBe(W1);
    expect(k.labels_required_at).not.toBeNull(); // tercatat walau rotasinya ditolak
    // Edit berikutnya di antrean klien lama (tanpa label, DEK yang ditolak) tidak boleh masuk
    await expect(setItem(u, ids.i1, `edit-berikutnya${body}`)).rejects.toMatchObject({
      code: '23V03',
    });
    // Perangkat versi baru tetap bisa menulis dengan label kunci yang sah
    await expect(setItem(u, ids.i1, `${ref1}.edit-baru${body}`)).resolves.toBeDefined();
  });

  it('akun lain: tidak bisa merotasi brankas orang lain, dan rotasinya sendiri tidak menyentuh baris orang lain', async () => {
    const alice = await vaultWithData();
    const bobUser = await newUser();
    const bobKey = await makeKey(bobUser);

    await expect(
      rotate(bobUser, { id: alice.keyId, wrapped_key: W2, rotated_from: ref1 }, []),
    ).rejects.toMatchObject({ code: '23V05' });
    // bob menyebut id item alice di p_rows-nya sendiri
    await rotate(bobUser, { id: bobKey, wrapped_key: W2, rotated_from: ref1 }, [
      { t: 'pw_items', id: alice.ids.i1, enc: `${ref2}.disusupkan${body}`, b: '0'.repeat(16) },
    ]);
    expect(await encOf(alice.ids.i1)).toBe(`${ref1}.${body}`);
    expect((await keyOf(alice.u)).wrapped_key).toBe(W1);
  });

  it('bentuk tidak valid ditolak (23V05) tanpa mengubah apa pun', async () => {
    const { u, keyId } = await vaultWithData();
    const ok = { id: keyId, wrapped_key: W2, rotated_from: ref1 };
    const bad: [Record<string, unknown>, unknown[]][] = [
      [{ id: keyId, rotated_from: ref1 }, []], // tanpa wrapped_key
      [ok, [{ t: 'tasks', id: keyId, b: '0'.repeat(16) }]],
      [ok, [{ t: 'pw_items', b: '0'.repeat(16) }]], // tanpa id
      [ok, [{ t: 'pw_items', id: keyId }]], // tanpa sidik versi
      [ok, ['bukan-objek']],
    ];
    for (const [k, r] of bad)
      await expect(rotate(u, k, r), JSON.stringify([k, r])).rejects.toMatchObject({
        code: '23V05',
      });
    expect((await keyOf(u)).wrapped_key).toBe(W1);
  });

  it('setelah RPC selesai, PATCH kunci biasa di transaksi yang sama tetap dinetralkan (flag rotasi direset)', async () => {
    const { u, keyId, allRows } = await vaultWithData();
    const rowsArg = await allRows(() => `${ref2}.${body}`);
    const after = await asUser(u, async () => {
      await pg.exec('BEGIN');
      try {
        await pg.query(`SELECT public.apply_vault_rotation($1::jsonb, $2::jsonb)`, [
          JSON.stringify({ id: keyId, wrapped_key: W2, rotated_from: ref1 }),
          JSON.stringify(rowsArg),
        ]);
        await pg.query(`UPDATE public.pw_keys SET wrapped_key = $1 WHERE id = $2`, [W3, keyId]);
        return (
          await pg.query<{ w: string }>(
            `SELECT wrapped_key AS w FROM public.pw_keys WHERE id = $1`,
            [keyId],
          )
        ).rows[0]!.w;
      } finally {
        await pg.exec('ROLLBACK');
      }
    });
    expect(after).toBe(W2);
  });

  it('hak eksekusi: authenticated boleh memanggil RPC, anon tidak', async () => {
    const [g] = await rows<{ auth: boolean; anon: boolean }>(
      `SELECT has_function_privilege('authenticated', 'public.apply_vault_rotation(jsonb, jsonb)', 'EXECUTE') AS auth,
              has_function_privilege('anon', 'public.apply_vault_rotation(jsonb, jsonb)', 'EXECUTE') AS anon`,
    );
    expect(g).toEqual({ auth: true, anon: false });
  });

  it('akun ber-MFA dengan token aal1 tidak bisa merotasi (RLS mfa_aal2 tetap berlaku di RPC)', async () => {
    const { u, keyId, allRows } = await vaultWithData();
    const rowsArg = await allRows(() => `${ref2}.${body}`);
    await pg.query(`INSERT INTO auth.mfa_factors (user_id, status) VALUES ($1, 'verified')`, [u]);
    await pg.exec('SET ROLE authenticated');
    await pg.query(`SELECT set_config('app.uid', $1, false)`, [u]);
    await pg.query(`SELECT set_config('app.jwt', $1, false)`, [
      JSON.stringify({ sub: u, aal: 'aal1' }),
    ]);
    try {
      await expect(
        pg.query(`SELECT public.apply_vault_rotation($1::jsonb, $2::jsonb)`, [
          JSON.stringify({ id: keyId, wrapped_key: W2, rotated_from: ref1 }),
          JSON.stringify(rowsArg),
        ]),
      ).rejects.toMatchObject({ code: '23V05' }); // brankas tidak terlihat
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('app.uid', '', false)`);
      await pg.query(`SELECT set_config('app.jwt', '', false)`);
    }
    expect((await keyOf(u)).wrapped_key).toBe(W1);
  });
});

// -----------------------------------------------------------------------------------------
// Berkas publik (tempfile): temp_files + fungsi service_role (migrasi …_temp_files.sql)
// Fungsi dipanggil sebagai superuser di sini = peran Edge Function (service_role).
// -----------------------------------------------------------------------------------------
describe('Berkas publik · temp_files', () => {
  const MB = 1024 * 1024;
  const tok = (c: string) => c.repeat(43);
  let seq = 0;
  /** Token unik yang valid (43 karakter base64url). */
  const token = () => `t${String(++seq).padStart(5, '0')}`.padEnd(43, 'x');

  const newUser = async () =>
    (await rows<{ id: string }>(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`))[0]!.id;
  const uuid = () => rows<{ id: string }>(`SELECT gen_random_uuid() AS id`).then((r) => r[0]!.id);
  const reserve = async (
    user: string,
    size: number,
    opts: { expires?: string | null; token?: string; name?: string } = {},
  ) => {
    const id = await uuid();
    const t = opts.token ?? token();
    await pg.query(
      `SELECT * FROM public.temp_file_reserve($1, $2, $3, 'application/pdf', $4, $5, $6)`,
      [user, id, opts.name ?? 'laporan.pdf', size, opts.expires ?? null, t],
    );
    return { id, token: t };
  };
  const complete = (user: string, id: string) =>
    rows<{ status: string; etag: string | null }>(
      `SELECT * FROM public.temp_file_complete($1, $2, '"etag-1"')`,
      [user, id],
    );
  const used = async (user: string) =>
    Number(
      (await rows<{ n: string }>(`SELECT public.temp_files_used_bytes($1) AS n`, [user]))[0]!.n,
    );
  const resolve = (t: string, count = false) =>
    rows<{ id: string; file_name: string }>(`SELECT * FROM public.temp_file_resolve($1, $2)`, [
      t,
      count,
    ]);
  const age = (id: string, col: string, interval: string) =>
    pg.query(`UPDATE public.temp_files SET ${col} = now() - $2::interval WHERE id = $1`, [
      id,
      interval,
    ]);

  it('kuota 1 GB sama di SQL, Edge Function, dan klien', async () => {
    const [{ q }] = await rows<{ q: string }>(`SELECT public.temp_files_quota_bytes() AS q`);
    expect(Number(q)).toBe(1024 ** 3);
    expect(EDGE_QUOTA).toBe(1024 ** 3);
    expect(CLIENT_QUOTA).toBe(1024 ** 3);
  });

  it('pesan tempat → baris pending dengan key temp/<id> (tanpa pemilik); tidak bisa diunduh sebelum selesai', async () => {
    const u = await newUser();
    const { id, token: t } = await reserve(u, 10 * MB);
    const [f] = await rows<{ status: string; storage_key: string; is_public: boolean }>(
      `SELECT status, storage_key, is_public FROM public.temp_files WHERE id = $1`,
      [id],
    );
    expect(f).toEqual({ status: 'pending', storage_key: `temp/${id}`, is_public: true });
    expect(await resolve(t)).toEqual([]);
    expect((await complete(u, id))[0]).toMatchObject({ status: 'ready', etag: '"etag-1"' });
    expect((await complete(u, id))[0]!.status).toBe('ready'); // idempoten
    expect(await resolve(t)).toMatchObject([{ etag: '"etag-1"' }]);
  });

  it('kuota: total semua berkas (termasuk yang sedang diunggah) tidak boleh lewat 1 GB', async () => {
    const u = await newUser();
    const a = await reserve(u, 600 * MB);
    await complete(u, a.id);
    await reserve(u, 300 * MB); // masih pending, tetap dihitung
    await expect(reserve(u, 200 * MB)).rejects.toMatchObject({ code: 'TF001' });
    await expect(reserve(u, 124 * MB)).resolves.toBeDefined(); // tepat 1 GB
    expect(await used(u)).toBe(1024 * MB);
    await expect(reserve(u, 1)).rejects.toMatchObject({ code: 'TF001' });
    // akun lain punya kuota sendiri
    await expect(reserve(await newUser(), 1024 * MB)).resolves.toBeDefined();
  });

  it('yang dihapus, kedaluwarsa, dan pesanan ditinggalkan (> 2 jam) tidak memakan kuota', async () => {
    const u = await newUser();
    const del = await reserve(u, 300 * MB);
    await complete(u, del.id);
    await pg.query(`SELECT public.temp_file_mark_deleted($1, $2)`, [u, del.id]);
    const exp = await reserve(u, 300 * MB, {
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    await complete(u, exp.id);
    await age(exp.id, 'expires_at', '1 second');
    const abandoned = await reserve(u, 300 * MB);
    await age(abandoned.id, 'created_at', '3 hours');
    const old = await reserve(u, 100 * MB);
    await complete(u, old.id);
    await age(old.id, 'created_at', '400 days'); // berkas siap tetap dihitung berapa pun umurnya
    expect(await used(u)).toBe(100 * MB);
  });

  it('menyelesaikan pesanan lama memeriksa kuota lagi (tidak bisa menyelinap lewat batas)', async () => {
    const u = await newUser();
    const slow = await reserve(u, 600 * MB);
    await age(slow.id, 'created_at', '3 hours'); // tidak dihitung lagi …
    const b = await reserve(u, 600 * MB); // … jadi ini lolos
    await complete(u, b.id);
    await expect(complete(u, slow.id)).rejects.toMatchObject({ code: 'TF001' });
  });

  it('tautan publik: hanya berkas siap, publik, belum dihapus, belum kedaluwarsa', async () => {
    const u = await newUser();
    const f = await reserve(u, MB, { name: 'foto.jpg' });
    await complete(u, f.id);
    expect((await resolve(f.token))[0]!.file_name).toBe('foto.jpg');

    await pg.query(`SELECT public.temp_file_update($1, $2, p_is_public => false)`, [u, f.id]);
    expect(await resolve(f.token)).toEqual([]);
    await pg.query(`SELECT public.temp_file_update($1, $2, p_is_public => true)`, [u, f.id]);
    expect(await resolve(f.token)).toHaveLength(1);

    await age(f.id, 'expires_at', '1 second');
    expect(await resolve(f.token)).toEqual([]);
    for (const bad of ['', 'pendek', tok('*'), `${tok('a')}a`])
      expect(await resolve(bad), bad).toEqual([]);
  });

  it('menghitung unduhan HANYA saat diminta (bukan saat halaman info dibuka)', async () => {
    const u = await newUser();
    const f = await reserve(u, MB);
    await complete(u, f.id);
    await resolve(f.token);
    await resolve(f.token, true);
    await resolve(f.token, true);
    const [r] = await rows<{ download_count: number; last_download_at: Date | null }>(
      `SELECT download_count, last_download_at FROM public.temp_files WHERE id = $1`,
      [f.id],
    );
    expect(r!.download_count).toBe(2);
    expect(r!.last_download_at).not.toBeNull();
  });

  it('tautan baru mencabut tautan lama SEKETIKA; ganti nama & masa berlaku', async () => {
    const u = await newUser();
    const f = await reserve(u, MB);
    await complete(u, f.id);
    const fresh = token();
    await pg.query(
      `SELECT public.temp_file_update($1, $2, p_name => 'baru.pdf', p_set_expiry => true, p_expires_at => now() + interval '1 day', p_token => $3)`,
      [u, f.id, fresh],
    );
    expect(await resolve(f.token)).toEqual([]);
    expect((await resolve(fresh))[0]!.file_name).toBe('baru.pdf');
    // Tanpa batas waktu
    await pg.query(`SELECT public.temp_file_update($1, $2, p_set_expiry => true)`, [u, f.id]);
    const [r] = await rows<{ expires_at: Date | null }>(
      `SELECT expires_at FROM public.temp_files WHERE id = $1`,
      [f.id],
    );
    expect(r!.expires_at).toBeNull();
  });

  it('yang sudah kedaluwarsa tidak bisa dihidupkan lagi; masa berlaku di masa lalu ditolak', async () => {
    const u = await newUser();
    const f = await reserve(u, MB);
    await complete(u, f.id);
    await expect(
      pg.query(
        `SELECT public.temp_file_update($1, $2, p_set_expiry => true, p_expires_at => now() - interval '1 minute')`,
        [u, f.id],
      ),
    ).rejects.toMatchObject({ code: 'TF005' });
    await pg.query(
      `UPDATE public.temp_files SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [f.id],
    );
    await expect(
      pg.query(`SELECT public.temp_file_update($1, $2, p_set_expiry => true)`, [u, f.id]),
    ).rejects.toMatchObject({ code: 'TF003' });
  });

  it('fungsi pemilik tidak bisa menyentuh berkas akun lain', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const f = await reserve(alice, MB);
    await expect(complete(bob, f.id)).rejects.toMatchObject({ code: 'TF002' });
    await expect(
      pg.query(`SELECT public.temp_file_update($1, $2, p_is_public => false)`, [bob, f.id]),
    ).rejects.toMatchObject({ code: 'TF002' });
    const [{ k }] = await rows<{ k: string | null }>(
      `SELECT public.temp_file_mark_deleted($1, $2) AS k`,
      [bob, f.id],
    );
    expect(k).toBeNull();
    const [{ deleted_at }] = await rows<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM public.temp_files WHERE id = $1`,
      [f.id],
    );
    expect(deleted_at).toBeNull();
  });

  it('hapus: tautan mati seketika; pembersih hanya menghapus baris yang memang boleh dihapus', async () => {
    const u = await newUser();
    const keep = await reserve(u, MB);
    await complete(u, keep.id);
    const del = await reserve(u, MB);
    await complete(u, del.id);
    const [{ k }] = await rows<{ k: string }>(`SELECT public.temp_file_mark_deleted($1, $2) AS k`, [
      u,
      del.id,
    ]);
    expect(k).toBe(`temp/${del.id}`);
    expect(await resolve(del.token)).toEqual([]);

    const purgeable = (
      await rows<{ id: string }>(`SELECT id FROM public.temp_files_to_purge(1000)`)
    ).map((r) => r.id);
    expect(purgeable).toContain(del.id);
    expect(purgeable).not.toContain(keep.id);
    // Meminta penghapusan baris yang masih hidup tidak berpengaruh
    const [{ n }] = await rows<{ n: number }>(`SELECT public.temp_files_purge($1::uuid[]) AS n`, [
      [del.id, keep.id],
    ]);
    expect(n).toBe(1);
    expect(await rows(`SELECT 1 FROM public.temp_files WHERE id = $1`, [keep.id])).toHaveLength(1);
  });

  it('RLS: pemilik hanya MEMBACA miliknya; tidak ada insert/update/delete dari klien; anon tanpa akses', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const f = await reserve(alice, MB);
    const as = async <T>(uid: string, fn: () => Promise<T>) => {
      await pg.exec('SET ROLE authenticated');
      await pg.query(`SELECT set_config('app.uid', $1, false)`, [uid]);
      try {
        return await fn();
      } finally {
        await pg.exec('RESET ROLE');
        await pg.query(`SELECT set_config('app.uid', '', false)`);
      }
    };
    expect(await as(alice, () => rows(`SELECT id FROM public.temp_files`))).toEqual([{ id: f.id }]);
    expect(await as(bob, () => rows(`SELECT id FROM public.temp_files`))).toEqual([]);
    for (const sql of [
      `UPDATE public.temp_files SET size_bytes = 1, status = 'ready' WHERE id = '${f.id}'`,
      `DELETE FROM public.temp_files WHERE id = '${f.id}'`,
      `INSERT INTO public.temp_files (id, file_name, size_bytes, storage_key, share_token)
       VALUES (gen_random_uuid(), 'x', 1, 'temp/${f.id}', '${tok('q')}')`,
    ])
      await expect(
        as(alice, () => pg.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/i);

    await pg.exec('SET ROLE anon');
    try {
      await expect(pg.query(`SELECT * FROM public.temp_files`)).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await pg.exec('RESET ROLE');
    }
  });

  it('fungsi berkas hanya bisa dipanggil service_role (bukan klien, bukan anon)', async () => {
    const fns = await rows<{ proname: string; auth: boolean; anon: boolean; svc: boolean }>(
      `SELECT p.proname,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'temp_file%'`,
    );
    expect(fns.map((f) => f.proname).sort()).toEqual(
      [
        'temp_file_complete',
        'temp_file_keys',
        'temp_file_mark_deleted',
        'temp_file_reserve',
        'temp_file_resolve',
        'temp_file_update',
        'temp_files_purge',
        'temp_files_quota_bytes',
        'temp_files_to_purge',
        'temp_files_used_bytes',
      ].sort(),
    );
    for (const f of fns)
      expect([f.proname, f.auth, f.anon, f.svc]).toEqual([f.proname, false, false, true]);
  });

  it('CHECK: ukuran 1 B–1 GB, format token & key, nama 1–255', async () => {
    const u = await newUser();
    await expect(reserve(u, 0)).rejects.toThrow(/check/i);
    // Lebih dari 1 GB ditolak oleh pemeriksaan kuota lebih dulu (sebelum CHECK kolom)
    await expect(reserve(await newUser(), 1024 * MB + 1)).rejects.toMatchObject({ code: 'TF001' });
    await expect(reserve(u, 1, { token: 'pendek' })).rejects.toThrow(/check/i);
    await expect(reserve(u, 1, { name: '' })).rejects.toThrow(/check/i);
    await expect(reserve(u, 1, { name: 'x'.repeat(256) })).rejects.toThrow(/check/i);
    const dupe = token();
    await reserve(u, 1, { token: dupe });
    await expect(reserve(u, 1, { token: dupe })).rejects.toThrow(/duplicate|unique/i);
  });
});
