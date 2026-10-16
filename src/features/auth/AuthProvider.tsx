import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { forgetDevice } from '@/features/sandi/device-trust';
import { shouldLockOnAuthChange, useSandiStore } from '@/features/sandi/sandi-store';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { AuthContext, type AuthState } from './auth-context';
import { mfaStatus } from './mfa';
import { recordVerification, resolveGate, skipReverifyOffline } from './mfa-trust';

const SIGNED_OUT: AuthState = { status: 'signed_out', session: null, user: null };

const signedIn = (session: Session): AuthState => ({
  status: 'signed_in',
  session,
  user: session.user,
  mfa: resolveGate(mfaStatus(session), session.user.id),
});

/**
 * Sumber kebenaran status login.
 * Sesi Supabase disimpan di localStorage & di-refresh otomatis, sehingga saat offline
 * aplikasi tetap terbuka dengan sesi terakhir (data dibaca dari SQLite lokal).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null, user: null });

  const lastUserId = useRef<string | null>(null);
  const lastSession = useRef<Session | null>(null);

  useEffect(() => {
    // onAuthStateChange langsung memicu INITIAL_SESSION dengan sesi tersimpan
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Provider ini tidak pernah di-unmount, jadi di sinilah DEK brankas Sandi dibuang saat akun
      // berubah (keluar dengan cara apa pun, atau akun lain masuk).
      const nextUserId = session?.user.id ?? null;
      if (shouldLockOnAuthChange(lastUserId.current, nextUserId)) {
        useSandiStore.getState().lock();
        // Kepercayaan perangkat terikat pada akun: jangan dibawa ke sesi/akun berikutnya.
        void forgetDevice();
      }
      lastUserId.current = nextUserId;
      lastSession.current = session;
      // Kode baru saja benar (masuk, daftar authenticator, atau konfirmasi ulang perangkat):
      // catat SEBELUM gerbang dihitung, berikut pilihan "Ingat perangkat ini" (mfa-trust.ts).
      if (session && event === 'MFA_CHALLENGE_VERIFIED') recordVerification(session.user.id);
      setState(session ? signedIn(session) : SIGNED_OUT);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    // Global (mencabut refresh token di server) butuh internet. Bila gagal — offline, atau
    // server menolak — tetap keluarkan sesi di perangkat ini; tanpa ini pengguna "tertahan"
    // login padahal database lokalnya sudah dikosongkan. Refresh token yang tidak sempat dicabut
    // kedaluwarsa sendiri di server.
    const { error } = await supabase.auth.signOut();
    if (!error) return;
    const local = await supabase.auth.signOut({ scope: 'local' });
    if (local.error) throw local.error;
  }, []);

  const verifyMfa = useCallback(async (factorId: string, code: string) => {
    // Sukses → Supabase memancarkan MFA_CHALLENGE_VERIFIED dengan sesi aal2 → state di atas.
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
  }, []);

  const skipReverify = useCallback(() => {
    const session = lastSession.current;
    if (!session) return;
    skipReverifyOffline(session.user.id);
    setState(signedIn(session));
  }, []);

  const value = useMemo(
    () => ({ state, signIn, signOut, verifyMfa, skipReverify }),
    [state, signIn, signOut, verifyMfa, skipReverify],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
