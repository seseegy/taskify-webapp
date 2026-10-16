-- =============================================================================
-- Verifikasi dua langkah (MFA) ditegakkan di database
-- =============================================================================
-- Aplikasi mewajibkan MFA (src/features/auth/mfa.ts), tetapi itu hanya di tampilan. Siapa pun yang
-- tahu password tetap mendapat token `aal1` dan bisa memanggil Data API (PostgREST) langsung,
-- melewati layar kode. Policy di bawah menutup jalur itu:
--
--   akun yang punya faktor MFA TERVERIFIKASI  → wajib token aal2 untuk SEMUA baca/tulis
--   akun tanpa faktor                         → tetap boleh aal1 (supaya akun bisa mendaftarkan
--                                               authenticator pertamanya, dan migrasi ini aman
--                                               di-deploy sebelum MFA diaktifkan)
--
-- Policy-nya RESTRICTIVE: digabung dengan AND ke policy pemilik yang sudah ada (owner_*). Policy
-- permissive biasa akan digabung OR dan TIDAK membatasi apa pun.
--
-- Jalur lain yang ditegakkan terpisah (RLS tidak menjangkaunya):
--   * PowerSync   → powersync/sync-config.yaml mensyaratkan auth.parameter('aal') = 'aal2'
--   * Edge Function `files` & `send-reminders` → supabase/functions/_shared/mfa.ts
--
-- Tabel baru yang dibuka untuk `authenticated` WAJIB mendapat policy yang sama (ada tes yang
-- memeriksanya: supabase/tests/migrations.test.ts).
-- =============================================================================

-- SECURITY DEFINER: role `authenticated` tidak boleh membaca auth.mfa_factors secara langsung.
-- Fungsi ini hanya mengembalikan true/false untuk pemanggil sendiri.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
           select 1 from auth.mfa_factors f
            where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

-- Semua tabel yang punya policy pemilik (owner_select) = semua tabel yang dibuka untuk klien,
-- termasuk push_subscriptions yang tidak disinkron PowerSync.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_policies
     where schemaname = 'public' and policyname = 'owner_select'
  loop
    -- `(select …)` → dievaluasi sekali per query, bukan per baris
    execute format(
      'create policy "mfa_aal2" on public.%I as restrictive for all to authenticated
         using ((select public.mfa_satisfied()))
         with check ((select public.mfa_satisfied()))', t);
  end loop;
end;
$$;
