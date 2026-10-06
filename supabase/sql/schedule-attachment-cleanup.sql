-- =============================================================================
-- Jadwalkan pembersihan lampiran R2 setiap hari pukul 03:00 WIB (20:00 UTC)
-- =============================================================================
-- Jalankan MANUAL di SQL Editor, sekali. Memakai secret Vault yang sama dengan
-- schedule-reminders.sql (taskify_project_url & taskify_cron_secret) — jalankan file
-- itu dulu, atau buat kedua secret tersebut. Lihat docs/SETUP.md §8.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'taskify-attachment-cleanup',
  '0 20 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'taskify_project_url') || '/functions/v1/files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'taskify_cron_secret')
    ),
    body := '{"action":"cleanup"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Cek:      select * from cron.job_run_details where jobid =
--             (select jobid from cron.job where jobname = 'taskify-attachment-cleanup')
--           order by start_time desc limit 5;
-- Hentikan: select cron.unschedule('taskify-attachment-cleanup');
