import { createClient } from '@supabase/supabase-js';
import { env, isEnvReady } from './env';

/**
 * Satu-satunya instance Supabase client di aplikasi.
 * Dipakai untuk: auth, upload perubahan PowerSync, dan memanggil Edge Functions.
 * Membaca data TIDAK lewat sini — semua baca dari SQLite lokal (PowerSync).
 */
export const supabase = createClient(
  isEnvReady ? env.supabaseUrl : 'http://localhost',
  isEnvReady ? env.supabaseKey : 'missing-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'taskify-auth',
    },
  },
);
