import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';
import type { GateStatus } from './mfa-trust';

export type AuthState =
  | { status: 'loading'; session: null; user: null }
  | { status: 'signed_out'; session: null; user: null }
  | { status: 'signed_in'; session: Session; user: User; mfa: GateStatus };

export interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Ganti sesi aal1 → aal2 dengan kode TOTP dari authenticator. */
  verifyMfa: (factorId: string, code: string) => Promise<void>;
  /** Konfirmasi ulang perangkat tidak bisa diperiksa (offline): lanjutkan untuk pembukaan ini. */
  skipReverify: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() harus dipakai di dalam <AuthProvider>');
  return ctx;
}

/** User yang sedang login. Hanya untuk komponen di balik gerbang login. */
export function useUser(): User {
  const { state } = useAuth();
  if (state.status !== 'signed_in') throw new Error('useUser() dipanggil sebelum login');
  return state.user;
}
