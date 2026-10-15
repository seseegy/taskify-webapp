-- =============================================================================
-- Catatan (notes)
-- =============================================================================
-- Beda dengan Jurnal (journal_entries): tidak ada mood, dan tanggalnya OPSIONAL.
--   note_date null   → catatan bebas (tidak terikat hari)
--   note_date terisi → ditempel ke hari itu (muncul di panel hari Kalender)
-- Satu hari boleh punya banyak catatan. Isi berupa Markdown. TIDAK terenkripsi (sama dengan
-- Jurnal): masuk pencarian global dan tag/tautan. Lampiran sengaja belum didukung, jadi
-- constraint `attachments.entity_type` tidak diubah.
-- =============================================================================

create table public.notes (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_date   date,                                  -- tanggal lokal (WIB); null = catatan bebas
  title       text check (title is null or char_length(title) <= 200),
  content     text not null default '',              -- markdown
  is_pinned   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index notes_user_id_idx on public.notes (user_id);
create index notes_date_idx on public.notes (user_id, note_date);

-- -----------------------------------------------------------------------------
-- Tag & tautan polimorfik harus mengenal tipe 'note'.
-- Tanpa ini, menambah tag/tautan pada catatan DITOLAK server (kode 23514) saat upload dan
-- berakhir di `upload_errors` — data hilang diam-diam. Nama constraint adalah nama bawaan
-- Postgres untuk CHECK inline di migrasi core_schema.
-- -----------------------------------------------------------------------------
alter table public.taggings drop constraint taggings_entity_type_check;
alter table public.taggings add constraint taggings_entity_type_check
  check (entity_type in ('task', 'journal_entry', 'transaction', 'snippet', 'code_project', 'note'));

alter table public.entity_links drop constraint entity_links_source_type_check;
alter table public.entity_links add constraint entity_links_source_type_check
  check (source_type in ('task', 'journal_entry', 'transaction', 'snippet', 'code_project', 'note'));

alter table public.entity_links drop constraint entity_links_target_type_check;
alter table public.entity_links add constraint entity_links_target_type_check
  check (target_type in ('task', 'journal_entry', 'transaction', 'snippet', 'code_project', 'note'));

-- -----------------------------------------------------------------------------
-- updated_at, RLS, grant, publication (pola yang sama dengan tabel lain)
-- -----------------------------------------------------------------------------
create trigger set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;
alter table public.notes force row level security;
revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;

create policy "owner_select" on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "owner_insert" on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "owner_update" on public.notes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner_delete" on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- PowerSync: event DELETE harus membawa seluruh baris (lihat migrasi publication)
alter table public.notes replica identity full;
alter publication powersync add table public.notes;

-- -----------------------------------------------------------------------------
-- Hak baca untuk role replikasi PowerSync (lihat migrasi sandi_totp_log untuk alasannya).
-- Tanpa role `powersync*`, blok ini tidak melakukan apa pun — aman di PGlite.
-- -----------------------------------------------------------------------------
do $$
declare
  r text;
begin
  for r in select rolname from pg_roles where rolname like 'powersync%' loop
    execute format('grant select on public.notes to %I', r);
  end loop;
end;
$$;
