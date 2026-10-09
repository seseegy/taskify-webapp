# Panduan Setup Taskify

Ikuti berurutan. Total ±30 menit. Semua layanan memakai **free tier**.

| Layanan            | Untuk apa                                                 |
| ------------------ | --------------------------------------------------------- |
| Supabase           | Auth (login), Postgres (sumber kebenaran data)            |
| PowerSync Cloud    | Sinkronisasi Postgres ↔ SQLite di browser (offline-first) |
| Cloudflare Workers | Hosting web app (static assets)                           |
| Cloudflare R2      | File zip/struk (tahap 6, belum perlu sekarang)            |

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

### 2.4 Role replikasi untuk PowerSync

Ada dua kemungkinan, tergantung cara instance PowerSync dibuat:

**A. Integrasi Supabase (umum).** Supabase sudah membuat sendiri role bernama `powersync_<hash>`.
Jangan buat role baru. Lewati ke langkah 2.5, lalu pastikan role itu bisa membaca tabel yang
dibuat migrasi (lihat **2.4b**).

**B. Manual.** Di **SQL Editor** (ganti password dengan hasil `openssl rand -base64 32`):

```sql
create role powersync_role with replication bypassrls login password 'GANTI_DENGAN_PASSWORD_ACAK';
```

> Jangan pernah menghubungkan PowerSync sebagai user `postgres`.

### 2.4b Beri hak baca (WAJIB, juga setiap kali ada tabel baru)

`grant ... on all tables` hanya berlaku untuk tabel yang **sudah ada** saat dijalankan. Setiap
migrasi yang menambah tabel (mis. `pw_keys` & `pw_items` dari modul Sandi) harus diikuti perintah
ini, kalau tidak Validate di PowerSync gagal dengan `permission denied for table …` dan
`This table could not be found in the source schema`.

Perintah di bawah mencari nama role-nya otomatis, jadi cocok untuk opsi A maupun B:

```sql
do $$
declare r text;
begin
  for r in select rolname from pg_roles where rolname like 'powersync%' loop
    execute format('grant select on all tables in schema public to %I', r);
    -- supaya tabel baru buatan migrasi berikutnya otomatis bisa dibaca
    execute format(
      'alter default privileges for role postgres in schema public grant select on tables to %I', r);
  end loop;
end $$;
```

Periksa hasilnya (tabel yang dicek harus muncul dengan grantee `powersync…`):

```sql
select table_name, grantee from information_schema.role_table_grants
where table_name in ('tasks', 'pw_keys') and privilege_type = 'SELECT'
order by table_name, grantee;
```

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
   - Username: role dari langkah 2.4 (`powersync_<hash>` atau `powersync_role`), beserta passwordnya
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

## 5. Deploy ke Cloudflare Workers

1. Push repo ke GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Workers → Connect to Git** → pilih `taskify-webapp`.
3. Build configuration:
   - Build command: `pnpm build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
   - Environment variables: semua variabel `VITE_*` yang kamu pakai dari `.env.local` (3 wajib + yang opsional), plus `NODE_VERSION=22`
4. Setelah deploy, tambahkan URL `https://<nama>.<subdomain>.workers.dev` ke:
   - Supabase **Authentication → URL Configuration** (Site URL & Redirect URLs)
   - **CORS policy** bucket `taskify-files` (§8.2) — tanpa ini upload Vault gagal di produksi

Konfigurasi deploy ada di [`wrangler.jsonc`](../wrangler.jsonc): isi `dist/` disajikan sebagai
static assets, dan `not_found_handling: "single-page-application"` membuat rute `/tugas`,
`/keuangan`, dan lainnya tetap bekerja saat dibuka langsung (ditangani react-router di klien).

> `pnpm-workspace.yaml` memuat `allowBuilds` untuk `esbuild` & `workerd` — pnpm 11 memblokir
> build script dependensi secara default, dan wrangler membutuhkan keduanya. Tanpa itu, deploy
> gagal dengan `ERR_PNPM_IGNORED_BUILDS`.

### Header keamanan

[`public/_headers`](../public/_headers) ikut ter-deploy dan memasang CSP, `X-Frame-Options`,
`Referrer-Policy`, dan `Permissions-Policy`. Setelah deploy pertama, buka DevTools → Console dan
pastikan tidak ada pesan _"Refused to …"_ dari CSP.

CSP memuat hash SHA-256 dari skrip inline anti-kedip tema di `index.html`. **Kalau skrip itu
diubah, hash harus dihitung ulang** (gejalanya ringan: tema berkedip sekali saat dibuka):

