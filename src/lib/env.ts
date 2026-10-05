/**
 * Validasi environment variable saat start-up.
 * Jika ada yang kosong, aplikasi menampilkan layar "Konfigurasi belum lengkap"
 * alih-alih crash dengan error yang membingungkan.
 */
const REQUIRED = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_POWERSYNC_URL',
] as const;

type EnvKey = (typeof REQUIRED)[number];

export const missingEnv: EnvKey[] = REQUIRED.filter((key) => {
  const value = import.meta.env[key];
  return !value || value.includes('<');
});

export const isEnvReady = missingEnv.length === 0;

export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  powersyncUrl: import.meta.env.VITE_POWERSYNC_URL ?? '',
};
