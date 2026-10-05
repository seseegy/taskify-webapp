-- =============================================================================
-- PowerSync: publication untuk logical replication
-- =============================================================================
-- PowerSync membaca perubahan dari publication bernama `powersync`.
-- REPLICA IDENTITY FULL → event DELETE membawa seluruh baris, sehingga PowerSync tahu
-- user_id-nya dan bisa menghapus baris itu dari perangkat yang tepat.
--
-- Role replikasi `powersync_role` TIDAK dibuat di sini karena butuh password rahasia.
-- Buat manual mengikuti docs/SETUP.md langkah 2.4.
--
-- Saat menambah tabel tersinkron baru:
--   alter publication powersync add table public.<tabel>;
--   alter table public.<tabel> replica identity full;
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
    execute format('alter table public.%I replica identity full', t);
  end loop;
end;
$$;

create publication powersync for table
  public.user_settings, public.tags, public.taggings, public.entity_links,
  public.task_lists, public.tasks, public.journal_entries,
  public.wallets, public.categories, public.debts, public.recurring_transactions,
  public.transactions, public.budgets,
  public.snippets, public.code_projects, public.attachments;