```bash
pnpm build
node -e "const fs=require('fs'),c=require('crypto');const s=/<script>([\s\S]*?)<\/script>/.exec(fs.readFileSync('dist/index.html','utf8'))[1];console.log('sha256-'+c.createHash('sha256').update(s).digest('base64'))"
```

Tempel hasilnya ke `script-src` di `public/_headers`.

## 6. Install di HP Android

Buka URL aplikasi di **Chrome** → menu ⋮ → **Install app** / **Tambahkan ke layar utama**.
Lalu di Taskify: **Pengaturan → Penyimpanan persisten → Aktifkan** dan, jika mau, **Aktifkan PIN**.

## 7. Pengingat (notifikasi Web Push)

Alur: **pg_cron** (tiap menit) → Edge Function **`send-reminders`** → Web Push ke perangkatmu.

### 7.1 Jalankan migrasi baru

`pnpm db:push`, atau jalankan `supabase/migrations/20261006000100_reminders.sql` di SQL Editor.

> **Memperbarui instalasi yang sudah berjalan** (migrasi `20261008000100_reminder_retry.sql`, pengingat dicoba ulang jika push gagal): deploy fungsi **dulu** (`pnpm fn:deploy`), baru `pnpm db:push`. Fungsi baru aman di atas skema lama; kebalikannya mengirim ulang pengingat karena fungsi lama tidak menandai terkirim. Urutan ini hanya dijaga dokumentasi (tidak ada CI yang menerapkan migrasi), jadi jangan dibalik. Migrasi `20261008000200_attachments_received_at.sql` (pembersihan lampiran memakai waktu server) tidak bergantung pada urutan; fungsi `files` juga perlu di-deploy ulang (`pnpm fn:deploy:files`) untuk penelusuran bucket berhalaman.

### 7.2 Buat kunci VAPID

```bash
pnpm vapid:generate
```

Output-nya berisi 3 hal:

1. `VITE_VAPID_PUBLIC_KEY=…` → tambahkan ke `.env.local` **dan** ke environment variables Cloudflare Workers. Ini kunci publik, aman.
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

> Kuota: cron tiap menit ≈ 43 ribu panggilan/bulan, masih jauh di bawah batas free tier (500 ribu). Pengingat yang terlambat lebih dari 24 jam (misalnya karena project ter-pause) tidak dikirim. Jika push gagal sesaat, pengingat dicoba lagi tiap 3 menit (maks. 5 kali).

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
      "https://<nama>.<subdomain>.workers.dev"
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

## 9. Backup & keep-alive (GitHub Actions)

Dua workflow di `.github/workflows/`:

| Workflow        | Jadwal                         | Fungsi                                                                                     |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `keepalive.yml` | tiap 2 hari, 01:17 UTC         | Query ringan ke Postgres supaya project free tier tidak di-pause                           |
| `backup.yml`    | Senin 02:00 WIB (Minggu 19:00) | `pg_dump` skema `public` + data `auth.users`, enkripsi, unggah ke R2 (`scripts/backup.sh`) |

Backup **tidak** menyertakan isi file R2 (zip, foto). Itu sudah tersimpan di R2 sendiri. Yang di-backup adalah semua data aplikasi, termasuk metadata lampiran.

### 9.1 Bucket & token khusus backup

Pisahkan dari bucket aplikasi, supaya token aplikasi yang bocor tidak bisa menghapus backup, dan sebaliknya.

1. R2 → **Create bucket** → mis. `taskify-backups` (tidak publik, CORS tidak perlu).
2. **Manage R2 API Tokens → Create API token** → _Object Read & Write_, hanya bucket `taskify-backups`. Catat Access Key ID & Secret.

### 9.2 Connection string database

Supabase Dashboard → **Connect** → **Session pooler** (IPv4; runner GitHub tidak mendukung IPv6, jadi koneksi _Direct_ tidak bisa). Bentuknya:

