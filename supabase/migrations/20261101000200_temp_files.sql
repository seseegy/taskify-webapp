-- =============================================================================
-- Berkas publik (tempfile): simpan berkas di R2 dan bagikan lewat tautan publik
-- =============================================================================
-- Hanya PEMILIK akun yang bisa mengunggah; SIAPA PUN yang memegang tautan bisa mengunduh.
-- Kuota: total 1 GB (1024³ byte) per akun, termasuk unggahan yang sedang berjalan.
--
-- Berbeda dari tabel lain, klien TIDAK menulis tabel ini (hanya SELECT, lewat PowerSync):
-- semua tulisan lewat Edge Function `tempfiles` (service_role) yang memanggil fungsi di bawah.
-- Alasannya:
--   * kuota harus ditegakkan ATOMIK di server (dua unggahan paralel tidak boleh lolos bersama);
--   * menghapus / mencabut tautan harus berlaku SEKETIKA di server, bukan menunggu antrean
--     sinkron perangkat (tautan yang salah dibagikan harus mati saat itu juga);
--   * kolom status / ukuran / key / jumlah unduhan tidak boleh bisa diubah klien.
--
--   storage_key   'temp/<id>' — tanpa nama berkas dan tanpa id pemilik: key terlihat di URL unduhan
--                 publik (presigned), jadi tidak boleh mengungkap siapa pemiliknya
--   etag          ETag objek R2 saat unggahan diperiksa (complete). Unduhan publik menolak bila objek
--                 sudah berbeda (mis. ditimpa lewat presigned PUT yang masih berlaku). Server saja.
--   share_token   32 byte acak base64url (256 bit); tautan publik = /unduh/<token>
--   status        pending (dipesan, sedang diunggah) → ready (ukuran objek R2 sudah dicek)
--   expires_at    null = tanpa batas. Lewat waktu = tidak bisa diunduh SEKETIKA; objeknya
--                 dihapus pembersih terjadwal.
--   deleted_at    tanda hapus: tautan langsung mati; pembersih menghapus objek & baris.
-- =============================================================================

