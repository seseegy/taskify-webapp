-- =============================================================================
-- Pengingat: coba ulang jika pengiriman gagal
-- =============================================================================
-- Sebelumnya `claim_due_reminders` menulis log saat KLAIM, dan log itu dianggap "sudah terkirim".
-- Akibatnya pengingat hilang selamanya jika Web Push gagal sesaat (layanan push 5xx, timeout
-- Edge Function) atau Edge Function mati setelah klaim.
--
-- Sekarang log punya dua tahap:
--   claimed_at    kapan terakhir diklaim (kunci agar cron yang tumpang tindih tidak kirim dobel)
--   delivered_at  diisi Edge Function HANYA setelah push benar-benar diterima/tidak ada tujuan
-- Pengingat yang diklaim tetapi belum delivered dan sudah > 3 menit diklaim ulang, maksimal 5 kali
-- (dalam jendela 24 jam yang sama seperti sebelumnya).
--
-- Urutan deploy: Edge Function `send-reminders` DULU (`pnpm fn:deploy`), baru migrasi ini
-- (`pnpm db:push`). Fungsi baru aman dijalankan di atas skema lama; kebalikannya akan mengirim
-- ulang pengingat karena fungsi lama tidak pernah menandai delivered.
-- =============================================================================

alter table public.task_reminder_log
  add column if not exists delivered_at timestamptz,
  add column if not exists attempts smallint not null default 1;

-- Baris lama sudah diperlakukan sebagai terkirim → jangan dikirim ulang
update public.task_reminder_log set delivered_at = sent_at where delivered_at is null;

alter table public.task_reminder_log rename column sent_at to claimed_at;
alter index if exists public.task_reminder_log_sent_at_idx rename to task_reminder_log_claimed_at_idx;

-- -----------------------------------------------------------------------------
-- Klaim pengingat jatuh tempo (atomik; juga mengklaim ulang yang gagal terkirim)
-- -----------------------------------------------------------------------------
-- `on conflict … do update … where` dievaluasi ulang setelah baris dikunci, jadi dua eksekusi cron
-- yang tumpang tindih tidak pernah sama-sama mendapat pengingat yang sama.
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
      left join public.task_reminder_log l
             on l.task_id = t.id and l.remind_at = t.remind_at
     where t.remind_at <= now()
       and t.remind_at > now() - interval '24 hours'
       and t.completed_at is null
       and t.deleted_at is null
       and t.status in ('todo', 'in_progress')
       and (l.task_id is null
            or (l.delivered_at is null
                and l.attempts < 5
                and l.claimed_at < now() - interval '3 minutes'))
     order by t.remind_at
     limit p_limit
  ),
  claimed as (
    insert into public.task_reminder_log as g (task_id, remind_at, user_id)
    select d.id, d.remind_at, d.user_id from due d
    on conflict on constraint task_reminder_log_pkey do update
       set claimed_at = now(), attempts = g.attempts + 1
     where g.delivered_at is null
       and g.attempts < 5
       and g.claimed_at < now() - interval '3 minutes'
    returning g.task_id, g.remind_at
  )
  select d.id, d.user_id, d.title, d.due_date, d.due_time, d.remind_at
    from due d
    join claimed c on c.task_id = d.id and c.remind_at = d.remind_at;
$$;

-- -----------------------------------------------------------------------------
-- Tandai terkirim (dipanggil Edge Function setelah push sukses)
-- -----------------------------------------------------------------------------
create or replace function public.mark_reminders_delivered(
  p_task_ids   uuid[],
  p_remind_ats timestamptz[]
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.task_reminder_log l
       set delivered_at = now()
      from unnest(p_task_ids, p_remind_ats) as x (task_id, remind_at)
     where l.task_id = x.task_id
       and l.remind_at = x.remind_at
       and l.delivered_at is null
    returning 1
  )
  select count(*)::integer from u;
$$;

-- Bersihkan log lama (kolom berganti nama)
create or replace function public.prune_reminder_log()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.task_reminder_log where claimed_at < now() - interval '60 days';
$$;

revoke execute on function public.claim_due_reminders(integer) from public, anon, authenticated;
revoke execute on function public.mark_reminders_delivered(uuid[], timestamptz[]) from public, anon, authenticated;
revoke execute on function public.prune_reminder_log() from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;
grant execute on function public.mark_reminders_delivered(uuid[], timestamptz[]) to service_role;
grant execute on function public.prune_reminder_log() to service_role;
