/**
 * Verifikasi dua langkah (MFA, TOTP) — WAJIB untuk memakai Taskify.
 *
 * Lapisan penegakan (semuanya perlu; satu saja bisa dilewati):
 *   1. Aplikasi  — App.tsx tidak membuka database/sync sebelum sesi berlevel aal2 (lihat
 *                  MfaScreen). Akun tanpa authenticator diminta mendaftarkannya dulu.
 *   2. Postgres  — policy RESTRICTIVE `mfa_aal2` di semua tabel: akun yang punya faktor
 *                  terverifikasi wajib memakai token aal2 (migrasi 20261017000100_mfa_enforce).
 *   3. PowerSync — setiap query Sync Streams mensyaratkan `auth.parameter('aal') = 'aal2'`.
 *                  PowerSync membaca lewat replikasi, TIDAK melewati RLS, jadi lapisan 2 tidak
 *                  melindungi jalur ini.
 *   4. Edge Function — `files` & `send-reminders` menolak token aal1 bila akun punya MFA.
 *
 * Status dihitung dari sesi yang tersimpan (tanpa jaringan), sama seperti
 * `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`: level sekarang = claim `aal` di JWT,
 * level berikutnya = aal2 bila user punya faktor terverifikasi. Jadi gerbang ini tetap bekerja
 * saat offline, dan sesi aal2 yang sudah ada tetap bisa membuka aplikasi tanpa internet.
 */
import type { Session } from '@supabase/supabase-js';

/**
 *   ok        sesi aal2 → boleh masuk
 *   challenge punya authenticator, sesi masih aal1 → minta kode 6 digit
 *   enroll    belum punya authenticator → wajib mendaftarkan dulu
 */
export type MfaStatus = 'ok' | 'challenge' | 'enroll';

/** Payload JWT tanpa verifikasi tanda tangan (token berasal dari Supabase Auth sendiri). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function hasVerifiedFactor(session: Pick<Session, 'user'>): boolean {
  return (session.user.factors ?? []).some((f) => f.status === 'verified');
}

export function mfaStatus(session: Pick<Session, 'access_token' | 'user'>): MfaStatus {
  if (decodeJwtPayload(session.access_token)?.aal === 'aal2') return 'ok';
  return hasVerifiedFactor(session) ? 'challenge' : 'enroll';
}

/** Kode TOTP: tepat 6 angka (spasi dari salin-tempel dibuang). */
export const normalizeTotpCode = (raw: string) => raw.replace(/\s+/g, '');
export const isTotpCode = (code: string) => /^\d{6}$/.test(code);

/** Pesan error MFA yang bisa dimengerti. */
export function translateMfaError(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string; name?: string; status?: number };
  const msg = err.message ?? String(e);
  if (
    err.name === 'AuthRetryableFetchError' ||
    err.status === 0 ||
    /failed to fetch|network/i.test(msg)
  )
    return 'Butuh koneksi internet untuk verifikasi dua langkah.';
  if (err.code === 'mfa_verification_failed' || /invalid totp|invalid code/i.test(msg))
    return 'Kode salah atau sudah kedaluwarsa. Pakai kode terbaru dari aplikasi authenticator.';
  if (err.status === 429 || err.code === 'over_request_rate_limit')
    return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
  if (err.code === 'mfa_totp_enroll_not_enabled' || err.code === 'mfa_totp_verify_not_enabled')
    return 'MFA TOTP dimatikan di server. Aktifkan di Supabase Dashboard → Authentication → Multi-Factor.';
  if (err.code === 'insufficient_aal')
    return 'Sesi ini belum terverifikasi dua langkah. Masukkan kode authenticator dulu.';
  return msg;
}
