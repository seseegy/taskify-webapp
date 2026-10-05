import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Jalankan `pnpm pwa:icons` setelah mengubah public/favicon.svg
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0.25,
      resizeOptions: { background: '#1e1b4b' },
    },
    apple: {
      ...minimal2023Preset.apple,
      padding: 0.2,
      resizeOptions: { background: '#1e1b4b' },
    },
  },
  images: ['public/favicon.svg'],
});
