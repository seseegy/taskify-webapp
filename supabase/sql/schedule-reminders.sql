-- =============================================================================
-- Jadwalkan pengiriman pengingat tiap menit (jalankan MANUAL di SQL Editor, sekali)
-- =============================================================================
-- Bukan migrasi karena berisi secret. Ganti 2 nilai <...> di bawah, lalu Run.
-- Lihat docs/SETUP.md §7.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Simpan URL project & secret cron di Vault (terenkripsi)
select vault.create_secret('https://<project-ref>.supabase.co', 'taskify_project_url');
select vault.create_secret('<CRON_SECRET yang sama dengan secret Edge Function>', 'taskify_cron_secret');

select cron.schedule(
  'taskify-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'taskify_project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'taskify_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);

-- ---------------------------------------------------------------------------
-- Cek & perawatan
-- ---------------------------------------------------------------------------
-- Riwayat eksekusi:  select * from cron.job_run_details order by start_time desc limit 10;
-- Respons HTTP:      select id, status_code, content from net._http_response order by id desc limit 10;
-- Hentikan:          select cron.unschedule('taskify-send-reminders');
-- Ganti secret:      select vault.update_secret(
--                      (select id from vault.secrets where name = 'taskify_cron_secret'), '<baru>');
