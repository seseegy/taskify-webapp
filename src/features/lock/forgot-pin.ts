/**
 * "Lupa PIN": membuka kunci dengan memverifikasi PASSWORD akun ke server, lalu PIN di perangkat
 * ini dimatikan (atur PIN baru di Pengaturan).
 *
 * Tidak menurunkan keamanan: password lebih sulit ditebak daripada PIN 4–8 digit, percobaan
 * password dibatasi server (Supabase Auth), dan siapa pun yang punya password sudah bisa login
 * dari perangkat lain. Pemegang HP saja (tanpa password) tidak mendapat celah baru.
 * Butuh internet; offline tidak ada jalan keluar selain PIN yang benar.
 */

export type ForgotFailure = 'offline' | 'empty' | 'wrong' | 'rate_limited' | 'error';

export type ForgotResult = { ok: true } | { ok: false; reason: ForgotFailure; message: string };

/** Bentuk minimal error dari supabase-js (AuthError). */
export interface AuthLikeError {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
}

export interface ForgotInput {
  email: string | null | undefined;
  password: string;
  online: boolean;
  /** Lempar error AuthLikeError bila gagal (sama dengan `useAuth().signIn`). */
  signIn: (email: string, password: string) => Promise<void>;
}

const MSG: Record<Exclude<ForgotFailure, 'error'>, string> = {
  offline: 'Butuh koneksi internet untuk memeriksa password.',
  empty: 'Masukkan password akun.',
  wrong: 'Password salah.',
  rate_limited: 'Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.',
};

export async function verifyPasswordForReset(input: ForgotInput): Promise<ForgotResult> {
  const { email, password, online, signIn } = input;
  if (!email) return { ok: false, reason: 'error', message: 'Email akun tidak ditemukan.' };
  if (!password) return { ok: false, reason: 'empty', message: MSG.empty };
  if (!online) return { ok: false, reason: 'offline', message: MSG.offline };

  try {
    await signIn(email, password);
    return { ok: true };
  } catch (e) {
    const err = (e ?? {}) as AuthLikeError;
    // Gangguan jaringan di tengah jalan (navigator.onLine bisa berbohong)
    if (err.name === 'AuthRetryableFetchError' || err.status === 0 || e instanceof TypeError)
      return { ok: false, reason: 'offline', message: MSG.offline };
    if (err.status === 429 || err.code === 'over_request_rate_limit')
      return { ok: false, reason: 'rate_limited', message: MSG.rate_limited };
    if (err.status === 400 || err.code === 'invalid_credentials')
      return { ok: false, reason: 'wrong', message: MSG.wrong };
    return {
      ok: false,
      reason: 'error',
      message: err.message
        ? `Gagal memeriksa password: ${err.message}`
        : 'Gagal memeriksa password.',
    };
  }
}
