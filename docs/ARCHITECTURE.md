# Arsitektur Taskify

## Gambaran besar

```
┌──────────────── Browser / PWA ────────────────┐
│  React UI ──► Drizzle / useQuery (reaktif)    │
│                    │  baca & tulis LOKAL       │
│              SQLite (wa-sqlite, OPFS/IDB)      │
│                    │  antrean upload (CRUD)    │
│              PowerSync Web SDK                 │
└───────┬─────────────────────────────┬──────────┘
        │ unduh (stream)              │ unggah (supabase-js)
        ▼                             ▼
  PowerSync Service  ◄── replikasi ── Supabase Postgres (RLS)
                                      Supabase Auth (JWT)
                                      Edge Functions ──► Cloudflare R2 (tahap 6)
```

- **Semua baca dari SQLite lokal.** UI tidak pernah menunggu jaringan.
- **Semua tulis ke SQLite lokal** → PowerSync menaruhnya di antrean → `SupabaseConnector.uploadData` mengirim ke Postgres saat online.
- **Postgres = sumber kebenaran.** PowerSync menyalurkan perubahan kembali ke semua perangkat (HP & laptop).

## Struktur folder

```
src/
  app/            App (urutan gerbang), router, daftar navigasi
  components/
    layout/       AppShell, Logo, SyncStatus, SplashScreen, UpdatePrompt, …
    ui/           Button, Card, Input, Badge, SegmentedControl, EmptyState
  db/
    schema.ts     Tabel Drizzle + AppSchema PowerSync (satu sumber untuk client)
    database.ts   Membuka SQLite (pemilihan VFS), wrapper Drizzle
    connector.ts  fetchCredentials + uploadData ke Supabase
    mutations.ts  withMeta / touch / softDeleted / restored
  features/<modul>/  Halaman, hook query, komponen khusus modul
  lib/            env, supabase client, tanggal WIB, uang IDR, id
  styles/         Design system (lihat DESIGN.md)
supabase/migrations/   Skema Postgres, RLS, publication, seed, pengingat
supabase/functions/    Edge Function send-reminders (Deno)
supabase/sql/          SQL manual berisi secret (jadwal cron)
scripts/               generate-vapid-keys.mjs
powersync/sync-config.yaml   Sync Streams
```

Aturan: kode khusus modul tinggal di `features/<modul>`. Yang dipakai ≥2 modul naik ke `components/` atau `lib/`.

## Urutan gerbang (App.tsx)

`ThemeProvider → env lengkap? → AuthProvider → login? → PowerSyncProvider → LockGate → Router`

- DB lokal baru dibuka setelah login (sync butuh JWT).
- Sesi Supabase disimpan di localStorage, jadi aplikasi tetap terbuka saat offline.
- Logout memanggil `disconnectAndClear()` (hapus data lokal) dan memperingatkan jika masih ada perubahan yang belum terunggah.

## Konvensi data

| Aturan                                                       | Alasan                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `id` UUIDv7 dibuat di client (`newId()`)                     | Bisa membuat data saat offline; bisa diurutkan                       |
| `user_id` di setiap tabel                                    | RLS & filter Sync Streams                                            |
| Soft delete via `deleted_at`                                 | Fitur Sampah/pemulihan. **Setiap query wajib `deleted_at IS NULL`**  |
| Uang = integer rupiah                                        | Float menyebabkan error pembulatan                                   |
| Tanggal tanpa jam = `date` (`'YYYY-MM-DD'`)                  | Tidak bergeser zona waktu; gunakan `todayLocal()`/`parseLocalDate()` |
| Timestamp = `timestamptz` ISO UTC                            | Konversi ke WIB di SQLite: `date(created_at, '+7 hours')`            |
| Enum = `text` + `CHECK`                                      | Lebih aman untuk replikasi daripada tipe enum                        |
| Hindari `UNIQUE` di data yang bisa diedit                    | Pelanggaran saat upload membuang perubahan offline                   |
| Hapus keras dompet yang punya transaksi ditolak (`RESTRICT`) | Melindungi riwayat keuangan                                          |
| Boolean = `0/1` di SQLite                                    | Pakai `toBool()` / `fromBool()`                                      |

Menambah kolom/tabel = ubah **tiga tempat**: migrasi Supabase, `sync-config.yaml`, `src/db/schema.ts`.

## Penanganan error upload

`connector.ts` membedakan:

