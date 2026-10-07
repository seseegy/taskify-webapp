import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Konfigurasi tes terpisah dari vite.config.ts (tanpa PWA/wasm/tailwind) supaya cepat.
 * Hanya untuk logika murni (tanggal, recurrence, parser, CSV) yang tidak butuh DOM atau database.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Zona waktu proses tes sengaja bukan WIB agar kode yang diam-diam bergantung pada
    // zona waktu perangkat ketahuan.
    env: { TZ: 'America/Los_Angeles' },
  },
});
