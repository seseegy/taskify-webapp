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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const RETRY_MIGRATION = '20261008000100_reminder_retry.sql';

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
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  `);
  // Migrasi sebelum perbaikan pengingat dulu, supaya jalur upgrade (data lama) ikut teruji
  for (const f of FILES.filter((f) => f !== RETRY_MIGRATION))
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

  it('publication powersync memuat 16 tabel dan REPLICA IDENTITY FULL', async () => {
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