- **Sementara** (jaringan, 5xx): dilempar ulang → PowerSync retry dengan backoff.
- **Permanen** (`22xxx`, `23xxx`, `42501`): sisa operasi disimpan ke tabel lokal `upload_errors` (tidak disinkron), lalu antrean dilanjutkan supaya tidak macet. Jumlahnya tampil di Pengaturan.

PUT berurutan pada tabel yang sama digabung menjadi satu `upsert` massal.

## Kalender sebagai pusat

`features/calendar/useCalendarActivity.ts` menjalankan satu query `UNION ALL` atas tugas, jurnal, transaksi, dan vault untuk rentang tanggal, lalu mengelompokkannya per hari. Query ini reaktif: modul baru cukup menambahkan cabang `UNION ALL` agar otomatis muncul di Kalender & Beranda.

## Tugas berulang (model bergulir)

- `tasks.rrule` berisi RRULE (RFC 5545) dengan BY* eksplisit, misalnya `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH`. Lihat `features/tasks/recurrence.ts`.
- Dalam satu seri (`series_id`) hanya **satu baris aktif** yang membawa `rrule`.
- Saat dicentang: baris itu menjadi riwayat (`done`, `rrule = null`), lalu baris baru dibuat untuk kejadian berikutnya. Subtask ikut disalin dalam keadaan belum selesai, dan `remind_at` digeser sejumlah hari yang sama. Kalau tugas sudah lama terlambat, kejadian berikutnya melompat ke mulai hari ini.
- Kejadian masa depan di Kalender bersifat **virtual** (dihitung dari rrule, tidak disimpan) dan ditandai ikon 🔁.
- Semua operasi multi-baris dibungkus transaksi, dan bisa **Diurungkan** lewat toast.

## Pengingat

```
tasks.remind_at (UTC) ──► pg_cron tiap menit ──► Edge Function send-reminders
                                                   ├─ claim_due_reminders()  (klaim atomik, log (task_id, remind_at))
                                                   └─ Web Push (VAPID, aes128gcm) ──► push_subscriptions
```

- `push_subscriptions` dan `task_reminder_log` **tidak disinkron** PowerSync. Langganan push ditulis langsung lewat supabase-js (mengaktifkan notifikasi memang butuh online), sedangkan log hanya diakses server.
- Mengubah `remind_at` menghasilkan kunci log baru, jadi pengingat baru tetap terkirim, tanpa ada yang terkirim dobel.
- Langganan yang kedaluwarsa (404/410) otomatis dihapus.
- Service worker (Workbox) memuat `public/sw-extra.js` (push, klik notifikasi, Share Target). Klik notifikasi membuka `/tugas?task=<id>`, dan `AppShell` membuka panel detail tugas itu.

## Keuangan

- Saldo dompet = saldo awal + pemasukan − pengeluaran − transfer keluar + transfer masuk (dihitung di SQL, tidak disimpan).
- **Statistik** (ringkasan, per kategori, anggaran, Beranda) mengabaikan transfer dan transaksi hutang/piutang (`debt_id` terisi), karena keduanya perpindahan uang, bukan belanja atau pendapatan. Saldo tetap menghitung semuanya.
- Dompet yang sudah punya transaksi hanya bisa **diarsipkan**, tidak dihapus. Kategori yang dihapus tetap tampil namanya di riwayat.
- **Transaksi berulang** (`recurring_transactions`): `next_run_on` menunjuk kejadian yang belum dicatat.
  - `auto_post = 1`: dicatat otomatis oleh `useRecurringProcessor` (AppShell) setelah sync pertama selesai.
  - `auto_post = 0`: muncul di kartu "Jatuh tempo" dengan tombol Catat/Lewati.
  - ID transaksi hasil seri = UUID deterministik dari `recurring_id + tanggal`, jadi dua perangkat yang memproses saat offline tidak menghasilkan transaksi dobel.
- **Hutang/piutang**: perpindahan uang ke/dari dompet bersifat opsional, dan transaksinya juga ber-ID deterministik (`debt-open`, `debt-settle`) sehingga "Batal lunas" dan hapus bisa tepat sasaran.
- Ekspor CSV memakai pemisah `;` + BOM UTF-8 (cocok untuk Excel Indonesia).

## Jurnal

