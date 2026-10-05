-- =============================================================================
-- Taskify — skema inti
-- =============================================================================
-- Konvensi (WAJIB diikuti oleh semua tabel tersinkron, lihat docs/ARCHITECTURE.md):
--   * id          uuid, DIBUAT DI CLIENT (UUIDv7) — offline-first, tanpa auto-increment
--   * user_id     pemilik baris; dipakai RLS & Sync Streams
--   * created_at / updated_at  timestamptz (UTC); updated_at diisi trigger
--   * deleted_at  soft delete → fitur "Sampah" & pemulihan
--   * Uang        bigint dalam satuan terkecil (IDR = rupiah utuh). TIDAK pakai float.
--   * Tanggal tanpa jam → kolom `date` ('YYYY-MM-DD'), supaya tidak bergeser zona waktu.
--   * Enum        text + CHECK (lebih aman untuk sinkronisasi daripada tipe enum Postgres).
--   * Hindari UNIQUE pada data yang bisa diedit user: pelanggaran constraint saat upload
--     membuat perubahan offline dibuang. Validasi keunikan dilakukan di UI.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: auto-update updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pengaturan pengguna (1 baris per user)
-- -----------------------------------------------------------------------------
create table public.user_settings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  display_name  text,
  currency      text not null default 'IDR' check (char_length(currency) = 3),
  locale        text not null default 'id-ID',
  timezone      text not null default 'Asia/Jakarta',
  week_start    smallint not null default 1 check (week_start between 0 and 6), -- 1 = Senin
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index user_settings_user_id_key on public.user_settings (user_id);

-- -----------------------------------------------------------------------------
-- Tag global (dipakai lintas fitur)
-- -----------------------------------------------------------------------------
create table public.tags (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 50),
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index tags_user_id_idx on public.tags (user_id);

