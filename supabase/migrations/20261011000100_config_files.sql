-- =============================================================================
-- Vault · Konfigurasi (.env / JSON) berversi — ISI TERENKRIPSI ujung ke ujung
-- =============================================================================
-- Isi berkas konfigurasi hampir selalu memuat rahasia (API key, password DB, token), jadi isinya
-- dienkripsi DI PERANGKAT dengan kunci data brankas Sandi (DEK) sebelum ditulis. Server, backup
-- pg_dump, dan ekspor JSON hanya melihat ciphertext. Lihat src/features/sandi/crypto.ts.
--
--   config_files     satu baris per berkas. Metadata TEKS BIASA (nama, format, lingkungan,
--                    project) supaya daftarnya tetap tampil saat brankas terkunci.
--   config_versions  satu baris per versi. `enc` = base64(IV ‖ AES-256-GCM(ciphertext)) dari
--                    { text, note } — isi berkas DAN catatan perubahannya. Versi tidak pernah
--                    diubah isinya oleh aplikasi; UPDATE hanya untuk enkripsi ulang saat kunci
--                    brankas dirotasi.
--
-- Konsekuensi yang disengaja:
--   * Nomor versi (v1, v2, …) TIDAK disimpan; dihitung dari urutan created_at/id di klien.
--     UNIQUE(file_id, nomor) akan menolak versi dari dua perangkat yang sama-sama offline
--     (aturan "hindari UNIQUE di data yang bisa diedit").
--   * Isi tidak bisa dicari di server maupun lewat FTS lokal.
--   * Lupa master password DAN kunci pemulihan Sandi = isi konfigurasi tidak bisa dipulihkan.
-- =============================================================================

create table public.config_files (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Project dihapus permanen → berkas menjadi "Tanpa project", tidak ikut terhapus
  project_id   uuid references public.code_projects (id) on delete set null,
  name         text not null check (char_length(name) between 1 and 120),
  format       text not null check (format in ('env', 'json')),
  -- Teks bebas (pilihan cepat production/staging/lokal ada di UI); dinormalkan oleh aplikasi
  environment  text check (environment is null or char_length(environment) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index config_files_user_id_idx on public.config_files (user_id);
create index config_files_project_id_idx on public.config_files (project_id);

create table public.config_versions (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_id     uuid not null references public.config_files (id) on delete cascade,
  -- Batas isi 256 KB diperiksa di klien atas payload JSON; ditambah padding, tag GCM, dan
  -- base64, ciphertext-nya ±350 ribu karakter. Batas di sini hanya sabuk pengaman.
  enc         text not null check (char_length(enc) between 40 and 360000),
  v           smallint not null default 1 check (v >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index config_versions_user_id_idx on public.config_versions (user_id);
create index config_versions_file_idx on public.config_versions (file_id, created_at);

-- -----------------------------------------------------------------------------
-- Rujukan harus milik user yang sama.
-- Foreign key hanya memeriksa bahwa baris tujuan ADA, bukan siapa pemiliknya. Tanpa ini, akun
-- lain bisa menempelkan versi ke berkas orang lain (atau berkas ke project orang lain) cukup
-- dengan menebak/mengetahui UUID-nya, dan pesan error FK membocorkan apakah UUID itu ada.
-- SECURITY DEFINER karena FORCE RLS menyembunyikan baris milik orang lain dari pemanggil;
-- fungsi hanya membandingkan pemilik dan tidak mengembalikan data apa pun.
-- -----------------------------------------------------------------------------
create or replace function public.config_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'config_versions' then
    if not exists (
      select 1 from public.config_files f where f.id = new.file_id and f.user_id = new.user_id
    ) then
      raise exception 'config_versions.file_id harus berkas milik user yang sama'
        using errcode = '23503';
    end if;
  elsif new.project_id is not null then
    if not exists (
      select 1 from public.code_projects p where p.id = new.project_id and p.user_id = new.user_id
    ) then
      raise exception 'config_files.project_id harus project milik user yang sama'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.config_check_owner() from public, anon, authenticated;

create trigger config_files_owner before insert or update of project_id, user_id
  on public.config_files for each row execute function public.config_check_owner();
create trigger config_versions_owner before insert or update of file_id, user_id
  on public.config_versions for each row execute function public.config_check_owner();

-- -----------------------------------------------------------------------------
-- updated_at, RLS, grant, publication (pola yang sama dengan tabel lain)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['config_files', 'config_versions'] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format(
      'create policy "owner_select" on public.%I for select to authenticated
         using ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "owner_insert" on public.%I for insert to authenticated
         with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "owner_update" on public.%I for update to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "owner_delete" on public.%I for delete to authenticated
         using ((select auth.uid()) = user_id)', t);

    -- PowerSync: event DELETE harus membawa seluruh baris (lihat migrasi publication)
    execute format('alter table public.%I replica identity full', t);
    execute format('alter publication powersync add table public.%I', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Hak baca untuk role replikasi PowerSync (lihat migrasi sandi_totp_log untuk alasannya).
-- Tanpa role `powersync*`, blok ini tidak melakukan apa pun — aman di PGlite.
-- -----------------------------------------------------------------------------
do $$
declare
  r text;
begin
  for r in select rolname from pg_roles where rolname like 'powersync%' loop
    execute format('grant select on public.config_files, public.config_versions to %I', r);
  end loop;
end;
$$;
