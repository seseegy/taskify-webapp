/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_POWERSYNC_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_MUSIC_API_URL?: string;
  readonly VITE_TIKTOK_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
