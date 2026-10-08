/**
 * Skema database LOKAL (SQLite di browser via PowerSync).
 *
 * Satu sumber kebenaran untuk client: tabel Drizzle di bawah dipakai untuk query yang
 * type-safe, dan `AppSchema` (skema PowerSync) diturunkan otomatis darinya.
 *
 * ⚠️ Harus selaras dengan migrasi Supabase (supabase/migrations) dan
 *    powersync/sync-config.yaml. Saat menambah kolom/tabel, ubah ketiganya.
 *
 * Pemetaan tipe Postgres → SQLite (PowerSync):
 *   uuid, text, date, time, timestamptz → text
 *   boolean, smallint, bigint           → integer (boolean = 0/1)
 *   double precision                    → real
 * Kolom `id` wajib text primary key (dibuat otomatis oleh PowerSync di sisi view).
 */
import { DrizzleAppSchema } from '@powersync/drizzle-driver';
import { relations } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// -----------------------------------------------------------------------------
// Kolom bersama
// -----------------------------------------------------------------------------
const base = () => ({
  id: text('id').primaryKey().notNull(),
  user_id: text('user_id').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

const softDelete = () => ({
  deleted_at: text('deleted_at'),
});

export const ENTITY_TYPES = [
  'task',
  'journal_entry',
  'transaction',
  'snippet',
  'code_project',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// -----------------------------------------------------------------------------
// Umum
// -----------------------------------------------------------------------------
export const userSettings = sqliteTable('user_settings', {
  ...base(),
  display_name: text('display_name'),
  currency: text('currency').notNull(),
  locale: text('locale').notNull(),
  timezone: text('timezone').notNull(),
  week_start: integer('week_start').notNull(),
});

export const tags = sqliteTable('tags', {
  ...base(),
  ...softDelete(),
  name: text('name').notNull(),
  color: text('color'),
});

export const taggings = sqliteTable(
  'taggings',
  {
    ...base(),
    tag_id: text('tag_id').notNull(),
    entity_type: text('entity_type').$type<EntityType>().notNull(),
    entity_id: text('entity_id').notNull(),
  },
  (t) => [
    index('taggings_entity').on(t.entity_type, t.entity_id),
    index('taggings_tag').on(t.tag_id),
  ],
);

export const entityLinks = sqliteTable(
  'entity_links',
  {
    ...base(),
    source_type: text('source_type').$type<EntityType>().notNull(),
    source_id: text('source_id').notNull(),
    target_type: text('target_type').$type<EntityType>().notNull(),
    target_id: text('target_id').notNull(),
  },
  (t) => [
    index('entity_links_source').on(t.source_type, t.source_id),
    index('entity_links_target').on(t.target_type, t.target_id),
  ],
);

// -----------------------------------------------------------------------------
// Tugas
// -----------------------------------------------------------------------------
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export const taskLists = sqliteTable('task_lists', {
  ...base(),
  ...softDelete(),
  name: text('name').notNull(),
  color: text('color'),
  icon: text('icon'),
  position: real('position').notNull(),
  is_archived: integer('is_archived').notNull(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    ...base(),
    ...softDelete(),
    list_id: text('list_id'),
    parent_id: text('parent_id'),
    series_id: text('series_id'),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status').$type<TaskStatus>().notNull(),
    priority: integer('priority').notNull(),
    due_date: text('due_date'),
    due_time: text('due_time'),
    remind_at: text('remind_at'),
    rrule: text('rrule'),
    completed_at: text('completed_at'),
    position: real('position').notNull(),
  },
  (t) => [
    index('tasks_due_date').on(t.due_date),
    index('tasks_list').on(t.list_id),
    index('tasks_parent').on(t.parent_id),
  ],
);

// -----------------------------------------------------------------------------
// Jurnal
// -----------------------------------------------------------------------------
export const journalEntries = sqliteTable(
  'journal_entries',
  {
    ...base(),
    ...softDelete(),
    entry_date: text('entry_date').notNull(),
    title: text('title'),
    content: text('content').notNull(),
    mood: integer('mood'),
    is_pinned: integer('is_pinned').notNull(),
  },
  (t) => [index('journal_entries_date').on(t.entry_date)],
);

// -----------------------------------------------------------------------------
// Keuangan
// -----------------------------------------------------------------------------
export type WalletType = 'cash' | 'bank' | 'ewallet' | 'investment' | 'other';
export type CategoryKind = 'income' | 'expense';
export type TransactionKind = 'income' | 'expense' | 'transfer';

export const wallets = sqliteTable('wallets', {
  ...base(),
  ...softDelete(),
  name: text('name').notNull(),
  type: text('type').$type<WalletType>().notNull(),
  currency: text('currency').notNull(),
  initial_balance: integer('initial_balance').notNull(),
  color: text('color'),
  icon: text('icon'),
  position: real('position').notNull(),
  is_archived: integer('is_archived').notNull(),
});

export const categories = sqliteTable('categories', {
  ...base(),
  ...softDelete(),
  parent_id: text('parent_id'),
  name: text('name').notNull(),
  kind: text('kind').$type<CategoryKind>().notNull(),
  color: text('color'),
  icon: text('icon'),
  position: real('position').notNull(),
  is_archived: integer('is_archived').notNull(),
});

export const debts = sqliteTable('debts', {
  ...base(),
  ...softDelete(),
  direction: text('direction').$type<'lent' | 'borrowed'>().notNull(),
  counterparty: text('counterparty').notNull(),
  amount: integer('amount').notNull(),
  due_date: text('due_date'),
  note: text('note'),
  settled_at: text('settled_at'),
});

export const recurringTransactions = sqliteTable('recurring_transactions', {
  ...base(),
  ...softDelete(),
  kind: text('kind').$type<TransactionKind>().notNull(),
  amount: integer('amount').notNull(),
  wallet_id: text('wallet_id').notNull(),
  to_wallet_id: text('to_wallet_id'),
  category_id: text('category_id'),
  title: text('title').notNull(),
  note: text('note'),
  rrule: text('rrule').notNull(),
  start_on: text('start_on').notNull(),
  end_on: text('end_on'),
  next_run_on: text('next_run_on'),
  auto_post: integer('auto_post').notNull(),
  is_active: integer('is_active').notNull(),
});

export const transactions = sqliteTable(
  'transactions',
  {
    ...base(),
    ...softDelete(),
    kind: text('kind').$type<TransactionKind>().notNull(),
    amount: integer('amount').notNull(),
    wallet_id: text('wallet_id').notNull(),
    to_wallet_id: text('to_wallet_id'),
    category_id: text('category_id'),
    occurred_on: text('occurred_on').notNull(),
    occurred_time: text('occurred_time'),
    title: text('title'),
    note: text('note'),
    task_id: text('task_id'),
    recurring_id: text('recurring_id'),
    debt_id: text('debt_id'),
  },
  (t) => [
    index('transactions_date').on(t.occurred_on),
    index('transactions_wallet').on(t.wallet_id),
    index('transactions_category').on(t.category_id),
  ],
);

export const budgets = sqliteTable('budgets', {
  ...base(),
  ...softDelete(),
  category_id: text('category_id'),
  amount: integer('amount').notNull(),
  start_month: text('start_month').notNull(),
  end_month: text('end_month'),
  alert_pct: integer('alert_pct').notNull(),
});

// -----------------------------------------------------------------------------
// Vault
// -----------------------------------------------------------------------------
export const snippets = sqliteTable('snippets', {
  ...base(),
  ...softDelete(),
  title: text('title').notNull(),
  language: text('language').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  is_favorite: integer('is_favorite').notNull(),
});

export const codeProjects = sqliteTable('code_projects', {
  ...base(),
  ...softDelete(),
  name: text('name').notNull(),
  description: text('description'),
  repo_url: text('repo_url'),
  is_favorite: integer('is_favorite').notNull(),
  position: real('position').notNull(),
});

export type AttachmentStatus = 'pending' | 'uploaded' | 'failed';

export const attachments = sqliteTable(
  'attachments',
  {
    ...base(),
    ...softDelete(),
    entity_type: text('entity_type').$type<EntityType>().notNull(),
    entity_id: text('entity_id').notNull(),
    storage_key: text('storage_key').notNull(),
    file_name: text('file_name').notNull(),
    mime_type: text('mime_type'),
    size_bytes: integer('size_bytes').notNull(),
    sha256: text('sha256'),
    version_label: text('version_label'),
    note: text('note'),
    status: text('status').$type<AttachmentStatus>().notNull(),
    uploaded_at: text('uploaded_at'),
  },
  (t) => [index('attachments_entity').on(t.entity_type, t.entity_id)],
);

// -----------------------------------------------------------------------------
// Sandi (password manager) — SEMUA isi terenkripsi di perangkat (src/features/sandi/crypto.ts).
// Server dan database lokal hanya melihat ciphertext; tidak ada kolom judul/URL/username polos.
// -----------------------------------------------------------------------------
export const pwKeys = sqliteTable('pw_keys', {
  ...base(),
  version: integer('version').notNull(),
  kdf: text('kdf').notNull(),
  iterations: integer('iterations').notNull(),
  salt: text('salt').notNull(),
  wrapped_key: text('wrapped_key').notNull(),
  recovery_salt: text('recovery_salt').notNull(),
  recovery_wrapped_key: text('recovery_wrapped_key').notNull(),
});

export const pwItems = sqliteTable('pw_items', {
  ...base(),
  ...softDelete(),
  enc: text('enc').notNull(),
  v: integer('v').notNull(),
});

// -----------------------------------------------------------------------------
// LOCAL-ONLY: perubahan yang ditolak server permanen (constraint/RLS).
// Tidak disinkron. Disimpan agar data tidak hilang diam-diam; daftar, salin, dan bersihkan
// di Pengaturan → Sinkronisasi (features/settings/UploadErrors.tsx).
// -----------------------------------------------------------------------------
export const uploadErrors = sqliteTable('upload_errors', {
  id: text('id').primaryKey().notNull(),
  op: text('op').notNull(), // PUT | PATCH | DELETE
  table_name: text('table_name').notNull(),
  row_id: text('row_id').notNull(),
  payload: text('payload'), // JSON
  error_code: text('error_code'),
  error_message: text('error_message'),
  created_at: text('created_at').notNull(),
});

// -----------------------------------------------------------------------------
// Relasi (untuk query relasional Drizzle: db.query.tasks.findMany({ with: { list: true } }))
// -----------------------------------------------------------------------------
export const taskListsRelations = relations(taskLists, ({ many }) => ({
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  list: one(taskLists, { fields: [tasks.list_id], references: [taskLists.id] }),
  parent: one(tasks, {
    fields: [tasks.parent_id],
    references: [tasks.id],
    relationName: 'subtasks',
  }),
  subtasks: many(tasks, { relationName: 'subtasks' }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  wallet: one(wallets, { fields: [transactions.wallet_id], references: [wallets.id] }),
  category: one(categories, { fields: [transactions.category_id], references: [categories.id] }),
  task: one(tasks, { fields: [transactions.task_id], references: [tasks.id] }),
}));

export const walletsRelations = relations(wallets, ({ many }) => ({
  transactions: many(transactions),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  transactions: many(transactions),
}));

// -----------------------------------------------------------------------------
// Ekspor skema
// -----------------------------------------------------------------------------
export const drizzleSchema = {
  userSettings,
  tags,
  taggings,
  entityLinks,
  taskLists,
  tasks,
  journalEntries,
  wallets,
  categories,
  debts,
  recurringTransactions,
  transactions,
  budgets,
  snippets,
  codeProjects,
  attachments,
  pwKeys,
  pwItems,
  uploadErrors,
  taskListsRelations,
  tasksRelations,
  transactionsRelations,
  walletsRelations,
  categoriesRelations,
};

/**
 * Skema PowerSync, diturunkan dari tabel Drizzle (relations diabaikan otomatis).
 * `upload_errors` ditandai localOnly agar tidak pernah masuk antrean upload.
 */
export const AppSchema = new DrizzleAppSchema({
  ...drizzleSchema,
  uploadErrors: { tableDefinition: uploadErrors, options: { localOnly: true } },
});

export type Task = typeof tasks.$inferSelect;
export type TaskList = typeof taskLists.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Snippet = typeof snippets.$inferSelect;
export type CodeProject = typeof codeProjects.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type PwKeys = typeof pwKeys.$inferSelect;
export type PwItem = typeof pwItems.$inferSelect;
