/**
 * Menjalankan SEMUA migrasi berurutan di Postgres sungguhan (PGlite, WASM) lalu menguji perilaku
 * SQL yang penting. Menggantikan klaim lama di docs ("diuji di PGlite") yang tidak ada di repo.
 *
 * Stub minimal untuk objek bawaan Supabase: role anon/authenticated/service_role, tabel
 * auth.users, dan auth.uid().
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzleSchema } from '../../src/db/schema';
import { EXPORT_TABLES } from '../../src/features/settings/export-tables';

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
    CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.uid', true), '')::uuid $$;
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

  it('pemilik boleh mengganti password (UPDATE pw_keys) — updated_at diperbarui trigger', async () => {
    const [before] = await rows<{ id: string; updated_at: Date }>(
      `SELECT id, updated_at FROM public.pw_keys WHERE user_id = $1`,
      [alice],
    );
    await asUser(alice, () =>
      pg.query(`UPDATE public.pw_keys SET salt = $1, wrapped_key = $2 WHERE id = $3`, [
        b64(30),
        b64(90),
        before!.id,
      ]),
    );
    const [after] = await rows<{ salt: string; updated_at: Date }>(
      `SELECT salt, updated_at FROM public.pw_keys WHERE id = $1`,
      [before!.id],
    );
    expect(after!.salt).toBe(b64(30));
    expect(after!.updated_at.getTime()).toBeGreaterThanOrEqual(before!.updated_at.getTime());
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
