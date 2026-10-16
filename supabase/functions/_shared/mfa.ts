// =============================================================================
// MFA di Edge Function — aturan yang sama dengan policy RLS `mfa_aal2`
// (supabase/migrations/20261017000100_mfa_enforce.sql):
//   akun dengan faktor MFA terverifikasi → token wajib aal2; akun tanpa faktor → aal1 boleh.
//
// Edge Function memakai service role (melewati RLS), jadi aturan ini harus diperiksa sendiri.
// MURNI (tanpa impor Deno/npm) agar bisa diuji Vitest: supabase/tests/edge-mfa.test.ts.
// =============================================================================

export interface UserWithFactors {
  factors?: { status: string }[] | null;
}

/** Claim `aal` dari JWT. Dipanggil SETELAH token divalidasi `auth.getUser(token)`. */
export function tokenAal(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const aal = (JSON.parse(json) as { aal?: unknown }).aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}

export function mfaRequirementMet(user: UserWithFactors, token: string): boolean {
  if (tokenAal(token) === 'aal2') return true;
  return !(user.factors ?? []).some((f) => f.status === 'verified');
}
