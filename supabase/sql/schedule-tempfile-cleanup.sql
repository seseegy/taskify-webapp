-- =============================================================================
-- Jadwalkan pembersihan Berkas publik (tempfile) setiap jam, menit ke-17
-- =============================================================================
-- Jalankan MANUAL di SQL Editor, sekali. Memakai secret Vault yang sama dengan
-- schedule-reminders.sql (taskify_project_url & taskify_cron_secret). Lihat docs/SETUP.md §16.
--
-- Kedaluwarsa dan hapus SUDAH berlaku seketika tanpa job ini (tautan langsung ditolak). Job ini
-- membebaskan penyimpanan R2: objek berkas yang kedaluwarsa/dihapus/unggahannya ditinggalkan,
-- serta objek yatim di prefix temp/.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'taskify-tempfile-cleanup',
  '17 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'taskify_project_url') || '/functions/v1/tempfiles',
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
--             (select jobid from cron.job where jobname = 'taskify-tempfile-cleanup')
--           order by start_time desc limit 5;
-- Hentikan: select cron.unschedule('taskify-tempfile-cleanup');