- Satu tanggal boleh punya beberapa catatan. Isi berupa Markdown (GFM). HTML mentah tidak dirender, jadi aman dari XSS.
- **Simpan otomatis**: teks disimpan 0,7 detik setelah berhenti mengetik, sedangkan mood/tanggal/pin langsung. Draf baru baru dibuat di DB saat ada isi pertama, jadi tidak ada catatan kosong. Perubahan tertunda disimpan saat editor ditutup.
- Selama mengedit, state lokal editor adalah sumber kebenaran. Draf yang baru tersimpan tetap memakai komponen yang sama (kursor tidak hilang).
- URL: `?entri=<id>`, `?baru=<tanggal>` (selalu draf baru), `?tanggal=<tanggal>` (catatan terakhir di tanggal itu atau draf).
- Mood 1–5 ditampilkan dengan ikon (bukan emoji) supaya konsisten di semua perangkat. Kalender menampilkan rata-rata mood per hari.
- "Hari ini di masa lalu" = tanggal & bulan yang sama di tahun sebelumnya, plus tepat 1 bulan lalu. Streak tidak putus sebelum kamu sempat menulis hari ini.
- Ekspor: satu file Markdown berisi semua catatan.

## Pencarian, catat cepat, tag & tautan

- **Pencarian global** memakai SQLite **FTS5** lokal (`db/search-index.ts`). Trigger pada tabel internal PowerSync `ps_data__<tabel>` memperbarui `search_index` untuk setiap perubahan, baik lokal maupun hasil sync. Item di Sampah dikeluarkan dari indeks. Naikkan `INDEX_VERSION` untuk membangun ulang. Tanpa FTS5, otomatis memakai LIKE.
- **Command palette** (Ctrl/⌘+K, `/`, atau tombol cari) menggabungkan hasil pencarian, tag, perintah, dan **catat cepat** (`features/capture/parse-capture.ts`):
  - Ada nominal (`25rb`, `Rp 50.000`, `+5jt`) → transaksi. Masuk jika diawali `+` atau ada kata seperti gaji/bonus. Kategori ditebak dari kata kunci; `kemarin` mengatur tanggal.
  - Awalan `j:` → jurnal. Selain itu → tugas (memakai parser input cepat tugas).
  - `#tag` dikenali di semua jenis. Tab mengganti jenis simpan.
  - Catat cepat didahulukan hanya jika ada sinyal jelas (nominal, waktu, prioritas, tag, `j:`). Teks biasa menampilkan hasil pencarian dulu.
- **Tag** (`tags`/`taggings`): nama dinormalisasi (huruf kecil, `-`); keunikan dijaga di aplikasi, bukan constraint DB. Halaman `/tag/:id` menampilkan item lintas modul.
- **Tautan** (`entity_links`) ditampilkan dua arah. "Catat sebagai transaksi" dari tugas membuat transaksi yang tertaut (dan mengisi `task_id`).
- **Sampah** (`/sampah`) menggabungkan tugas, jurnal, dan transaksi. Item lebih dari 30 hari dihapus permanen otomatis setelah sync awal. Hapus permanen juga membersihkan tag & tautan (`db/refs.ts`), karena keduanya tidak punya foreign key.
- `Sheet` memfokuskan elemen ber-`data-autofocus` setelah `showModal()` (yang jika tidak akan memfokuskan tombol Tutup).

## Vault & lampiran (R2)

```
Browser ── (1) INSERT attachments (pending) ──► SQLite lokal ──sync──► Postgres
   │  (2) presign {key, size} ──► Edge Function files (cek JWT, key berawalan user_id/, ≤ 100 MB)
   │  (3) PUT langsung ke R2 (Content-Length ikut ditandatangani)
   └─ (4) UPDATE status = 'uploaded' + simpan ke Cache Storage (bisa dibuka offline)
```

- Key R2 = `<user_id>/<attachment_id>/<nama file>`. Fungsi menolak key milik user lain.
- Unduh/pratinjau: cache lokal dulu, baru presigned GET. Isi zip dibaca di browser (JSZip) tanpa ekstrak ke disk.
- Sebelum upload, zip dianalisis (`features/vault/zip.ts`): file rahasia, node_modules, .git, hasil build. Duplikat dideteksi lewat SHA-256.
- Hapus = soft delete lokal + hapus objek (best effort). Cron harian (`files` mode cleanup) membersihkan sisanya, termasuk objek yatim.
- Snippet: syntax highlight (prism-react-renderer + bahasa prismjs tambahan, dimuat lazy), variabel template `{{nama}}` diisi saat disalin.
- Foto besar (>1,5 MB) diperkecil ke maks. 2000 px JPEG sebelum diunggah.

## Review & heatmap