```
postgresql://postgres.<ref>:<password-db>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Pakai port **5432** (session), bukan 6543 (transaction), karena `pg_dump` butuh mode session.

### 9.3 Passphrase enkripsi

Backup berisi jurnal & data keuangan, jadi **selalu isi passphrase**. Buat yang kuat, lalu simpan di password manager. Tanpa passphrase ini, backup tidak bisa dibuka.

```bash
openssl rand -base64 32
```

### 9.4 Isi GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret                        | Isi                                    |
| ----------------------------- | -------------------------------------- |
| `SUPABASE_DB_URL`             | connection string §9.2                 |
| `R2_ACCOUNT_ID`               | Account ID Cloudflare (sama dengan §8) |
| `R2_BACKUP_BUCKET`            | `taskify-backups`                      |
| `R2_BACKUP_ACCESS_KEY_ID`     | Access Key ID token §9.1               |
| `R2_BACKUP_SECRET_ACCESS_KEY` | Secret Access Key token §9.1           |
| `BACKUP_PASSPHRASE`           | passphrase §9.3                        |

Lalu **Actions → Backup database → Run workflow** sekali untuk mencoba, dan cek ada file `backups/taskify-<waktu>.tar.gz.enc` di bucket. Lakukan hal yang sama untuk **Keep-alive Supabase**. Hanya 12 arsip terbaru yang disimpan (±3 bulan).

> GitHub menonaktifkan workflow terjadwal di repo yang tidak ada commit selama 60 hari. Kamu akan dapat email peringatan; cukup klik **Enable workflow** di tab Actions.

### 9.5 Restore

Unduh arsip dari R2, lalu:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in taskify-XXXX.tar.gz.enc -out backup.tar.gz
tar -xzf backup.tar.gz          # → public.dump, auth_users.dump, manifest.txt
```

Ke **project Supabase baru** (atau yang sudah dikosongkan):

1. Jalankan semua migrasi (§2.3). Ini membuat tabel, RLS, grant, dan publication PowerSync.
2. Ubah dump jadi SQL berisi data saja, lalu muat dengan trigger dimatikan (supaya trigger seed user baru tidak membuat kategori dobel):

   ```bash
   pg_restore --data-only --no-owner -f auth.sql auth_users.dump
   pg_restore --data-only --no-owner -f public.sql public.dump
   psql "$SUPABASE_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
     -c 'SET session_replication_role = replica' -f auth.sql -f public.sql
   ```

3. Ulangi §2.4 (role PowerSync), §7.4 & §8.5 (jadwal cron & secret Vault), lalu arahkan PowerSync & `.env` ke project baru.

Pakai `pg_restore`/`psql` versi 17 (sama dengan versi saat backup, lihat `manifest.txt`).

### 9.6 Ekspor manual

Selain backup otomatis, **Pengaturan → Data, tag & Sampah → Ekspor semua data (JSON)** mengunduh semua tabel dari database lokal perangkat. Ini juga bekerja offline.

---

## 10. Sandi (password manager)

Tidak butuh layanan baru, tetapi **dua langkah deploy wajib** supaya sinkron antar-perangkat jalan:

1. `pnpm db:push`: menerapkan migrasi `20261009000100_sandi.sql` (tabel `pw_keys` dan `pw_items`, RLS, publication).
2. **PowerSync Dashboard → Sync Streams**: tempel ulang isi [`powersync/sync-config.yaml`](../powersync/sync-config.yaml) → **Validate** → **Deploy**. Perubahan file ini **tidak** ikut otomatis; tanpa langkah ini tabel Sandi tidak tersinkron ke perangkat lain.

Lalu buka **Sandi** di aplikasi: wizard 3 langkah meminta master password dan menampilkan kunci pemulihan **sekali**. Simpan kunci itu di tempat terpisah (dicetak atau di pengelola sandi lain). Brankas pertama harus dibuat saat online dan setelah sinkron pertama selesai.

> **Penting:** lupa master password **dan** kunci pemulihan berarti data tidak bisa dipulihkan siapa pun, termasuk Anda dan pemilik Supabase. Backup mingguan (§9) hanya berisi data terenkripsi, jadi tidak membantu bila keduanya hilang.

## 11. Pemutar musik (opsional)

