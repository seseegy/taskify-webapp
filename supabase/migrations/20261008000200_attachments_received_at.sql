-- =============================================================================
-- Lampiran: pembersihan memakai waktu SERVER, bukan jam perangkat
-- =============================================================================
-- Aturan "lampiran yang belum terunggah > 2 hari dihapus" memakai `created_at`, yang diisi
-- perangkat saat file dibuat. Lampiran yang dibuat saat OFFLINE lalu baru tersinkron setelah
-- > 2 hari sudah dianggap basi begitu tiba di server, sehingga cron harian bisa menghapus baris
-- (dan objek R2-nya) sebelum sempat terunggah. Padahal itulah skenario yang dilayani outbox
-- lampiran di aplikasi.
--
-- `received_at` diisi DEFAULT now() oleh server saat baris pertama kali masuk. Kolom ini
-- sengaja TIDAK ada di skema klien (src/db/schema.ts) dan tidak pernah ditulis klien. Sync
-- Streams memakai `SELECT *`, jadi nilainya ikut terkirim ke perangkat, tetapi PowerSync
-- mengabaikan kolom yang tidak ada di skema klien. Upsert dari klien (PUT, defaultToNull:
-- false) tidak menyertakannya sehingga nilai di server tidak tertimpa.
-- Baris yang sudah ada mendapat waktu migrasi ini → pembersihan lampiran gagal lama tertunda
-- paling lama 2 hari. Tidak berbahaya.
-- =============================================================================

alter table public.attachments
  add column if not exists received_at timestamptz not null default now();

create or replace function public.attachments_to_purge(p_limit integer default 500)
returns table (id uuid, storage_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.storage_key
    from public.attachments a
   where (a.deleted_at is not null and a.deleted_at < now() - interval '1 hour')
      or (a.status <> 'uploaded' and a.received_at < now() - interval '2 days')
      or (a.entity_type = 'task' and not exists (
            select 1 from public.tasks e where e.id = a.entity_id
             and (e.deleted_at is null or e.deleted_at > now() - interval '30 days')))
      or (a.entity_type = 'journal_entry' and not exists (
            select 1 from public.journal_entries e where e.id = a.entity_id
             and (e.deleted_at is null or e.deleted_at > now() - interval '30 days')))
      or (a.entity_type = 'transaction' and not exists (
            select 1 from public.transactions e where e.id = a.entity_id
             and (e.deleted_at is null or e.deleted_at > now() - interval '30 days')))
      or (a.entity_type = 'snippet' and not exists (
            select 1 from public.snippets e where e.id = a.entity_id
             and (e.deleted_at is null or e.deleted_at > now() - interval '30 days')))
      or (a.entity_type = 'code_project' and not exists (
            select 1 from public.code_projects e where e.id = a.entity_id
             and (e.deleted_at is null or e.deleted_at > now() - interval '30 days')))
   limit p_limit;
$$;

revoke execute on function public.attachments_to_purge(integer) from public, anon, authenticated;
grant execute on function public.attachments_to_purge(integer) to service_role;
