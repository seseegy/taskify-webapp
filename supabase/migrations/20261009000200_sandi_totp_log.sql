-- Sandi · riwayat kode TOTP — TERENKRIPSI ujung ke ujung
-- =============================================================================
-- Taskify dipakai sebagai authenticator sendiri: kunci rahasia TOTP tersimpan di dalam
-- `pw_items.enc` (tidak ada kolom baru untuk itu), dan setiap kode yang dipakai dicatat di sini.
--
--   pw_totp_log  satu baris per pemakaian kode. `enc` = base64(IV ‖ AES-256-GCM(ciphertext))
--                dan memuat nama akun, angka kodenya, serta id item asalnya.
--
-- Mengapa tabel sendiri, bukan di dalam `pw_items`:
--   * daftar brankas diurutkan `updated_at DESC` → menulis riwayat ke item akan membuat item
--     melompat ke atas setiap kali kode disalin;
--   * satu penyalinan = satu enkripsi ulang + satu unggahan untuk seluruh item. Terlalu berisik.
--
-- Yang TERLIHAT server: hanya waktu (created_at) dan jumlah baris. Nama akun dan kodenya ada di
-- dalam `enc`. Kode TOTP kedaluwarsa dalam ≤ 300 detik, jadi nilainya bagi penyerang nihil;
-- pemilik memakainya sebagai catatan "aku memakai akun apa, kapan".
--
-- Retensi: klien membuang baris lama (lihat TOTP_LOG_RETENTION_DAYS di src/features/sandi).
-- Karena itu DELETE diizinkan di sini, berbeda dari pw_keys.
-- =============================================================================

create table public.pw_totp_log (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  enc         text not null check (char_length(enc) between 40 and 8192),
  v           smallint not null default 1 check (v >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Pembersihan retensi selalu "milikku, lebih lama dari X"
create index pw_totp_log_user_created_idx on public.pw_totp_log (user_id, created_at);

-- -----------------------------------------------------------------------------
-- updated_at, RLS, grant, publication (pola yang sama dengan tabel lain)
-- -----------------------------------------------------------------------------
create trigger set_updated_at before update on public.pw_totp_log
  for each row execute function public.set_updated_at();

alter table public.pw_totp_log enable row level security;
alter table public.pw_totp_log force row level security;
revoke all on public.pw_totp_log from anon;
grant select, insert, update, delete on public.pw_totp_log to authenticated;

create policy "owner_select" on public.pw_totp_log for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "owner_insert" on public.pw_totp_log for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "owner_update" on public.pw_totp_log for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner_delete" on public.pw_totp_log for delete to authenticated
  using ((select auth.uid()) = user_id);

-- PowerSync: event DELETE harus membawa seluruh baris (lihat migrasi publication)
alter table public.pw_totp_log replica identity full;
alter publication powersync add table public.pw_totp_log;

-- -----------------------------------------------------------------------------
-- Hak baca untuk role replikasi PowerSync.
-- `grant ... on all tables` saat setup hanya berlaku untuk tabel yang SUDAH ADA, sehingga tabel
-- baru membuat Validate di dashboard gagal dengan "permission denied for table …".
-- Blok ini mencari role `powersync*` yang ada (nama dibuat otomatis oleh integrasi Supabase,
-- mis. `powersync_<hash>`) lalu memberinya hak baca. Tanpa role tersebut, blok ini tidak
-- melakukan apa pun — aman dijalankan di mana saja, termasuk di tes PGlite.
-- -----------------------------------------------------------------------------
do $$
declare
  r text;
begin
  for r in select rolname from pg_roles where rolname like 'powersync%' loop
    execute format('grant select on public.pw_totp_log to %I', r);
  end loop;
end;
$$;