Pemutar musik memakai Worker terpisah, [`seseegy/music-taskify`](https://github.com/seseegy/music-taskify).
Deploy Worker-nya ada di repo itu (`docs/DEPLOY.md`); yang perlu dilakukan **di sini** hanya satu baris:

```bash
# .env.local — dan environment variables Cloudflare Workers (§5)
VITE_MUSIC_API_URL=https://music-taskify.<subdomain>.workers.dev
```

Tanpa garis miring di akhir. Ini **opsional**, seperti `VITE_VAPID_PUBLIC_KEY`: kalau dikosongkan,
aplikasi tetap boot normal dan seluruh pintu masuk musik disembunyikan — tidak ada tombol yang
menggantung dan tidak ada permintaan yang dikirim.

Ini hanya URL, **bukan rahasia.** Autentikasinya memakai JWT sesi Supabase pengguna yang sudah ada,
jadi tidak ada token yang perlu dibundel ke browser. Di sisi Worker, `sub` pengguna harus terdaftar
di `ALLOWED_USER_IDS` — login saja tidak cukup. Rancangan lengkapnya ada di
[`RANCANGAN-MUSIK.md`](RANCANGAN-MUSIK.md).

Dua hal yang perlu diketahui sebelum menyalahkan kode pemutarnya:

- **Audio tidak bisa digeser posisinya.** CDN konverter tidak melayani `Range`, jadi hanya
  putar/jeda/pindah lagu. Bukan fitur yang belum dibuat.
- **Lagu pertama butuh 12–28 detik.** Lagu berikutnya terasa seketika karena disiapkan di latar
  belakang selagi yang sekarang berbunyi.

Dan `media-src` di [`public/_headers`](../public/_headers) sudah mengizinkan host audionya. Kalau
pemutar terasa "jalan tapi bisu", periksa direktif itu lebih dulu — CSP memblokir audio **tanpa**
pesan error yang jelas di UI.

## Troubleshooting

| Gejala                                   | Penyebab & solusi                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Layar "Konfigurasi belum lengkap"        | `.env.local` belum diisi / server dev belum di-restart                                                             |
| Pintu masuk musik tidak ada di palette   | `VITE_MUSIC_API_URL` kosong (§11), atau server dev belum di-restart                                                |
| Musik "jalan tapi bisu"                  | `media-src` di `public/_headers` — periksa Console untuk pesan _"Refused to load media"_                           |
| Sandi tidak muncul di perangkat lain     | `sync-config.yaml` belum di-deploy ulang di PowerSync Dashboard (§10), atau migrasi `…_sandi.sql` belum diterapkan |
| Status macet di _Menyinkron…_            | Sync Streams belum di-deploy, atau publication `powersync` tidak ada (cek migrasi 3)                               |
| Error `PSYNC_S2101` di console           | Client Auth PowerSync belum dicentang _Use Supabase Auth_                                                          |
| Error `PSYNC_S2105` (aud)                | Tambahkan audience `authenticated` di Client Auth                                                                  |
| Upload gagal `42501 permission denied`   | Migrasi 2 (grant) belum dijalankan                                                                                 |
| Pengaturan menampilkan "Ditolak server"  | Perubahan melanggar constraint; data tersimpan di tabel lokal `upload_errors`                                      |
| Login "Tidak bisa terhubung"             | Login pertama butuh internet; setelah itu aplikasi jalan offline                                                   |
| Notifikasi "Belum tersedia"              | Sedang di `pnpm dev`; service worker hanya aktif di build/deploy                                                   |
| Notifikasi uji "Edge Function gagal"     | Fungsi belum di-deploy, atau Verify JWT masih menyala                                                              |
| Upload gagal "periksa koneksi atau CORS" | CORS bucket R2 belum diatur / domain belum masuk `AllowedOrigins` (§8.2)                                           |
| "Edge Function gagal" saat upload        | Fungsi `files` belum di-deploy, Verify JWT masih menyala, atau secret R2 salah                                     |
| Uji berhasil tapi pengingat tidak datang | Cron belum dijadwalkan (7.4), atau `CRON_SECRET` di Vault berbeda dengan secret fungsi                             |
| Backup gagal "Network is unreachable"    | `SUPABASE_DB_URL` memakai koneksi Direct (IPv6); ganti ke Session pooler (§9.2)                                    |
| Backup gagal "server version mismatch"   | Versi Postgres Supabase lebih baru dari 17; naikkan image `postgres:` di `backup.yml`                              |
| "Bagikan" tidak menampilkan Taskify      | Share Target hanya untuk PWA yang ter-install via Chrome Android (§6)                                              |

## Perawatan rutin

- **Supabase free tier di-pause setelah 7 hari tanpa aktivitas.** Workflow keep-alive (§9) mencegahnya. Cek tab Actions sesekali; workflow yang gagal mengirim email.
- **Uji restore** sesekali (mis. tiap 3 bulan) ke project percobaan. Backup yang belum pernah di-restore belum terbukti.
- Menambah tabel tersinkron: buat migrasi baru (tabel + RLS + `alter publication powersync add table`), tambahkan query di `sync-config.yaml`, tambahkan tabel Drizzle di `src/db/schema.ts`.
