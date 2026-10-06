# Taskify

Aplikasi produktivitas pribadi — **Tugas, Jurnal, Keuangan, Kalender, dan Vault Kode** dalam satu PWA yang bisa dipakai **offline** di HP maupun laptop.

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS v4 · PowerSync (SQLite di browser) · Drizzle · Supabase (Auth + Postgres) · Cloudflare Pages/R2

## Mulai

```bash
pnpm install
cp .env.example .env.local   # isi kredensial — lihat docs/SETUP.md
pnpm dev
```

Panduan setup lengkap (Supabase, PowerSync, deploy, install di Android, backup otomatis): **[docs/SETUP.md](docs/SETUP.md)**

## Perintah

| Perintah             | Fungsi                                                 |
| -------------------- | ------------------------------------------------------ |
| `pnpm dev`           | Server pengembangan                                    |
| `pnpm build`         | Build produksi + service worker PWA                    |
| `pnpm check`         | Typecheck + lint + format check                        |
| `pnpm format`        | Rapikan kode (Prettier)                                |
| `pnpm db:push`       | Terapkan migrasi ke Supabase (setelah `supabase link`) |
| `pnpm db:new <nama>` | Buat file migrasi baru                                 |
| `pnpm pwa:icons`     | Generate ulang ikon PWA dari `public/favicon.svg`      |

## Dokumentasi

- [Arsitektur & konvensi data](docs/ARCHITECTURE.md) — alur offline-first, aturan skema, keamanan, peta jalan
- [Design system](docs/DESIGN.md) — tema gradasi, utility, warna modul
