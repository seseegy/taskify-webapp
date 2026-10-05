-- =============================================================================
-- Pengingat tugas via Web Push
-- =============================================================================
-- Alur:
--   pg_cron (tiap menit) → Edge Function `send-reminders`
--     → public.claim_due_reminders()   (klaim atomik pengingat yang jatuh tempo)
--     → kirim Web Push ke semua push_subscriptions milik user
--
-- Tabel di sini TIDAK disinkron ke PowerSync:
--   * push_subscriptions → ditulis client langsung via supabase-js (butuh online,
--     sama seperti mengaktifkan notifikasi itu sendiri).
--   * task_reminder_log  → hanya server. Kunci (task_id, remind_at) berarti jika user
--     mengubah waktu pengingat, pengingat baru tetap terkirim; kalau tidak, tidak dobel.
-- Penjadwalan cron ada di supabase/sql/schedule-reminders.sql (butuh secret, jalankan manual).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Langganan push per perangkat/browser
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy "owner_select" on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "owner_insert" on public.push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "owner_update" on public.push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner_delete" on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Log pengingat terkirim (server-only)
-- -----------------------------------------------------------------------------
create table public.task_reminder_log (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  remind_at  timestamptz not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (task_id, remind_at)
);
create index task_reminder_log_sent_at_idx on public.task_reminder_log (sent_at);

alter table public.task_reminder_log enable row level security;
alter table public.task_reminder_log force row level security;
-- Tanpa policy & tanpa grant → client tidak bisa membaca/menulis sama sekali.
revoke all on public.task_reminder_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Klaim pengingat yang jatuh tempo (atomik, aman jika cron tumpang tindih)
-- -----------------------------------------------------------------------------
-- Mengambil tugas aktif dengan remind_at <= sekarang (maks. 24 jam terlambat — pengingat
-- yang lebih tua dianggap basi), mencatatnya di log, dan mengembalikan yang berhasil diklaim.
create or replace function public.claim_due_reminders(p_limit integer default 200)
returns table (
  task_id    uuid,
  user_id    uuid,
  title      text,
  due_date   date,
  due_time   time,
  remind_at  timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select t.id, t.user_id, t.title, t.due_date, t.due_time, t.remind_at
      from public.tasks t
     where t.remind_at <= now()
       and t.remind_at > now() - interval '24 hours'
       and t.completed_at is null
       and t.deleted_at is null
       and t.status in ('todo', 'in_progress')
       and not exists (
         select 1 from public.task_reminder_log l
          where l.task_id = t.id and l.remind_at = t.remind_at)
     order by t.remind_at
     limit p_limit
  ),
  claimed as (
    insert into public.task_reminder_log (task_id, remind_at, user_id)
    select d.id, d.remind_at, d.user_id from due d
    on conflict do nothing
    returning task_reminder_log.task_id, task_reminder_log.remind_at
  )
  select d.id, d.user_id, d.title, d.due_date, d.due_time, d.remind_at
    from due d
    join claimed c on c.task_id = d.id and c.remind_at = d.remind_at;
$$;

revoke execute on function public.claim_due_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;

-- Bersihkan log lama (dipanggil Edge Function sesekali)
create or replace function public.prune_reminder_log()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.task_reminder_log where sent_at < now() - interval '60 days';
$$;

revoke execute on function public.prune_reminder_log() from public, anon, authenticated;
grant execute on function public.prune_reminder_log() to service_role;
