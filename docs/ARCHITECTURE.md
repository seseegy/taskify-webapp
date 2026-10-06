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
- Service worker (Workbox) memuat `public/push-handler.js`. Klik notifikasi membuka `/tugas?task=<id>`, dan `AppShell` membuka panel detail tugas itu.

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

## Keamanan

- RLS `owner_*` di semua tabel + `FORCE ROW LEVEL SECURITY`; `anon` tidak punya akses.
- Signup dimatikan; `seed_user_defaults` tidak bisa dipanggil dari client.
- Key R2 tidak pernah ada di browser. Upload memakai presigned URL dari Edge Function (tahap 6).
- PIN = kunci tampilan per perangkat (PBKDF2-SHA256, 210k iterasi, 5 percobaan → jeda 30 dtk), **bukan** enkripsi data.

Migrasi diuji di Postgres (PGlite): RLS antar-user, constraint, trigger seed, publication (16 tabel), dan replica identity.

## Peta jalan

| Tahap | Isi                                                                                        | Status |
| ----- | ------------------------------------------------------------------------------------------ | ------ |
| 1     | Fondasi: skema, RLS, sync, login, PIN, PWA, design system, Beranda & Kalender bulanan      | ✅     |
| 2     | Tugas + Kalender (list, subtask, RRULE, minggu/agenda, pengingat Web Push)                 | ✅     |
| 3     | Keuangan (CRUD transaksi, input "25rb", anggaran, berulang, hutang, ekspor CSV)            | ✅     |
| 4     | Jurnal (markdown, mood, "hari ini di masa lalu")                                           |        |
| 5     | Quick capture, tag & tautan silang, pencarian global FTS5, Sampah                          |        |
| 6     | Vault: snippet + zip ke R2 (Edge Function presign, lihat isi zip, versi, SHA-256)          |        |
| 7     | Dashboard review, heatmap, GitHub Action keep-alive + backup `pg_dump` ke R2, Share Target |        |
