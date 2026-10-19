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
  /** Opsional: tanpa ini fitur notifikasi pengingat dinonaktifkan */
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
  /**
   * Opsional: asal Worker music-taskify. Tanpa ini seluruh pintu masuk pemutar musik
   * disembunyikan — aplikasi tetap boot seperti biasa, sama seperti VITE_VAPID_PUBLIC_KEY.
   * Sengaja TIDAK masuk REQUIRED: musik fitur tambahan, bukan syarat Taskify bisa dipakai.
   */
  musicApiUrl: import.meta.env.VITE_MUSIC_API_URL ?? '',
  /**
   * Opsional: asal Worker ttdl-taskify (pengunduh TikTok). Tanpa ini kartu TikTok di /bagikan dan
   * item palet "Unduh TikTok" disembunyikan. Bukan rahasia: Worker hanya menerima Origin Taskify.
   */
  tiktokApiUrl: import.meta.env.VITE_TIKTOK_API_URL ?? '',
};