create table public.temp_files (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_name         text not null check (char_length(file_name) between 1 and 255),
  mime_type         text not null default 'application/octet-stream'
                      check (char_length(mime_type) between 1 and 255),
  size_bytes        bigint not null check (size_bytes between 1 and 1073741824),
  storage_key       text not null check (storage_key ~ '^temp/[0-9a-f-]{36}$'),
  status            text not null default 'pending' check (status in ('pending', 'ready')),
  etag              text check (etag is null or char_length(etag) between 1 and 200),
  share_token       text not null check (share_token ~ '^[A-Za-z0-9_-]{43}$'),
  is_public         boolean not null default true,
  expires_at        timestamptz,
  download_count    integer not null default 0 check (download_count >= 0),
  last_download_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
-- Token dibuat server (bukan perangkat yang bisa offline), jadi UNIQUE tidak menimbulkan konflik
-- sinkron; ia juga indeks pencarian tautan publik.
create unique index temp_files_share_token_key on public.temp_files (share_token);
create index temp_files_user_id_idx on public.temp_files (user_id);

create trigger set_updated_at before update on public.temp_files
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: pemilik hanya MEMBACA. Tidak ada grant/policy insert, update, delete untuk klien.
-- -----------------------------------------------------------------------------
alter table public.temp_files enable row level security;
alter table public.temp_files force row level security;
revoke all on public.temp_files from anon, authenticated;
grant select on public.temp_files to authenticated;

create policy "owner_select" on public.temp_files for select to authenticated
  using ((select auth.uid()) = user_id);
-- Sama dengan migrasi mfa_enforce (yang hanya mengenai tabel yang SUDAH ada saat itu)
create policy "mfa_aal2" on public.temp_files as restrictive for all to authenticated
  using ((select public.mfa_satisfied()))
  with check ((select public.mfa_satisfied()));

alter table public.temp_files replica identity full;
alter publication powersync add table public.temp_files;

do $$
declare
  r text;
begin
  for r in select rolname from pg_roles where rolname like 'powersync%' loop
    execute format('grant select on public.temp_files to %I', r);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Kuota
-- -----------------------------------------------------------------------------
create or replace function public.temp_files_quota_bytes()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 1073741824::bigint $$;

-- Byte terpakai: berkas yang masih hidup. Pesanan unggah (pending) ikut dihitung selama 2 jam
-- (presigned PUT berlaku 1 jam); pesanan yang lebih tua dianggap ditinggalkan.
create or replace function public.temp_files_used_bytes(p_user uuid, p_except uuid default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(f.size_bytes), 0)::bigint
    from public.temp_files f
   where f.user_id = p_user
     and f.id is distinct from p_except
     and f.deleted_at is null
     and (f.expires_at is null or f.expires_at > now())
     and (f.status = 'ready' or f.created_at > now() - interval '2 hours');
$$;

-- -----------------------------------------------------------------------------
-- Pesan tempat (sebelum presigned PUT) — atomik per akun
-- -----------------------------------------------------------------------------
create or replace function public.temp_file_reserve(
  p_user       uuid,
  p_id         uuid,
  p_name       text,
  p_mime       text,
  p_size       bigint,
  p_expires_at timestamptz,
  p_token      text
)
returns public.temp_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  used bigint;
  created public.temp_files;
begin
  -- Satu kunci per akun: dua pesanan paralel antre di sini, jadi tidak bisa lolos bersama.
  perform pg_advisory_xact_lock(hashtextextended('temp_files:' || p_user::text, 0));
  used := public.temp_files_used_bytes(p_user);
  if used + p_size > public.temp_files_quota_bytes() then
    raise exception 'Kuota berkas penuh: terpakai % dari % byte', used, public.temp_files_quota_bytes()
      using errcode = 'TF001';
  end if;
  insert into public.temp_files
    (id, user_id, file_name, mime_type, size_bytes, storage_key, share_token, expires_at)
  values
    (p_id, p_user, p_name, p_mime, p_size, 'temp/' || p_id, p_token, p_expires_at)
  returning * into created;
  return created;
end;
$$;

-- -----------------------------------------------------------------------------
-- Selesai unggah (Edge Function sudah memeriksa ukuran objek di R2)
-- -----------------------------------------------------------------------------
create or replace function public.temp_file_complete(p_user uuid, p_id uuid, p_etag text)
returns public.temp_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.temp_files;
begin
  perform pg_advisory_xact_lock(hashtextextended('temp_files:' || p_user::text, 0));
  select * into f from public.temp_files
   where id = p_id and user_id = p_user and deleted_at is null for update;
  if not found then
    raise exception 'Berkas tidak ditemukan' using errcode = 'TF002';
  end if;
  if f.status = 'ready' then
    return f; -- idempoten (klien mengulang setelah jaringan putus)
  end if;
  if f.expires_at is not null and f.expires_at <= now() then
    raise exception 'Berkas sudah kedaluwarsa' using errcode = 'TF003';
  end if;
  -- Pesanan > 2 jam tidak lagi dihitung kuota; periksa lagi supaya kuota tidak terlewati
  if public.temp_files_used_bytes(p_user, p_id) + f.size_bytes > public.temp_files_quota_bytes() then
    raise exception 'Kuota berkas penuh' using errcode = 'TF001';
  end if;
  update public.temp_files set status = 'ready', etag = p_etag where id = p_id returning * into f;
  return f;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ubah: nama, publik/privat, masa berlaku, token baru (mencabut tautan lama)
-- -----------------------------------------------------------------------------
create or replace function public.temp_file_update(
  p_user       uuid,
  p_id         uuid,
  p_name       text default null,
  p_is_public  boolean default null,
  p_set_expiry boolean default false,
  p_expires_at timestamptz default null,
  p_token      text default null
)
returns public.temp_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.temp_files;
begin
  select * into f from public.temp_files
   where id = p_id and user_id = p_user and deleted_at is null for update;
  if not found then
    raise exception 'Berkas tidak ditemukan' using errcode = 'TF002';
  end if;
  -- Yang sudah kedaluwarsa tidak bisa dihidupkan lagi: objeknya bisa saja sudah dihapus.
  if f.expires_at is not null and f.expires_at <= now() then
    raise exception 'Berkas sudah kedaluwarsa' using errcode = 'TF003';
  end if;
  if p_set_expiry and p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Masa berlaku harus di masa depan' using errcode = 'TF005';
  end if;
  update public.temp_files set
    file_name  = coalesce(p_name, file_name),
    is_public  = coalesce(p_is_public, is_public),
    expires_at = case when p_set_expiry then p_expires_at else expires_at end,
    share_token = coalesce(p_token, share_token)
  where id = p_id
  returning * into f;
  return f;
end;
$$;

-- -----------------------------------------------------------------------------
-- Hapus: tanda dulu (tautan langsung mati), objek & baris dihapus setelah R2 berhasil
-- -----------------------------------------------------------------------------
create or replace function public.temp_file_mark_deleted(p_user uuid, p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.temp_files set deleted_at = coalesce(deleted_at, now())
   where id = p_id and user_id = p_user
  returning storage_key;
$$;

create or replace function public.temp_files_purge(p_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from public.temp_files
     where id = any(p_ids)
       and (deleted_at is not null
            or (expires_at is not null and expires_at <= now())
            or (status = 'pending' and created_at < now() - interval '6 hours'))
    returning 1
  )
  select count(*)::integer from d;
$$;

-- Untuk pembersih terjadwal: yang dihapus, kedaluwarsa, atau pesanan unggah yang ditinggalkan
create or replace function public.temp_files_to_purge(p_limit integer default 500)
returns table (id uuid, storage_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.storage_key from public.temp_files f
   where f.deleted_at is not null
      or (f.expires_at is not null and f.expires_at <= now())
      or (f.status = 'pending' and f.created_at < now() - interval '6 hours')
   order by f.updated_at
   limit greatest(1, least(p_limit, 1000));
$$;

-- Untuk pembersih objek yatim: key mana yang masih punya baris
create or replace function public.temp_file_keys(p_keys text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select f.storage_key from public.temp_files f where f.storage_key = any(p_keys);
$$;

-- -----------------------------------------------------------------------------
-- Tautan publik
-- -----------------------------------------------------------------------------
-- Berkas yang BOLEH diunduh lewat token: siap, publik, belum dihapus, belum kedaluwarsa.
-- p_count = true → hitung sebagai satu unduhan (hanya GET unduhan, bukan halaman info).
create or replace function public.temp_file_resolve(p_token text, p_count boolean default false)
returns table (
  id uuid, file_name text, mime_type text, size_bytes bigint, storage_key text,
  expires_at timestamptz, created_at timestamptz, etag text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;
  if p_count then
    return query
      with hit as (
        update public.temp_files f
           set download_count = f.download_count + 1, last_download_at = now()
         where f.share_token = p_token and f.status = 'ready' and f.is_public
           and f.deleted_at is null and (f.expires_at is null or f.expires_at > now())
        returning f.id, f.file_name, f.mime_type, f.size_bytes, f.storage_key, f.expires_at, f.created_at, f.etag
      )
      select * from hit;
  else
    return query
      select f.id, f.file_name, f.mime_type, f.size_bytes, f.storage_key, f.expires_at, f.created_at, f.etag
        from public.temp_files f
       where f.share_token = p_token and f.status = 'ready' and f.is_public
         and f.deleted_at is null and (f.expires_at is null or f.expires_at > now());
  end if;
end;
$$;

-- Semua fungsi di atas hanya untuk Edge Function (service_role). Klien tidak bisa memanggilnya.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.temp_files_quota_bytes()',
    'public.temp_files_used_bytes(uuid, uuid)',
    'public.temp_file_reserve(uuid, uuid, text, text, bigint, timestamptz, text)',
    'public.temp_file_complete(uuid, uuid, text)',
    'public.temp_file_update(uuid, uuid, text, boolean, boolean, timestamptz, text)',
    'public.temp_file_mark_deleted(uuid, uuid)',
    'public.temp_files_purge(uuid[])',
    'public.temp_files_to_purge(integer)',
    'public.temp_file_keys(text[])',
    'public.temp_file_resolve(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
