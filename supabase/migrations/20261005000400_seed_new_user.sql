-- =============================================================================
-- Data awal untuk akun baru
-- =============================================================================
-- Saat akun dibuat (dari Supabase Dashboard → Authentication → Add user), trigger ini
-- membuat: pengaturan default, 2 dompet, dan kategori pemasukan/pengeluaran default.
-- Bisa juga dijalankan manual: select public.seed_user_defaults('<user-uuid>');
-- Fungsi ini idempoten: aman dijalankan berulang.
-- =============================================================================

create or replace function public.seed_user_defaults(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.user_settings where user_id = p_user_id) then
    return;
  end if;

  insert into public.user_settings (user_id) values (p_user_id);

  insert into public.wallets (id, user_id, name, type, color, icon, position) values
    (gen_random_uuid(), p_user_id, 'Tunai', 'cash',  'emerald', 'banknote', 1),
    (gen_random_uuid(), p_user_id, 'Bank',  'bank',  'sky',     'landmark', 2);

  insert into public.categories (id, user_id, name, kind, color, icon, position)
  select gen_random_uuid(), p_user_id, c.name, c.kind, c.color, c.icon, c.position
  from (values
    -- pengeluaran
    ('Makan & Minum', 'expense', 'orange',  'utensils',      1),
    ('Transportasi',  'expense', 'sky',     'car',           2),
    ('Tagihan',       'expense', 'rose',    'receipt',       3),
    ('Belanja',       'expense', 'pink',    'shopping-bag',  4),
    ('Hiburan',       'expense', 'violet',  'gamepad-2',     5),
    ('Kesehatan',     'expense', 'red',     'heart-pulse',   6),
    ('Pendidikan',    'expense', 'indigo',  'graduation-cap',7),
    ('Langganan',     'expense', 'fuchsia', 'repeat',        8),
    ('Lainnya',       'expense', 'slate',   'circle-ellipsis', 99),
    -- pemasukan
    ('Gaji',          'income',  'emerald', 'wallet',        1),
    ('Freelance',     'income',  'teal',    'laptop',        2),
    ('Bonus',         'income',  'amber',   'gift',          3),
    ('Lainnya',       'income',  'slate',   'circle-ellipsis', 99)
  ) as c (name, kind, color, icon, position);
end;
$$;

-- Fungsi ini hanya untuk trigger/admin, jangan bisa dipanggil dari client
revoke execute on function public.seed_user_defaults(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_user_defaults(new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
