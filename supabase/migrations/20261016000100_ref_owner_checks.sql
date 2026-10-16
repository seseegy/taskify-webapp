-- =============================================================================
-- Rujukan antar tabel inti harus milik user yang sama
-- =============================================================================
-- Foreign key hanya memeriksa bahwa baris tujuan ADA, bukan siapa pemiliknya. Tanpa pemeriksaan
-- ini, akun lain bisa membuat transaksi yang menunjuk dompet orang lain, menempelkan tag orang
-- lain, dsb. cukup dengan mengetahui UUID-nya — dan pesan error FK membocorkan apakah UUID itu
-- ada. Pola yang sama sudah dipakai Vault · Konfigurasi (config_check_owner); migrasi ini
-- menerapkannya ke tabel inti.
--
-- Bentuknya CONSTRAINT TRIGGER (AFTER ROW), bukan BEFORE: trigger AFTER dijalankan di akhir
-- statement, sama seperti pemeriksaan FK. Upsert massal dari klien (connector.ts menggabungkan
-- PUT berurutan) bisa memuat subtugas SEBELUM tugas induknya dalam satu statement; trigger
-- BEFORE akan menolaknya padahal FK menerimanya.
--
-- Kode error 23503 (sama dengan FK) → klien menganggapnya permanen dan menyimpan perubahan ke
-- `upload_errors`. Pesannya sama untuk UUID yang tidak ada dan yang milik orang lain.
--
-- Rujukan polimorfik (taggings.entity_id, entity_links, attachments.entity_id) tidak punya FK
-- dan tidak diperiksa di sini: hanya menyimpan UUID di baris milik sendiri, tidak membuka data.
--
-- Restore backup (docs/SETUP.md §9.5) memakai session_replication_role = replica, yang juga
-- mematikan trigger ini — data backup tidak diperiksa ulang.
-- =============================================================================

create or replace function public.check_ref_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  i       integer := 0;
  col     text;
  ref     text;
  val     uuid;
  ok      boolean;
  n       jsonb := to_jsonb(new);
  o       jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  -- Argumen trigger berpasangan: (kolom, tabel rujukan), (kolom, tabel rujukan), …
  while i < tg_nargs loop
    col := tg_argv[i];
    ref := tg_argv[i + 1];
    i := i + 2;

    val := (n ->> col)::uuid;
    continue when val is null;
    -- UPDATE yang tidak mengubah rujukan maupun pemilik tidak perlu diperiksa ulang
    continue when tg_op = 'UPDATE'
      and (o ->> col) is not distinct from (n ->> col)
      and (o ->> 'user_id') is not distinct from (n ->> 'user_id');

    execute format('select exists (select 1 from public.%I where id = $1 and user_id = $2)', ref)
      into ok
      using val, new.user_id;
    if not ok then
      raise exception '%.% harus mengacu ke data milik user yang sama', tg_table_name, col
        using errcode = '23503';
    end if;
  end loop;
  return null; -- AFTER trigger: nilai kembali diabaikan
end;
$$;
revoke all on function public.check_ref_owner() from public, anon, authenticated;

create constraint trigger taggings_ref_owner
  after insert or update of tag_id, user_id on public.taggings
  for each row execute function public.check_ref_owner('tag_id', 'tags');

create constraint trigger tasks_ref_owner
  after insert or update of list_id, parent_id, user_id on public.tasks
  for each row execute function public.check_ref_owner('list_id', 'task_lists', 'parent_id', 'tasks');

create constraint trigger categories_ref_owner
  after insert or update of parent_id, user_id on public.categories
  for each row execute function public.check_ref_owner('parent_id', 'categories');

create constraint trigger recurring_transactions_ref_owner
  after insert or update of wallet_id, to_wallet_id, category_id, user_id
  on public.recurring_transactions
  for each row execute function public.check_ref_owner(
    'wallet_id', 'wallets', 'to_wallet_id', 'wallets', 'category_id', 'categories');

create constraint trigger transactions_ref_owner
  after insert or update of wallet_id, to_wallet_id, category_id, task_id, recurring_id, debt_id, user_id
  on public.transactions
  for each row execute function public.check_ref_owner(
    'wallet_id', 'wallets', 'to_wallet_id', 'wallets', 'category_id', 'categories',
    'task_id', 'tasks', 'recurring_id', 'recurring_transactions', 'debt_id', 'debts');

create constraint trigger budgets_ref_owner
  after insert or update of category_id, user_id on public.budgets
  for each row execute function public.check_ref_owner('category_id', 'categories');
