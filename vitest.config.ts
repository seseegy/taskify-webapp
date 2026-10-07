import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Konfigurasi tes terpisah dari vite.config.ts (tanpa PWA/wasm/tailwind) supaya cepat.
 * Untuk logika murni (tanggal, recurrence, parser, CSV), query SQLite, dan migrasi Postgres
 * (PGlite). Tidak butuh DOM maupun server.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    // Zona waktu proses tes sengaja bukan WIB agar kode yang diam-diam bergantung pada
    // zona waktu perangkat ketahuan.
    env: { TZ: 'America/Los_Angeles' },
  },
});
