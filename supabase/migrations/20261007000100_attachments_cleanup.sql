-- =============================================================================
-- Lampiran (Cloudflare R2): pembersihan berkala
-- =============================================================================
-- Isi file ada di R2, metadata di public.attachments (disinkron PowerSync).
-- Edge Function `files` (mode cron) memanggil fungsi di bawah untuk menemukan lampiran
-- yang harus dihapus, menghapus objeknya di R2, lalu menghapus barisnya.
--
-- Lampiran dihapus jika:
--   * di-soft-delete lebih dari 1 jam lalu (beri waktu antrean upload PowerSync)
--   * gagal/menggantung (pending/failed) lebih dari 2 hari
--   * entitas induknya hilang, atau di Sampah lebih dari 30 hari
-- =============================================================================

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
      or (a.status <> 'uploaded' and a.created_at < now() - interval '2 days')
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

create or replace function public.purge_attachments(p_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.attachments where id = any (p_ids) returning 1)
  select count(*)::integer from d;
$$;

-- Daftar semua storage_key yang masih punya baris (untuk mendeteksi objek yatim di R2)
create or replace function public.attachment_keys(p_keys text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select storage_key from public.attachments where storage_key = any (p_keys);
$$;

revoke execute on function public.attachments_to_purge(integer) from public, anon, authenticated;
revoke execute on function public.purge_attachments(uuid[]) from public, anon, authenticated;
revoke execute on function public.attachment_keys(text[]) from public, anon, authenticated;
grant execute on function public.attachments_to_purge(integer) to service_role;
grant execute on function public.purge_attachments(uuid[]) to service_role;
grant execute on function public.attachment_keys(text[]) to service_role;
