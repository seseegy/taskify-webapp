import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import wasm from 'vite-plugin-wasm';

import pkg from './package.json' with { type: 'json' };

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    wasm(),
    tailwindcss(),
    VitePWA({
      // "prompt": user ditanya dulu sebelum versi baru diaktifkan (lihat UpdatePrompt.tsx)
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Taskify',
        short_name: 'Taskify',
        description: 'Tugas, jurnal, keuangan, kalender, dan vault kode — dalam satu aplikasi.',
        lang: 'id',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1e1b4b',
        background_color: '#0f0c29',
        categories: ['productivity', 'finance', 'lifestyle'],
        // "Bagikan ke Taskify" dari aplikasi lain (Android/Chrome, PWA terpasang)
        share_target: {
          action: '/bagikan',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: [
                  'image/*',
                  'application/pdf',
                  'application/zip',
                  '.zip',
                  'text/*',
                  '.md',
                  '.json',
                  '.ts',
                  '.tsx',
                  '.js',
                  '.py',
                  '.sql',
                  '.sh',
                ],
              },
            ],
          },
        },
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // File WASM SQLite cukup besar, naikkan batas precache
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,woff2}'],
        globIgnores: [
          // mc-* = varian SQLCipher (enkripsi) yang tidak dipakai (±3,7 MB)
          '**/mc-wa-sqlite*',
          // Diunduh saat pertama dipakai, lalu disimpan (runtimeCaching di bawah), BUKAN saat
          // instal. Keduanya jarang dibutuhkan, dan dulu membuat instal pertama ±7,9 MB:
          //  - wa-sqlite-async*.wasm (±2,3 MB): hanya untuk fallback IndexedDB, bila OPFS tidak
          //    bisa dipakai. Browser modern memakai OPFS (wa-sqlite sinkron, tetap di-precache).
          //  - zxcvbn-*.js (±1,9 MB kamus): hanya untuk menilai master password Sandi (dimuat
          //    lazy, dan GAGAL TERTUTUP bila tidak bisa dimuat — lihat master-password.ts).
          '**/wa-sqlite-async*.wasm',
          '**/zxcvbn-*.js',
        ],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:wa-sqlite-async[^/]*\.wasm|zxcvbn-[^/]*\.js)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'taskify-lazy-assets',
              // Nama ber-hash: versi lama tidak pernah dipakai lagi, cukup batasi jumlahnya
              expiration: { maxEntries: 8 },
            },
          },
        ],
        navigateFallback: '/index.html',
        // Push, klik notifikasi & Share Target (public/sw-extra.js)
        importScripts: ['sw-extra.js'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  optimizeDeps: {
    // Paket ini berisi web worker & WASM, jangan di-prebundle
    // https://github.com/vitejs/vite/issues/11672#issuecomment-1415820673
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web'],
  },
  build: {
    target: 'es2023',
    // Jangan kirim source map ke produksi: nama file .map mudah ditebak dari nama bundle
    // (cukup tambah ".map"), jadi 'hidden' pun tetap membocorkan kode sumber.
    // Untuk menelusuri bug di build produksi: `vite build --sourcemap`.
    sourcemap: false,
    // Bundle utama berisi React + PowerSync + Supabase (≈245 KB gzip) — wajar untuk PWA offline
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Kamus zxcvbn (Sandi) jadi satu chunk bernama pasti, supaya bisa dikecualikan dari
          // precache (globIgnores di atas). Tanpa ini namanya generik (`dist-*.js`).
          groups: [{ name: 'zxcvbn', test: /[\\/]@zxcvbn-ts[\\/]/ }],
        },
      },
    },
  },
});