-- Relasi tag ↔ entitas apa pun (polimorfik)
create table public.taggings (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tag_id       uuid not null references public.tags (id) on delete cascade,
  entity_type  text not null check (entity_type in (
                 'task', 'journal_entry', 'transaction', 'snippet', 'code_project')),
  entity_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index taggings_user_id_idx on public.taggings (user_id);
create index taggings_tag_id_idx on public.taggings (tag_id);
create index taggings_entity_idx on public.taggings (entity_type, entity_id);

-- Tautan silang antar entitas (mis. tugas "Bayar hosting" ↔ transaksi pengeluaran)
create table public.entity_links (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_type  text not null check (source_type in (
                 'task', 'journal_entry', 'transaction', 'snippet', 'code_project')),
  source_id    uuid not null,
  target_type  text not null check (target_type in (
                 'task', 'journal_entry', 'transaction', 'snippet', 'code_project')),
  target_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (not (source_type = target_type and source_id = target_id))
);
create index entity_links_user_id_idx on public.entity_links (user_id);
create index entity_links_source_idx on public.entity_links (source_type, source_id);
create index entity_links_target_idx on public.entity_links (target_type, target_id);

-- =============================================================================
-- TUGAS
-- =============================================================================
create table public.task_lists (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  color        text,
  icon         text,
  position     double precision not null default 0,   -- fractional indexing untuk drag & drop
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index task_lists_user_id_idx on public.task_lists (user_id);

create table public.tasks (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  list_id       uuid references public.task_lists (id) on delete set null,
  parent_id     uuid references public.tasks (id) on delete cascade,      -- subtask
  series_id     uuid,              -- semua kejadian dari 1 tugas berulang berbagi series_id
  title         text not null check (char_length(title) between 1 and 300),
  notes         text,              -- markdown
  status        text not null default 'todo'
                  check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority      smallint not null default 0 check (priority between 0 and 3), -- 0 none … 3 tinggi
  due_date      date,              -- tanggal lokal (WIB), tanpa jam
  due_time      time,              -- opsional; null = sepanjang hari
  remind_at     timestamptz,       -- waktu absolut untuk notifikasi
  rrule         text,              -- RFC 5545, mis. 'FREQ=WEEKLY;BYDAY=MO,TH'
  completed_at  timestamptz,
  position      double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check ((status = 'done') = (completed_at is not null)),
  check (due_time is null or due_date is not null)
);
create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_due_date_idx on public.tasks (user_id, due_date);
create index tasks_list_id_idx on public.tasks (list_id);
create index tasks_parent_id_idx on public.tasks (parent_id);
create index tasks_remind_at_idx on public.tasks (remind_at) where remind_at is not null and completed_at is null;

-- =============================================================================
-- JURNAL
-- =============================================================================
create table public.journal_entries (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date  date not null,
  title       text check (title is null or char_length(title) <= 200),
  content     text not null default '',            -- markdown
  mood        smallint check (mood between 1 and 5),  -- 1 sangat buruk … 5 sangat baik
  is_pinned   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index journal_entries_user_id_idx on public.journal_entries (user_id);
create index journal_entries_date_idx on public.journal_entries (user_id, entry_date);

-- =============================================================================
-- KEUANGAN
-- =============================================================================
create table public.wallets (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 60),
  type             text not null default 'cash'
                     check (type in ('cash', 'bank', 'ewallet', 'investment', 'other')),
  currency         text not null default 'IDR' check (char_length(currency) = 3),
  initial_balance  bigint not null default 0,
  color            text,
  icon             text,
  position         double precision not null default 0,
  is_archived      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index wallets_user_id_idx on public.wallets (user_id);

create table public.categories (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id    uuid references public.categories (id) on delete set null,
  name         text not null check (char_length(name) between 1 and 60),
  kind         text not null check (kind in ('income', 'expense')),
  color        text,
  icon         text,
  position     double precision not null default 0,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index categories_user_id_idx on public.categories (user_id);
create index categories_parent_id_idx on public.categories (parent_id);

-- Hutang / piutang
create table public.debts (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  direction     text not null check (direction in ('lent', 'borrowed')), -- lent = piutang
  counterparty  text not null check (char_length(counterparty) between 1 and 100),
  amount        bigint not null check (amount > 0),
  due_date      date,
  note          text,
  settled_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index debts_user_id_idx on public.debts (user_id);

-- Template transaksi berulang (langganan, tagihan, gaji)
create table public.recurring_transactions (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('income', 'expense', 'transfer')),
  amount        bigint not null check (amount > 0),
  wallet_id     uuid not null references public.wallets (id) on delete restrict,
  to_wallet_id  uuid references public.wallets (id) on delete restrict,
  category_id   uuid references public.categories (id) on delete set null,
  title         text not null check (char_length(title) between 1 and 120),
  note          text,
  rrule         text not null,
  start_on      date not null,
  end_on        date,
  next_run_on   date,             -- null = selesai
  auto_post     boolean not null default false, -- false = hanya diingatkan, true = dicatat otomatis
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check ((kind = 'transfer') = (to_wallet_id is not null)),
  check (to_wallet_id is null or to_wallet_id <> wallet_id)
);
create index recurring_transactions_user_id_idx on public.recurring_transactions (user_id);
create index recurring_transactions_wallet_id_idx on public.recurring_transactions (wallet_id);

create table public.transactions (
  id             uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind           text not null check (kind in ('income', 'expense', 'transfer')),
  amount         bigint not null check (amount > 0),
  wallet_id      uuid not null references public.wallets (id) on delete restrict,
  to_wallet_id   uuid references public.wallets (id) on delete restrict, -- hanya untuk transfer
  category_id    uuid references public.categories (id) on delete set null,
  occurred_on    date not null,   -- tanggal lokal (WIB)
  occurred_time  time,
  title          text check (title is null or char_length(title) <= 120),
  note           text,
  task_id        uuid references public.tasks (id) on delete set null,
  recurring_id   uuid references public.recurring_transactions (id) on delete set null,
  debt_id        uuid references public.debts (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  check ((kind = 'transfer') = (to_wallet_id is not null)),
  check (to_wallet_id is null or to_wallet_id <> wallet_id),
  check (kind <> 'transfer' or category_id is null)
);
create index transactions_user_id_idx on public.transactions (user_id);
create index transactions_date_idx on public.transactions (user_id, occurred_on);
create index transactions_wallet_id_idx on public.transactions (wallet_id);
create index transactions_to_wallet_id_idx on public.transactions (to_wallet_id);
create index transactions_category_id_idx on public.transactions (category_id);
create index transactions_task_id_idx on public.transactions (task_id);
create index transactions_recurring_id_idx on public.transactions (recurring_id);
create index transactions_debt_id_idx on public.transactions (debt_id);

-- Anggaran bulanan per kategori (category_id null = anggaran total)
create table public.budgets (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete cascade,
  amount       bigint not null check (amount > 0),
  start_month  date not null check (extract(day from start_month) = 1),
  end_month    date check (end_month is null or extract(day from end_month) = 1),
  alert_pct    smallint not null default 80 check (alert_pct between 1 and 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index budgets_user_id_idx on public.budgets (user_id);
create index budgets_category_id_idx on public.budgets (category_id);

-- =============================================================================
-- VAULT: snippet kode & arsip project
-- =============================================================================
create table public.snippets (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  language     text not null default 'plaintext',
  code         text not null default '',
  description  text,
  is_favorite  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index snippets_user_id_idx on public.snippets (user_id);

create table public.code_projects (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  description  text,
  repo_url     text,
  is_favorite  boolean not null default false,
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index code_projects_user_id_idx on public.code_projects (user_id);

-- Metadata file di Cloudflare R2 (zip project, foto struk, gambar jurnal, dll).
-- Isi file TIDAK disimpan di Postgres — hanya metadata + object key R2.
create table public.attachments (
  id             uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_type    text not null check (entity_type in (
                   'task', 'journal_entry', 'transaction', 'snippet', 'code_project')),
  entity_id      uuid not null,
  storage_key    text not null,   -- object key di R2: <user_id>/<attachment_id>/<file_name>
  file_name      text not null check (char_length(file_name) between 1 and 255),
  mime_type      text,
  size_bytes     bigint not null check (size_bytes between 0 and 104857600), -- maks 100 MB
  sha256         text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  version_label  text,            -- mis. 'v1.2.0' untuk zip project
  note           text,
  status         text not null default 'pending' check (status in ('pending', 'uploaded', 'failed')),
  uploaded_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index attachments_user_id_idx on public.attachments (user_id);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);
create index attachments_sha256_idx on public.attachments (user_id, sha256);

-- -----------------------------------------------------------------------------
-- Trigger updated_at untuk semua tabel
-- -----------------------------------------------------------------------------
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
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
