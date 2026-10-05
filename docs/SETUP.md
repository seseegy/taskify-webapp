# Panduan Setup Taskify

Ikuti berurutan. Total ±30 menit. Semua layanan memakai **free tier**.

| Layanan          | Untuk apa                                                 |
| ---------------- | --------------------------------------------------------- |
| Supabase         | Auth (login), Postgres (sumber kebenaran data)            |
| PowerSync Cloud  | Sinkronisasi Postgres ↔ SQLite di browser (offline-first) |
| Cloudflare Pages | Hosting web app                                           |
| Cloudflare R2    | File zip/struk (tahap 6, belum perlu sekarang)            |

---

## 1. Prasyarat lokal

- Node.js 22+ (`.nvmrc`), pnpm 11+ (`corepack enable`)
- `pnpm install`

## 2. Supabase

### 2.1 Buat project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Region: **Southeast Asia (Singapore)** (paling dekat ke Indonesia).
3. Simpan **database password** di password manager.

### 2.2 Matikan pendaftaran publik

**Authentication → Sign In / Providers** → matikan **Allow new users to sign up**.
Taskify hanya untuk 1 akun; akunmu dibuat manual di langkah 2.5.

### 2.3 Jalankan migrasi

Pilih salah satu:

**A. Supabase CLI (disarankan)**

```bash
npx supabase login
npx supabase link --project-ref <project-ref>   # project-ref ada di URL dashboard
pnpm db:push
```

**B. Manual** — buka **SQL Editor**, jalankan isi file di `supabase/migrations/` **berurutan** (nama file = urutan).

Migrasi membuat: 16 tabel, RLS + grant, publication `powersync`, dan trigger data awal.

### 2.4 Buat role replikasi untuk PowerSync

Di **SQL Editor** (ganti password dengan hasil `openssl rand -base64 32`):

```sql
create role powersync_role with replication bypassrls login password 'GANTI_DENGAN_PASSWORD_ACAK';
grant select on all tables in schema public to powersync_role;
alter default privileges in schema public grant select on tables to powersync_role;
```

> Jangan pernah menghubungkan PowerSync sebagai user `postgres`.

### 2.5 Buat akunmu

**Authentication → Users → Add user → Create new user**: isi email & password, centang **Auto Confirm User**.

Trigger otomatis membuat pengaturan, dompet **Tunai** & **Bank**, dan 13 kategori default.
Cek di **Table Editor → wallets**. Jika kosong (akun dibuat sebelum migrasi), jalankan:

```sql
select public.seed_user_defaults('<uuid-user>');
```

### 2.6 Catat kredensial

**Project Settings → API Keys**: salin **Project URL** dan **Publishable key** (`sb_publishable_…`).

## 3. PowerSync Cloud

1. [dashboard.powersync.com](https://dashboard.powersync.com) → buat project → **Create instance** (region terdekat).
2. **Database connection**: ambil detail dari Supabase **Connect → Direct connection**.
   - Host `db.<project-ref>.supabase.co`, port `5432`, database `postgres`
   - Username **`powersync_role`**, password dari langkah 2.4
   - SSL mode: `verify-full`
   - Klik **Test connection** → **Save**.
3. **Client Auth**: centang **Use Supabase Auth**, biarkan JWT secret kosong (project Supabase baru memakai signing key asimetris). **Save and Deploy**.
   - Project lama dengan _Legacy JWT secret_: isi secret dari Supabase → Project Settings → JWT.
4. **Sync Streams**: tempel isi [`powersync/sync-config.yaml`](../powersync/sync-config.yaml) → **Validate** → **Deploy**.
5. Salin **Instance URL** (`https://<id>.powersync.journeyapps.com`).

## 4. Jalankan lokal

```bash
cp .env.example .env.local   # lalu isi 3 variabel
pnpm dev                     # http://localhost:5173
```

Login → status di sidebar berubah dari _Menghubungkan…_ → _Menyinkron…_ → **Tersinkron**.
Halaman Keuangan/Beranda memakai dompet hasil seed, jadi saldo `Rp 0` berarti sync berhasil.

## 5. Deploy ke Cloudflare Pages

1. Push repo ke GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pilih `taskify-webapp`.
3. Build settings:
   - Build command: `pnpm build`
   - Output directory: `dist`
   - Environment variables: 3 variabel `VITE_*` dari `.env.local`, plus `NODE_VERSION=22`
4. Setelah deploy, tambahkan URL `https://<nama>.pages.dev` ke Supabase **Authentication → URL Configuration** (Site URL & Redirect URLs).

Routing SPA otomatis ditangani Cloudflare Pages (tanpa `404.html` → fallback ke `index.html`).

## 6. Install di HP Android

Buka URL Pages di **Chrome** → menu ⋮ → **Install app** / **Tambahkan ke layar utama**.
Lalu di Taskify: **Pengaturan → Penyimpanan persisten → Aktifkan** dan, jika mau, **Aktifkan PIN**.

---

## Troubleshooting

| Gejala                                  | Penyebab & solusi                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Layar "Konfigurasi belum lengkap"       | `.env.local` belum diisi / server dev belum di-restart                               |
| Status macet di _Menyinkron…_           | Sync Streams belum di-deploy, atau publication `powersync` tidak ada (cek migrasi 3) |
| Error `PSYNC_S2101` di console          | Client Auth PowerSync belum dicentang _Use Supabase Auth_                            |
| Error `PSYNC_S2105` (aud)               | Tambahkan audience `authenticated` di Client Auth                                    |
| Upload gagal `42501 permission denied`  | Migrasi 2 (grant) belum dijalankan                                                   |
| Pengaturan menampilkan "Ditolak server" | Perubahan melanggar constraint; data tersimpan di tabel lokal `upload_errors`        |
| Login "Tidak bisa terhubung"            | Login pertama butuh internet; setelah itu aplikasi jalan offline                     |

## Perawatan rutin

- **Supabase free tier di-pause setelah 7 hari tanpa aktivitas.** Selama kamu memakai aplikasi, ini tidak terjadi. Workflow keep-alive + backup otomatis direncanakan di tahap 7.
- Menambah tabel tersinkron: buat migrasi baru (tabel + RLS + `alter publication powersync add table`), tambahkan query di `sync-config.yaml`, tambahkan tabel Drizzle di `src/db/schema.ts`.
