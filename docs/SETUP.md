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

## 7. Pengingat (notifikasi Web Push)

Alur: **pg_cron** (tiap menit) → Edge Function **`send-reminders`** → Web Push ke perangkatmu.

### 7.1 Jalankan migrasi baru

`pnpm db:push`, atau jalankan `supabase/migrations/20261006000100_reminders.sql` di SQL Editor.

### 7.2 Buat kunci VAPID

```bash
pnpm vapid:generate
```

Output-nya berisi 3 hal:

1. `VITE_VAPID_PUBLIC_KEY=…` → tambahkan ke `.env.local` **dan** ke environment variables Cloudflare Pages. Ini kunci publik, aman.
2. Perintah `supabase secrets set VAPID_KEYS_JSON=…`, `CRON_SECRET=…`, dan `VAPID_SUBJECT=…` → ini **rahasia**, jangan di-commit.
3. Nilai `CRON_SECRET` juga dipakai lagi di langkah 7.4.

### 7.3 Deploy Edge Function

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
# jalankan 3 perintah "secrets set" dari langkah 7.2
pnpm fn:deploy        # = supabase functions deploy send-reminders --no-verify-jwt
```

Kalau Docker tidak terpasang, tambahkan `--use-api`.
**Tanpa CLI:** di Dashboard buka **Edge Functions → Deploy a new function → Via Editor**, beri nama `send-reminders`, lalu tempel isi `supabase/functions/send-reminders/index.ts`. Setelah itu matikan **Verify JWT** di pengaturan fungsi, dan isi 3 secret di **Edge Functions → Secrets**.

### 7.4 Jadwalkan cron

Buka `supabase/sql/schedule-reminders.sql`, ganti `<project-ref>` dan `<CRON_SECRET…>`, lalu jalankan di **SQL Editor**.

### 7.5 Aktifkan di perangkat

1. Pakai versi yang sudah di-deploy (atau `pnpm build && pnpm preview`). Service worker **tidak aktif** di `pnpm dev`.
2. Di Android: **install** Taskify dulu dari Chrome (lihat langkah 6).
3. Buka **Pengaturan → Notifikasi pengingat → Aktifkan notifikasi**, lalu tekan **Kirim notifikasi uji**.
4. Buat tugas dengan jam dan pengingat "Saat jatuh tempo" sekitar 2 menit dari sekarang, lalu tunggu notifikasinya.

Cek kalau tidak muncul:

```sql
select * from cron.job_run_details order by start_time desc limit 5;          -- cron jalan?
select status_code, content from net._http_response order by id desc limit 5; -- respons fungsi
```

Log fungsi ada di **Edge Functions → send-reminders → Logs**.

> Kuota: cron tiap menit ≈ 43 ribu panggilan/bulan, masih jauh di bawah batas free tier (500 ribu). Pengingat yang terlambat lebih dari 24 jam (misalnya karena project ter-pause) tidak dikirim.

## 8. Vault & lampiran (Cloudflare R2)

Isi file (zip project, foto struk, gambar jurnal) disimpan di R2. Metadata di tabel `attachments`. Browser **tidak pernah** memegang key R2: Edge Function `files` membuat presigned URL berumur 10–15 menit.

### 8.1 Buat bucket

Cloudflare Dashboard → **R2 Object Storage** → **Create bucket**, beri nama mis. `taskify-files`, location _Automatic_. Biarkan **tidak publik**.

### 8.2 Atur CORS bucket

Bucket → **Settings → CORS policy → Add/Edit**, lalu tempel (ganti domain Pages-mu):

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:4173",
      "https://<nama>.pages.dev"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### 8.3 Buat API token R2

R2 → **Manage R2 API Tokens → Create API token**:

- Permission: **Object Read & Write**
- Specify bucket: hanya `taskify-files`

Catat **Access Key ID**, **Secret Access Key**, dan **Account ID** (ada di halaman R2 / URL dashboard).

### 8.4 Secret & deploy Edge Function

```bash
npx supabase secrets set R2_ACCOUNT_ID='<account-id>' R2_BUCKET='taskify-files' \
  R2_ACCESS_KEY_ID='<access-key-id>' R2_SECRET_ACCESS_KEY='<secret-access-key>'
