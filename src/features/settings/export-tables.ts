// Dipisah dari export-data.ts agar bisa diimpor tes (supabase/tests) tanpa menarik alias '@/' & DOM.
/** Tabel tersinkron yang ikut diekspor (isi file lampiran tetap di R2, hanya metadata). */
export const EXPORT_TABLES = [
  'user_settings',
  'tags',
  'taggings',
  'entity_links',
  'task_lists',
  'tasks',
  'journal_entries',
  'wallets',
  'categories',
  'debts',
  'recurring_transactions',
  'transactions',
  'budgets',
  'snippets',
  'code_projects',
  'attachments',
  // Sandi: hanya ciphertext (aman diekspor; tidak bisa dibuka tanpa master password)
  'pw_keys',
  'pw_items',
  'pw_totp_log',
] as const;
