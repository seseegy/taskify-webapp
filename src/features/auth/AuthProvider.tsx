import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { forgetDevice } from '@/features/sandi/device-trust';
import { shouldLockOnAuthChange, useSandiStore } from '@/features/sandi/sandi-store';
import { supabase } from '@/lib/supabase';
import { AuthContext, type AuthState } from './auth-context';

const SIGNED_OUT: AuthState = { status: 'signed_out', session: null, user: null };

/**
 * Sumber kebenaran status login.
 * Sesi Supabase disimpan di localStorage & di-refresh otomatis, sehingga saat offline
 * aplikasi tetap terbuka dengan sesi terakhir (data dibaca dari SQLite lokal).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null, user: null });

  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    // onAuthStateChange langsung memicu INITIAL_SESSION dengan sesi tersimpan
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Provider ini tidak pernah di-unmount, jadi di sinilah DEK brankas Sandi dibuang saat akun
      // berubah (keluar dengan cara apa pun, atau akun lain masuk).
      const nextUserId = session?.user.id ?? null;
      if (shouldLockOnAuthChange(lastUserId.current, nextUserId)) {
        useSandiStore.getState().lock();
        // Kepercayaan perangkat terikat pada akun: jangan dibawa ke sesi/akun berikutnya.
        void forgetDevice();
      }
      lastUserId.current = nextUserId;
      setState(session ? { status: 'signed_in', session, user: session.user } : SIGNED_OUT);
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

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
