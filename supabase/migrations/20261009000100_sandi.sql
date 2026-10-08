-- =============================================================================
-- Sandi (password manager) — penyimpanan TERENKRIPSI ujung ke ujung
-- =============================================================================
-- Server HANYA menyimpan data acak. Enkripsi/dekripsi terjadi di perangkat (WebCrypto), dengan
-- kunci yang diturunkan dari master password yang TIDAK pernah dikirim ke sini.
-- Lihat docs/ARCHITECTURE.md → "Sandi" dan src/features/sandi/crypto.ts.
--
--   pw_keys   satu baris per user: parameter KDF + DEK yang dibungkus (oleh master password dan
--             oleh kunci pemulihan). Tanpa master password/kunci pemulihan, isinya tidak berguna.
--   pw_items  satu baris per sandi: `enc` = base64(IV ‖ AES-256-GCM(ciphertext)). Judul, URL,
--             username, sandi, dan catatan SEMUANYA ada di dalam `enc`.
--
-- Konsekuensi yang disengaja:
--   * Tidak ada pencarian/indeks sisi server untuk sandi (dan tidak masuk FTS lokal).
--   * pg_dump (backup) dan ekspor JSON hanya memuat ciphertext.
--   * Lupa master password DAN kunci pemulihan = data tidak bisa dipulihkan siapa pun.
--
-- CHECK di bawah hanya sabuk pengaman (bentuk & parameter KDF minimum); server tidak bisa
-- memverifikasi isinya.
-- =============================================================================

create table public.pw_keys (
  id                    uuid primary key,
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version               smallint not null default 1 check (version >= 1),
  kdf                   text not null check (kdf in ('pbkdf2-sha256')),
  -- Cegah klien yang rusak/jahat menyimpan parameter yang membuat brankas mudah ditebak
  iterations            integer not null check (iterations between 100000 and 10000000),
  salt                  text not null check (char_length(salt) between 16 and 64),
  wrapped_key           text not null check (char_length(wrapped_key) between 40 and 200),
  recovery_salt         text not null check (char_length(recovery_salt) between 16 and 64),
  recovery_wrapped_key  text not null check (char_length(recovery_wrapped_key) between 40 and 200),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- Satu brankas per user. (Pengecualian dari aturan "hindari UNIQUE": dua kunci berbeda untuk satu
-- user = item terenkripsi dengan kunci yang tidak bisa dibaca perangkat lain. Lebih baik ditolak.)
create unique index pw_keys_user_id_key on public.pw_keys (user_id);

create table public.pw_items (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  enc         text not null check (char_length(enc) between 40 and 262144),
  v           smallint not null default 1 check (v >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index pw_items_user_id_idx on public.pw_items (user_id);

-- -----------------------------------------------------------------------------
-- updated_at, RLS, grant (pola yang sama dengan tabel lain)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['pw_keys', 'pw_items'] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- pw_keys TIDAK pernah dihapus oleh aplikasi; tanpa DELETE, sesi pemilik yang bocor (atau
    -- klien yang rusak) tidak bisa membuat brankas jadi tak terpulihkan dengan satu perintah.
    -- Baris hilang hanya lewat ON DELETE CASCADE saat akun dihapus. UPDATE tetap perlu
    -- (ganti master password); perlindungannya adalah backup/PITR Supabase.
    if t = 'pw_keys' then
      execute format('grant select, insert, update on public.%I to authenticated', t);
    else
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;

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
    if t <> 'pw_keys' then
      execute format(
        'create policy "owner_delete" on public.%I for delete to authenticated
           using ((select auth.uid()) = user_id)', t);
    end if;

    -- PowerSync: event DELETE harus membawa seluruh baris (lihat migrasi publication)
    execute format('alter table public.%I replica identity full', t);
    execute format('alter publication powersync add table public.%I', t);
  end loop;
end;
$$;
