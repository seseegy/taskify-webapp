# Taskify

Aplikasi produktivitas pribadi — **Tugas, Jurnal, Keuangan, Kalender, Vault Kode, dan Sandi (password manager terenkripsi)** dalam satu PWA yang bisa dipakai **offline** di HP maupun laptop.

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS v4 · PowerSync (SQLite di browser) · Drizzle · Supabase (Auth + Postgres) · Cloudflare Workers (static assets) / R2

## Mulai

```bash
pnpm install
cp .env.example .env.local  # isi kredensial — lihat docs/SETUP.md
pnpm dev
```

Panduan setup lengkap (Supabase, PowerSync, deploy, install di Android, backup otomatis): **[docs/SETUP.md](docs/SETUP.md)**

## Perintah

| Perintah             | Fungsi                                                   |
| -------------------- | -------------------------------------------------------- |
| `pnpm dev`           | Server pengembangan                                      |
| `pnpm build`         | Build produksi + service worker PWA                      |
| `pnpm test`          | Tes (Vitest): logika murni, query SQLite, migrasi PGlite |
| `pnpm check`         | Typecheck + lint + format + kontras warna + tes          |
| `pnpm format`        | Rapikan kode (Prettier)                                  |
| `pnpm db:push`       | Terapkan migrasi ke Supabase (setelah `supabase link`)   |
| `pnpm db:new <nama>` | Buat file migrasi baru                                   |
| `pnpm pwa:icons`     | Generate ulang ikon PWA dari `public/favicon.svg`        |

## Dokumentasi

- [Arsitektur & konvensi data](docs/ARCHITECTURE.md) — alur offline-first, aturan skema, keamanan, peta jalan
- [Design system](docs/DESIGN.md) — tema gradasi, utility, warna modul