- `/review?periode=minggu|bulan&tanggal=<tanggal>` (desktop: menu samping; HP: tautan dari Beranda). Minggu = Senin–Minggu WIB.
- Statistik (`features/review/review-queries.ts`) dihitung langsung dengan SQL dari SQLite lokal, jadi tidak perlu tabel ringkasan: tugas selesai/terlambat, hari menulis jurnal & rata-rata mood, pemasukan/pengeluaran + kategori terbesar, item vault baru. Setiap angka dibandingkan dengan periode sebelumnya.
- **Tulis refleksi** membuka draf jurnal (`?baru=…&templat=review-minggu|bulan`) berisi ringkasan angka + pertanyaan. Draf baru tersimpan setelah diedit, mengikuti aturan simpan otomatis jurnal.
- Heatmap = jumlah per hari dari tugas selesai + catatan jurnal + transaksi + snippet/project baru. Level 0–4 relatif terhadap hari tersibuk dalam rentang. Beranda menampilkan 16 minggu terakhir.

## Bagikan ke Taskify (Share Target)

```
App lain ── Bagikan ──► POST /bagikan (multipart) ──► sw-extra.js: simpan ke Cache "taskify-share"
                                                       └─ 303 → /bagikan?masuk=1 ──► SharePage memilih tujuan
```

- Manifest `share_target` menerima judul/teks/URL dan file (gambar, PDF, zip, file teks/kode).
- Teks → tugas, jurnal, snippet, atau catat cepat. File → project baru / versi project, struk transaksi, snippet (file teks), atau lampiran jurnal. Kotak masuk dikosongkan setelah selesai atau dibatalkan.
- Hanya berfungsi untuk PWA yang ter-install (Chrome Android). Di desktop, halaman `/bagikan` tetap aman dibuka (kotak masuk kosong).

## Backup & keep-alive

- `backup.yml` (mingguan) menjalankan `scripts/backup.sh`, yang berisi `pg_dump -Fc` skema `public` + data `auth.users` → tar.gz → `openssl enc -aes-256-cbc -pbkdf2 -iter 600000` → unggah ke bucket R2 **terpisah** dengan prefix `backups/`. 12 arsip terbaru disimpan. Dump di bawah 1 KB dianggap gagal.
- `pg_dump` 17 dijalankan lewat Docker `postgres:17-alpine`, karena versi bawaan runner lebih lama dari server Supabase.
- `keepalive.yml` (tiap 2 hari) menjalankan satu `SELECT` supaya project free tier tidak di-pause.
- Pembersihan yatim di fungsi `files` hanya menyentuh key berpola `<uuid>/<uuid>/…`, jadi objek lain (mis. backup jika satu bucket) tidak pernah terhapus.
- **Ekspor JSON** di Pengaturan (`features/settings/export-data.ts`) mengambil 16 tabel tersinkron dari SQLite lokal, tanpa server.

## Keamanan

- RLS `owner_*` di semua tabel + `FORCE ROW LEVEL SECURITY`; `anon` tidak punya akses.
- Signup dimatikan; `seed_user_defaults` tidak bisa dipanggil dari client.
- Key R2 tidak pernah ada di browser. Upload/unduh memakai presigned URL berumur pendek dari Edge Function `files`.
- PIN = kunci tampilan per perangkat (PBKDF2-SHA256, 210k iterasi, 5 percobaan → jeda 30 dtk), **bukan** enkripsi data.

Migrasi diuji di Postgres (PGlite): RLS antar-user, constraint, trigger seed, publication (16 tabel), dan replica identity.

## Peta jalan

| Tahap | Isi                                                                                        | Status |
| ----- | ------------------------------------------------------------------------------------------ | ------ |
| 1     | Fondasi: skema, RLS, sync, login, PIN, PWA, design system, Beranda & Kalender bulanan      | ✅     |
| 2     | Tugas + Kalender (list, subtask, RRULE, minggu/agenda, pengingat Web Push)                 | ✅     |
| 3     | Keuangan (CRUD transaksi, input "25rb", anggaran, berulang, hutang, ekspor CSV)            | ✅     |
| 4     | Jurnal (markdown, mood, "hari ini di masa lalu")                                           | ✅     |
| 5     | Quick capture, tag & tautan silang, pencarian global FTS5, Sampah                          | ✅     |
| 6     | Vault: snippet + zip ke R2 (Edge Function presign, lihat isi zip, versi, SHA-256)          | ✅     |
| 7     | Dashboard review, heatmap, GitHub Action keep-alive + backup `pg_dump` ke R2, Share Target | ✅     |
