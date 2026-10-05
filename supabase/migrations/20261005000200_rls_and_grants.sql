-- =============================================================================
-- Row Level Security + Data API grants
-- =============================================================================
-- Dua lapis keamanan, keduanya wajib:
--   1. GRANT  → role `authenticated` boleh mengakses tabel lewat Data API (supabase-js).
--               Sejak Mei 2026 project Supabase baru tidak lagi auto-expose tabel public.
--   2. RLS    → setiap baris hanya bisa dibaca/diubah oleh pemiliknya (user_id = auth.uid()).
-- Role `anon` (belum login) tidak diberi akses apa pun.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_settings', 'tags', 'taggings', 'entity_links',
    'task_lists', 'tasks', 'journal_entries',
    'wallets', 'categories', 'debts', 'recurring_transactions', 'transactions', 'budgets',
    'snippets', 'code_projects', 'attachments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    -- `(select auth.uid())` dibungkus subquery agar dievaluasi sekali per query (lebih cepat)
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
  end loop;
end;
$$;

-- user_settings dibuat otomatis oleh trigger (lihat migrasi seed) — client tidak boleh
-- membuat atau menghapus barisnya sendiri, hanya mengubah.
drop policy "owner_insert" on public.user_settings;
drop policy "owner_delete" on public.user_settings;
revoke insert, delete on public.user_settings from authenticated;