pnpm fn:deploy:files     # = supabase functions deploy files --no-verify-jwt
```

`CRON_SECRET` dipakai bersama fungsi pengingat (§7), jadi tidak perlu dibuat lagi.
**Tanpa CLI:** buat fungsi `files` via Dashboard (tempel `supabase/functions/files/index.ts`), matikan **Verify JWT**, lalu isi 4 secret di atas.

### 8.5 Migrasi & jadwal pembersihan

1. Jalankan `supabase/migrations/20261007000100_attachments_cleanup.sql` (atau `pnpm db:push`).
2. Jalankan `supabase/sql/schedule-attachment-cleanup.sql` di SQL Editor. File ini memakai secret Vault dari §7.4.

Pembersihan harian menghapus objek R2 untuk lampiran yang:

- dihapus,
- gagal terunggah lebih dari 2 hari,
- induknya sudah di Sampah lebih dari 30 hari,

serta objek yatim yang tidak punya baris.

### 8.6 Coba

Vault → **Project** → buat project → tarik file zip. Isi zip dicek dulu (`.env`, `node_modules`, `.git`, hasil build, file duplikat). Setelah terunggah, **Lihat isi** menampilkan pohon folder & isi file. Di Keuangan, buka transaksi → **Foto struk**.

> Kuota gratis R2: 10 GB penyimpanan, unduhan (egress) gratis. Pemakaian tampil di halaman Vault.

---

## Troubleshooting

| Gejala                                   | Penyebab & solusi                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Layar "Konfigurasi belum lengkap"        | `.env.local` belum diisi / server dev belum di-restart                                 |
| Status macet di _Menyinkron…_            | Sync Streams belum di-deploy, atau publication `powersync` tidak ada (cek migrasi 3)   |
| Error `PSYNC_S2101` di console           | Client Auth PowerSync belum dicentang _Use Supabase Auth_                              |
| Error `PSYNC_S2105` (aud)                | Tambahkan audience `authenticated` di Client Auth                                      |
| Upload gagal `42501 permission denied`   | Migrasi 2 (grant) belum dijalankan                                                     |
| Pengaturan menampilkan "Ditolak server"  | Perubahan melanggar constraint; data tersimpan di tabel lokal `upload_errors`          |
| Login "Tidak bisa terhubung"             | Login pertama butuh internet; setelah itu aplikasi jalan offline                       |
| Notifikasi "Belum tersedia"              | Sedang di `pnpm dev`; service worker hanya aktif di build/deploy                       |
| Notifikasi uji "Edge Function gagal"     | Fungsi belum di-deploy, atau Verify JWT masih menyala                                  |
| Upload gagal "periksa koneksi atau CORS" | CORS bucket R2 belum diatur / domain belum masuk `AllowedOrigins` (§8.2)               |
| "Edge Function gagal" saat upload        | Fungsi `files` belum di-deploy, Verify JWT masih menyala, atau secret R2 salah         |
| Uji berhasil tapi pengingat tidak datang | Cron belum dijadwalkan (7.4), atau `CRON_SECRET` di Vault berbeda dengan secret fungsi |

## Perawatan rutin

- **Supabase free tier di-pause setelah 7 hari tanpa aktivitas.** Selama kamu memakai aplikasi, ini tidak terjadi. Workflow keep-alive + backup otomatis direncanakan di tahap 7.
- Menambah tabel tersinkron: buat migrasi baru (tabel + RLS + `alter publication powersync add table`), tambahkan query di `sync-config.yaml`, tambahkan tabel Drizzle di `src/db/schema.ts`.
