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
supabase/functions/    Edge Function send-reminders & files (Deno)
supabase/sql/          SQL manual berisi secret (jadwal cron)
supabase/tests/        Tes migrasi di Postgres (PGlite)
scripts/               generate-vapid-keys.mjs, backup.sh, check-contrast.mjs
powersync/sync-config.yaml   Sync Streams
```

Aturan: kode khusus modul tinggal di `features/<modul>`. Yang dipakai ≥2 modul naik ke `components/` atau `lib/`.

## Urutan gerbang (App.tsx)

`ThemeProvider → env lengkap? → AuthProvider → login? → MFA (aal2)? → PowerSyncProvider → LockGate → Router`

- DB lokal baru dibuka setelah login **dan** verifikasi dua langkah (sesi aal2). MFA wajib dan ditegakkan di aplikasi, RLS (`mfa_aal2`), Sync Streams (`auth.parameter('aal')`), dan Edge Function — lihat `src/features/auth/mfa.ts` dan docs/SETUP.md §13. "Ingat perangkat ini selama 30 hari" (`mfa-trust.ts`) hanya menentukan apakah sesi aal2 yang sudah ada diminta konfirmasi ulang saat aplikasi dibuka; login baru selalu butuh kode.
- Sesi Supabase disimpan di localStorage, jadi aplikasi tetap terbuka saat offline.
- Logout memanggil `wipeLocalDatabase()` (`disconnectAndClear()` + indeks FTS lokal) dan memperingatkan jika masih ada perubahan yang belum terunggah. Bila keluar global gagal (offline), sesi tetap dikeluarkan di perangkat ini (`signOut({ scope: 'local' })`).
- Pemilik database lokal dicatat (`taskify-db-owner`, `src/db/local-reset.ts`). Sesi bisa berakhir tanpa tombol Keluar (token dicabut, logout dari tab lain); bila kemudian akun LAIN masuk, database dikosongkan sebelum ditampilkan/disinkron. Akun yang sama masuk lagi → tidak dikosongkan, jadi perubahan offline tetap terkirim.

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

`connector.ts` membedakan (aturannya di `src/db/upload-policy.ts`):

- **Sementara** (jaringan, 5xx, JWT kedaluwarsa): dilempar ulang → PowerSync retry dengan backoff.
- **Permanen** (`22xxx`, `23xxx`, `42501`, dan `TASKIFY_ROW_MISSING`): sisa operasi disimpan ke tabel lokal `upload_errors` (tidak disinkron), lalu antrean dilanjutkan supaya tidak macet. Jumlahnya tampil di Pengaturan.
- **Skema** (PostgREST `PGRST1xx`/`PGRST2xx`, mis. kolom/tabel belum ada karena aplikasi ter-deploy sebelum migrasinya): dicoba ulang selama ±10 menit (minimal 5 percobaan), lalu diperlakukan permanen. Tanpa batas ini, satu transaksi yang macet menahan SELURUH antrean upload.

`PATCH` dikirim dengan `.select('id')`. Jika tidak ada baris yang terkena (baris tidak ada di server — INSERT-nya dulu ditolak, atau sudah dihapus permanen dari perangkat lain), hasilnya `TASKIFY_ROW_MISSING` dan perubahan disimpan ke `upload_errors`, bukan hilang diam-diam.

PUT berurutan pada tabel yang sama digabung menjadi satu `upsert` massal.

## Kalender sebagai pusat

`features/calendar/useCalendarActivity.ts` menjalankan satu query `UNION ALL` atas jurnal, catatan bertanggal, transaksi, dan vault untuk rentang tanggal, lalu mengelompokkannya per hari. **Tugas tidak ada di query itu**: `useDayActivity` menggabungkannya terpisah karena kejadian berulang bersifat virtual (dihitung dari rrule). Query ini reaktif: modul baru cukup menambahkan cabang `UNION ALL` (dan jenisnya di `ActivityKind`/`DayActivity`) agar otomatis muncul di Kalender.

Aturan hitung aktivitas harus SAMA antar layar (Kalender, Review, heatmap): hanya tugas induk, dan vault = snippet + project + versi file baru. `HEATMAP_SQL` diuji terhadap SQLite.

## Tugas berulang (model bergulir)

- `tasks.rrule` berisi RRULE (RFC 5545) dengan BY* eksplisit, misalnya `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH`. Lihat `features/tasks/recurrence.ts`.
- Dalam satu seri (`series_id`) hanya **satu baris aktif** yang membawa `rrule`.
- Saat dicentang: baris itu menjadi riwayat (`done`, `rrule = null`), lalu baris baru dibuat untuk kejadian berikutnya. Subtask ikut disalin dalam keadaan belum selesai, dan `remind_at` digeser sejumlah hari yang sama. Kalau tugas sudah lama terlambat, kejadian berikutnya melompat ke mulai hari ini.
- **Tanggal 29–31** jatuh di hari terakhir bulan yang tidak punya tanggal itu (31 Jan → 28 Feb → 31 Mar), bukan dilewati seperti default RFC 5545. Rule dibuat sebagai `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`, dan rule lama (`BYMONTHDAY=31`) dinormalkan saat dibaca (`clampToMonthEnd`) sehingga tanpa migrasi data. Berlaku juga untuk transaksi berulang dan 29 Feb tahunan.
- **Mengedit tugas berulang** (`retargetRule`): memindahkan tanggal/jam tidak membangun ulang rule bila rule yang ada masih menghasilkan tanggal itu, jadi rule akhir-bulan yang kebetulan sedang jatuh di 28 Feb tetap "akhir bulan" (bukan berubah jadi "tiap tgl 28"). Editor interval membawa `monthDay` dari rule sebelumnya. Rule baru dibangun hanya bila tanggal dipindah ke hari lain.
- Kejadian masa depan di Kalender bersifat **virtual** (dihitung dari rrule, tidak disimpan) dan ditandai ikon 🔁.
- Semua operasi multi-baris dibungkus transaksi, dan bisa **Diurungkan** lewat toast.

## Pengingat

```
tasks.remind_at (UTC) ──► pg_cron tiap menit ──► Edge Function send-reminders
                                                   ├─ claim_due_reminders()  (klaim atomik, log (task_id, remind_at))
                                                   └─ Web Push (VAPID, aes128gcm) ──► push_subscriptions
```

- **Pengiriman at-least-once**: `claim_due_reminders()` menulis log (`claimed_at`) lebih dulu agar cron yang tumpang tindih tidak mengirim dobel, tetapi baris baru dianggap selesai setelah Edge Function memanggil `mark_reminders_delivered()` (`delivered_at`) _sesudah_ push sukses. Jika push gagal, pengingat diklaim ulang setelah 3 menit, maksimal 5 percobaan, dalam jendela 24 jam. Penandaan dilakukan per kelompok 5 pengingat (bukan sekali di akhir), setiap push punya timeout 10 dtk, dan batch berhenti setelah 90 dtk, sehingga bila fungsi mati di tengah jalan paling banyak satu kelompok kecil terkirim ulang. Orkestrasinya ada di `supabase/functions/send-reminders/process.ts` (murni, diuji Vitest). User tanpa langganan push atau semua langganannya sudah kedaluwarsa dianggap selesai (tidak ada tujuan).
- `push_subscriptions` dan `task_reminder_log` **tidak disinkron** PowerSync. Langganan push ditulis langsung lewat supabase-js (mengaktifkan notifikasi memang butuh online), sedangkan log hanya diakses server.
- Mengubah `remind_at` menghasilkan kunci log baru, jadi pengingat baru tetap terkirim, tanpa ada yang terkirim dobel.
- Langganan yang kedaluwarsa (404/410) otomatis dihapus.
- Service worker (Workbox) memuat `public/sw-extra.js` (push, klik notifikasi, Share Target). Klik notifikasi membuka `/tugas?task=<id>`, dan `AppShell` membuka panel detail tugas itu. Bila aplikasi sudah terbuka, service worker meminta router pindah halaman lewat `postMessage` (tanpa memuat ulang, isian yang belum disimpan tetap ada); memuat ulang hanya bila tab tidak menjawab dalam 1 detik.
- "Sembunyikan isi notifikasi" (Pengaturan, per perangkat): preferensi disimpan di Cache Storage (`taskify-prefs`) karena service worker tidak bisa membaca localStorage; notifikasi lalu hanya bertuliskan "Ada pengingat tugas". Judul tugas tetap dikirim server (terenkripsi Web Push), hanya tidak ditampilkan.
- Precache (instal pertama, ±3,8 MB) memuat semua halaman & chunk agar aplikasi jalan offline, KECUALI dua aset besar yang jarang dipakai: `wa-sqlite-async*.wasm` (fallback IndexedDB bila OPFS tidak bisa dipakai) dan `zxcvbn-*.js` (kamus penilai master password Sandi, gagal tertutup bila tidak bisa dimuat). Keduanya disimpan ke cache `taskify-lazy-assets` saat pertama dipakai (CacheFirst), lalu tersedia offline. Lihat `vite.config.ts`.
- Palet perintah, detail tugas, form transaksi, dan pemutar musik dimuat lazy (`components/layout/LazyPanels.tsx`): dipasang saat store-nya pertama kali meminta dibuka, kodenya diambil saat browser senggang. Pintasan Ctrl/⌘ K ada di `usePaletteShortcut` (AppShell) supaya bekerja sebelum palet dimuat.

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

## Catatan

Fitur sendiri, **beda dengan Jurnal**: tidak ada mood, dan tanggalnya opsional. Tabel `notes` (`note_date` nullable, `title`, `content` Markdown, `is_pinned`, soft delete).

- **Dua jenis dalam satu tabel**: `note_date` NULL = catatan **bebas** (tidak terikat hari); terisi = **ditempel ke tanggal** dan muncul di Kalender. Editor punya tombol "Tempel ke tanggal" / "Lepas dari tanggal". Satu hari boleh punya **banyak** catatan (tidak ada UNIQUE pada tanggal).
- UI mengikuti Jurnal: dua kolom (daftar + editor; di HP bergantian), simpan otomatis 0,7 dtk dengan pola yang sama (draf baru baru dibuat di DB saat ada judul/isi pertama; rantai simpan tidak boleh reject; flush saat tab di-background). Daftar: Disematkan → per bulan → "Tanpa tanggal"; filter Semua/Bertanggal/Bebas; pencarian judul + isi.
- URL: `?catatan=<id>`, `?baru` (draf bebas), `?baru=<tanggal>` (draf ditempel ke tanggal). Kunci editor draf diturunkan dari `location.key`, jadi menekan "Catatan baru" lagi selalu memulai editor baru.
- Pencarian daftar meng-escape `%`, `_`, `\` (`escapeLike` + `LIKE … ESCAPE '\'`), supaya mengetik `%` tidak cocok dengan semua catatan.
- Tag, tautan, pin, pencarian global (FTS5), dan Sampah (30 hari) memakai mekanisme yang sama dengan modul lain. **Lampiran belum didukung**, jadi constraint `attachments.entity_type` tidak diubah. Migrasi `…_notes.sql` memperluas constraint `entity_type` di `taggings` dan `entity_links` ke `'note'`; tanpa itu, tag/tautan pada catatan ditolak server saat upload.
- Kalender: titik/legenda "Catatan" dan panel hari (`DayNotes`) hanya menghitung catatan **bertanggal**. Heatmap & Beranda memakai aturan yang sama.
- Navigasi: item `mobile: false` di `NAV_ITEMS` (bottom nav HP sudah 5 item). Di HP dijangkau lewat tombol **Menu** di header (sheet berlabel berisi semua item `mobile: false`), selain kartu Beranda, panel hari Kalender, dan palet perintah.
- Catat cepat: awalan `c:` / `catatan:` / `note:` → catatan bebas. **Perubahan perilaku**: `catatan:` dulu menyimpan ke Jurnal; kini ke Catatan (`j:` / `jurnal:` tetap ke Jurnal).
- `MarkdownEditor`, `SaveIndicator`, dan helper `lib/markdown.ts` (`plainExcerpt`, `wordCount`, `toggleChecklistLine`) dipakai bersama Jurnal dan Catatan.
- Warna modul: lime → green (`bg-gradient-notes`, `--color-mod-notes` `#65a30d`).

## Sapaan, nama, dan efek ketik

- **Nama tampilan** = kolom `user_settings.display_name` (baris dibuat trigger saat akun didaftarkan; klien hanya boleh mengubahnya). Diisi di Pengaturan → Akun (`DisplayNameSettings`), dibaca lewat `useDisplayName`. Batas 60 karakter hanya di klien (`LIMITS.displayName`); Postgres tidak punya CHECK-nya. Nama lengkap dipakai apa adanya (tidak dipotong jadi nama depan).
- **Sapaan Beranda**: "Selamat pagi, Nama". Efek ketik menunggu `useDisplayName().ready` (query selesai, baris ada atau tidak), lalu kalimat ringkasan tugas diketik SETELAH sapaan selesai dan data tugas (`summary`) ada.
- **Layar masuk** dirender sebelum ada sesi/database, jadi tidak bisa membaca `user_settings`. Nama disalin ke `localStorage` (`taskify-login-name`, lihat `auth/display-name.ts`) dan dibaca sekali saat mount: "Selamat datang kembali, Nama". **Sengaja bertahan setelah Keluar** (`clearDeviceData` tidak menghapusnya) — kalau dihapus, fiturnya percuma. Konsekuensi privasi: di perangkat bersama, siapa pun yang membuka halaman masuk melihat nama pemilik. Karena itu ada saklar "Tampilkan namaku di layar masuk" di Pengaturan; mematikannya LANGSUNG menghapus nama tersimpan (`taskify-login-name-off` = `1`). Bawaan aktif.
- **Efek ketik** (`lib/typewriter.ts` murni, `lib/useTypewriter.ts`, `components/ui/TypedText.tsx`):
  - Sekali per sesi (`sessionStorage`, kunci `taskify-fx-*`); kunjungan berikutnya langsung utuh.
  - `prefers-reduced-motion` dicek di JavaScript (`matchMedia`). Aturan CSS di `index.css` hanya mematikan animasi/transisi CSS dan TIDAK menjangkau timer JS.
  - Pembaca layar membaca teks lengkap sekali (`sr-only`); salinan animasinya `aria-hidden`.
  - Sebelum `enabled` (data belum siap) hanya satu baris kosong yang dirender. Merender teks sementara — walau tak terlihat — memesan ruang yang salah dan menggeser konten saat teks final membungkus ke baris lain (terukur: 36px di 375px sebelum diperbaiki). Setelah `enabled`, seluruh teks dirender dengan sisa huruf `invisible` sehingga tinggi tetap selama mengetik.
  - Nama pada gradasi (`text-gradient-brand`) dirender sebagai satu elemen berlebar penuh agar warna huruf tidak bergeser tiap huruf bertambah.
  - Semua yang memengaruhi tampilan adalah state, bukan ref (lint `react-hooks/refs` menolak membaca `ref.current` saat render).
- **Placeholder kotak cari** (`search/useTypingPlaceholder.ts`): contoh catat cepat diketik bergantian ("Coba: …") dan mengajarkan sintaks. Diubah LANGSUNG lewat DOM, bukan state, karena `PaletteBody` berat. Berhenti saat pengguna mulai mengetik. Panjang contoh dibatasi: di layar 320px area isi input hanya ±201px dan placeholder tidak membungkus baris. `useTypingPlaceholder.test.ts` mengunci setiap contoh ke perilaku `parseCapture` — contoh yang tidak diurai seperti yang diajarkan menyesatkan pengguna.

## Pencarian, catat cepat, tag & tautan

- **Pencarian global** memakai SQLite **FTS5** lokal (`db/search-index.ts`). Trigger pada tabel internal PowerSync `ps_data__<tabel>` memperbarui `search_index` untuk setiap perubahan, baik lokal maupun hasil sync. Item di Sampah dikeluarkan dari indeks. Naikkan `INDEX_VERSION` untuk membangun ulang. Tanpa FTS5, otomatis memakai LIKE.
- **Command palette** (Ctrl/⌘+K, `/`, atau tombol cari) menggabungkan hasil pencarian, tag, perintah, dan **catat cepat** (`features/capture/parse-capture.ts`):
  - Ada nominal (`25rb`, `Rp 50.000`, `+5jt`) → transaksi. Masuk jika diawali `+` atau ada kata seperti gaji/bonus. Kategori ditebak dari kata kunci; `kemarin` mengatur tanggal.
  - Awalan `j:` → jurnal, `c:`/`catatan:` → catatan bebas. Selain itu → tugas (memakai parser input cepat tugas).
  - `#tag` dikenali di semua jenis. Tab mengganti jenis simpan.
  - Catat cepat didahulukan hanya jika ada sinyal jelas (nominal, waktu, prioritas, tag, `j:`). Teks biasa menampilkan hasil pencarian dulu.
- **Tag** (`tags`/`taggings`): nama dinormalisasi (huruf kecil, `-`); keunikan dijaga di aplikasi, bukan constraint DB. Halaman `/tag/:id` menampilkan item lintas modul.
- **Tautan** (`entity_links`) ditampilkan dua arah. "Catat sebagai transaksi" dari tugas membuat transaksi yang tertaut (dan mengisi `task_id`).
- **Sampah** (`/sampah`) menggabungkan tugas, jurnal, catatan, transaksi, snippet, dan project. Item lebih dari 30 hari dihapus permanen otomatis setelah sync awal. Hapus permanen juga membersihkan tag & tautan (`db/refs.ts`), karena keduanya tidak punya foreign key. Baris pendukung yang ter-soft-delete (anggaran, hutang, transaksi berulang, daftar tugas, tag) ikut dibersihkan setelah 30 hari (`purgeExpiredSupportRows`). **Dompet dan kategori sengaja tidak**: `transactions.wallet_id` ber-`RESTRICT` dan `budgets.category_id` ber-`CASCADE`, jadi menghapusnya bisa menolak sync atau menghapus anggaran yang masih aktif.
- `Sheet` memfokuskan elemen ber-`data-autofocus` setelah `showModal()` (yang jika tidak akan memfokuskan tombol Tutup).

## Vault & lampiran (R2)

```
Browser ── (1) INSERT attachments (pending) ──► SQLite lokal ──sync──► Postgres
   │  (2) presign {key, size} ──► Edge Function files (cek JWT, key berawalan user_id/, ≤ 100 MB)
   │  (3) PUT langsung ke R2 (Content-Length ikut ditandatangani)
   └─ (4) UPDATE status = 'uploaded' (file sudah ada di Cache Storage sejak langkah 0)
```

- **Langkah 0**: file disimpan ke Cache Storage perangkat _sebelum_ diunggah. Jika offline/gagal/aplikasi ditutup, "Ulangi" tetap bisa memakai salinan itu, dan `useAttachmentOutbox` (AppShell) mengunggah otomatis saat online. Aturan outbox (`upload-policy.ts`, diuji): maks. 3 percobaan per lampiran per sesi dengan jeda ≥ 1 menit; hanya lampiran yang salinannya ada di perangkat ini; upload yang **dibatalkan pengguna tidak diulang**; satu unggahan per lampiran lintas tab lewat Web Locks, dan status dibaca ulang di dalam kunci sehingga `uploaded` tidak diturunkan kembali.
- Cron server menghapus lampiran yang belum terunggah setelah 2 hari **sejak diterima server** (`attachments.received_at`, diisi server), bukan sejak `created_at` (jam perangkat). Lampiran yang dibuat offline berhari-hari tidak terhapus sebelum sempat terunggah.

- Key R2 = `<user_id>/<attachment_id>/<nama file>`. Fungsi menolak key milik user lain.
- Unduh/pratinjau: cache lokal dulu, baru presigned GET. Isi zip dibaca di browser (JSZip) tanpa ekstrak ke disk.
- Sebelum upload, zip dianalisis (`features/vault/zip.ts`): file rahasia, node_modules, .git, hasil build. Duplikat dideteksi lewat SHA-256.
- Hapus = soft delete lokal + hapus objek (best effort). Cron harian (`files` mode cleanup) membersihkan sisanya, termasuk objek yatim. Penelusuran bucket berhalaman (maks. 20 × 1000 objek dan 500 penghapusan per eksekusi).
- **Logout** menghapus database lokal (`wipeLocalDatabase`) _dan_ Cache Storage lampiran + kotak masuk Bagikan + kepercayaan perangkat Sandi (`clearDeviceData`). Semuanya ditunggu sebelum halaman dimuat ulang.
- Snippet: syntax highlight (prism-react-renderer + bahasa prismjs tambahan, dimuat lazy), variabel template `{{nama}}` diisi saat disalin.
- Foto besar (>1,5 MB) diperkecil ke maks. 2000 px JPEG sebelum diunggah.

## Review & heatmap

- `/review?periode=minggu|bulan&tanggal=<tanggal>` (desktop: menu samping; HP: tautan dari Beranda). Minggu = Senin–Minggu WIB.
- Statistik (`features/review/review-queries.ts`) dihitung langsung dengan SQL dari SQLite lokal, jadi tidak perlu tabel ringkasan: tugas selesai/terlambat, hari menulis jurnal & rata-rata mood, pemasukan/pengeluaran + kategori terbesar, item vault baru. Setiap angka dibandingkan dengan periode sebelumnya.
- **Tulis refleksi** membuka draf jurnal (`?baru=…&templat=review-minggu|bulan`) berisi ringkasan angka + pertanyaan. Draf baru tersimpan setelah diedit, mengikuti aturan simpan otomatis jurnal.
- Heatmap = jumlah per hari dari tugas selesai + catatan jurnal + catatan bertanggal + transaksi + snippet/project baru. Level 0–4 relatif terhadap hari tersibuk dalam rentang. Beranda menampilkan 16 minggu terakhir.

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
- **Ekspor JSON** di Pengaturan (`features/settings/export-data.ts`) mengambil semua tabel tersinkron (`EXPORT_TABLES`, dijaga tes keselarasan) dari SQLite lokal, tanpa server.

## Keamanan

- RLS `owner_*` di semua tabel + `FORCE ROW LEVEL SECURITY`; `anon` tidak punya akses.
- Signup dimatikan; `seed_user_defaults` tidak bisa dipanggil dari client.
- Key R2 tidak pernah ada di browser. Upload/unduh memakai presigned URL berumur pendek dari Edge Function `files`.
- PIN = kunci tampilan per perangkat (PBKDF2-SHA256, 210k iterasi, 5 percobaan → jeda 30 dtk), **bukan** enkripsi data. Hitungan percobaan dan jeda disimpan di localStorage agar reload tidak mereset, dibagi antar tab (dibaca ulang sebelum menambah + event `storage`), dan jeda tersimpan dijepit ke 30 dtk agar jam perangkat yang pernah salah tidak mengunci berbulan-bulan.
- PIN bersifat **per perangkat/browser** (hash di `localStorage`, tidak disinkron). **Lupa PIN**: tautan di layar kunci meminta password akun, memverifikasinya ke Supabase (`signInWithPassword`, percobaan dibatasi server), lalu mematikan PIN di perangkat ini. Butuh internet. Tanpa ini, satu-satunya jalan keluar adalah menghapus data situs (menghapus database lokal beserta perubahan yang belum terunggah).
- Ekspor CSV menetralkan sel teks berawalan `= + - @` (formula injection).

## Sandi (password manager)

Brankas sandi **terenkripsi ujung ke ujung**, tersinkron antar-perangkat lewat PowerSync seperti modul lain. Kode: `src/features/sandi/` (rute `/sandi`).

**Model ancaman.** Yang dilindungi: isi sandi dari siapa pun yang punya akses database, backup `pg_dump`, ekspor JSON, atau akun Supabase. Yang **tidak** dilindungi: perangkat yang sedang terbuka dan terinfeksi (XSS/malware bisa memakai kunci di memori), jumlah item dan waktu ubah (metadata), dan master password yang lemah (penyerang dengan salinan data bisa menebak offline; KDF hanya memperlambatnya).

```
master password ─PBKDF2-SHA256 600rb iterasi, salt acak─► KEK ─AES-GCM─► bungkus DEK
kunci pemulihan (128 bit acak) ─HKDF-SHA256─► KEK-pemulihan ─AES-GCM─► bungkus DEK (salinan ke-2)
DEK (256 bit acak) ─AES-256-GCM, IV acak, AAD = user + id item─► isi item (judul, URL, username, sandi, catatan)
```

- **DEK terpisah dari master password, dan DIROTASI di setiap penggantian kunci.** Ganti master password, pulihkan dengan kunci pemulihan, dan buat kunci pemulihan baru semuanya membuat DEK baru, mengenkripsi ulang SEMUA item (termasuk yang di Sampah) dan mengganti record kunci dalam satu transaksi lokal (`replaceVault`, `reencryptItems`). Dengan begitu "dicabut" benar-benar berarti: sandi/kunci pemulihan lama + salinan `pw_keys` lama (backup Supabase, ekspor) tidak bisa membuka data saat ini, termasuk item yang ditulis sesudahnya. Yang tetap terbuka dengan kunci lama hanyalah snapshot ciphertext lama itu sendiri; itu tidak bisa ditarik kembali. Item yang sudah tidak bisa dibuka dengan DEK lama dibiarkan apa adanya (tidak ditimpa). Perangkat lain yang sedang terbuka mengenali record kunci berubah (`stamp` di `sandi-store.ts` ≠ `wrapped_key`), langsung terkunci, dan meminta master password terbaru. Batas: item yang dibuat di perangkat lain dengan DEK lama SEBELUM perangkat itu sempat sinkron akan tampil sebagai "tidak bisa dibuka" (data tidak hilang).
- **AAD mengikat item ke akun + id barisnya**: ciphertext yang ditukar antar baris atau dipindah ke akun lain gagal diautentikasi. Plaintext dipadatkan ke kelipatan 256 byte agar panjang ciphertext tidak membocorkan panjang sandi.
- Server hanya melihat `pw_keys` (parameter KDF + kunci terbungkus) dan `pw_items.enc`. CHECK Postgres menolak iterasi < 100 ribu dan salt/kunci yang terlalu pendek; satu brankas per user (UNIQUE, pengecualian dari aturan "hindari UNIQUE").
- **Master password harus berbeda dari password akun Taskify** (server melihat password akun saat login). Syarat: ≥ 12 karakter dan ≥ 50 bit menurut zxcvbn-ts dengan kamus Inggris + Indonesia + bagian email akun (`master-password.ts`, dimuat lazy ±2 MB, gagal tertutup: bila tidak termuat, sandi ditolak). Sandi acak baru lolos sekitar 16 karakter ke atas karena zxcvbn menghitung karakter tanpa pola ±3,3 bit; jalur utama adalah frasa 5 kata dari daftar EFF yang bisa dibuatkan di wizard. Batas yang tidak bisa dibuang: gabungan kata pribadi yang tidak ada di kamus mana pun (nama anak + nama hewan) tidak bisa dibedakan dari acak oleh estimator apa pun. Heuristik cepat di `generator.ts` hanya untuk meter sandi situs, BUKAN gerbang.
- **Lupa master password DAN kunci pemulihan = data tidak bisa dipulihkan siapa pun.** Kunci pemulihan ditampilkan sekali; pengguna wajib mengonfirmasi sudah menyimpannya sebelum brankas disimpan/diubah.

**"Ingat perangkat ini 30 hari".** Opsional, dicentang di layar buka brankas. DEK disimpan di IndexedDB sebagai `CryptoKey` apa adanya: spesifikasi WebCrypto membuat `CryptoKey` bisa di-structured-clone, dan DEK dibuat `extractable: false`, sehingga browser menyimpannya sebagai objek buram — byte kuncinya tidak pernah bisa dibaca JavaScript. Master password tidak pernah disimpan dan tidak ada teks terang yang ditulis ke disk. Kepercayaan batal otomatis bila: lewat 30 hari, `pw_keys.wrapped_key` berubah (ganti master password / kunci pemulihan di perangkat mana pun, karena DEK ikut dirotasi — jadi `trustState` mengembalikan `stale`), atau akun keluar (`AuthProvider`). Bisa dicabut manual di Pengaturan brankas, dan setelah ganti kunci dari perangkat ini kepercayaannya disegarkan agar tidak langsung basi. **Pertukarannya:** siapa pun yang bisa membuka browser di perangkat ini membaca brankas tanpa master password, jadi penjaga sebenarnya menjadi PIN aplikasi dan kunci layar; UI memperingatkan bila PIN belum aktif. XSS juga bisa MEMAKAI kunci itu (walau tidak bisa mencurinya) selama masa kepercayaan.

**Kode TOTP (authenticator).** Taskify bisa menggantikan Google Authenticator untuk akun lain. Kunci rahasia disimpan sebagai field `totp` DI DALAM `pw_items.enc` — tidak ada kolom baru, dan `parsePayload` memaafkan item lama yang belum punya field itu. Kode dihitung di perangkat (`totp.ts`, HMAC lewat WebCrypto, vektor uji RFC 6238 untuk SHA1/256/512 ada di `totp.test.ts`); base32 di sini RFC 4648 (A–Z, 2–7), BEDA dari Crockford yang dipakai kunci pemulihan. Menerima kunci base32 polos maupun URI `otpauth://totp/...` (digits, period, algorithm, issuer, akun ikut terbaca; `hotp` ditolak). Jam: TOTP sepenuhnya bergantung jam, jadi selisih terhadap header `Date` server diukur sekali lalu dipakai terus (`totp-clock.ts`, ketelitian ±1 detik) dan selisih ≥ 10 detik memunculkan peringatan.

**Riwayat kode (`pw_totp_log`).** Setiap kode yang disalin dicatat: nama akun, angka kodenya, dan waktunya, semuanya di dalam `enc` (AAD berdomain sendiri, jadi baris riwayat tidak bisa ditukar menjadi item). Server hanya melihat waktu dan jumlah baris. Tabel sendiri, BUKAN di dalam `pw_items`, karena daftar brankas diurutkan `updated_at DESC`: menulis riwayat ke item akan membuat item melompat ke atas setiap kali kode disalin, dan setiap penyalinan berarti satu enkripsi ulang + satu unggahan untuk seluruh item. Retensi 90 hari dibersihkan di klien (karena itu `pw_totp_log` boleh di-DELETE, berbeda dari `pw_keys`). Saat kunci dirotasi, riwayat ikut dienkripsi ulang bersama item dalam satu transaksi; baris yang tidak bisa dibuka dilewati, tidak ditampilkan, dan hilang sendiri karena retensi.

**Pertukaran yang disengaja:** menyimpan kunci TOTP bersama sandi di satu brankas berarti 2FA turun menjadi satu faktor efektif bila brankas DAN master password jatuh bersamaan — sama seperti Bitwarden/1Password. UI memperingatkan agar kode 2FA akun Taskify sendiri TIDAK disimpan di sini (akan membuat pemilik terkunci). File ekspor juga memuat kunci TOTP (terenkripsi).

**`pw_keys` tidak bisa dihapus lewat API.** Aplikasi tidak pernah menghapus record kunci, jadi hak `DELETE` dan policy `owner_delete` sengaja tidak diberikan (hanya `SELECT/INSERT/UPDATE`); sesi pemilik yang bocor tidak bisa menghapus kunci dengan satu perintah. Baris hanya hilang lewat `ON DELETE CASCADE` saat akun dihapus. `UPDATE` tetap diperlukan untuk ganti master password, jadi perlindungan dari penimpaan adalah backup/PITR Supabase.

**Brankas pertama & dua perangkat.** Server hanya menerima satu `pw_keys` per user (unique index). Agar dua perangkat tidak membuat brankas masing-masing: (1) sebelum wizard tampil dan sekali lagi sebelum menyimpan, perangkat bertanya langsung ke Supabase (bukan DB lokal); tanpa internet atau bila sudah ada, brankas tidak dibuat; (2) setelah menyimpan, brankas baru dibuka hanya setelah server menerima record kuncinya (`waitForKeyUpload`, maks. 15 dtk), jadi tidak ada item yang ditulis dengan kunci yang akhirnya ditolak; (3) bila tetap ada penolakan `pw_keys` di `upload_errors` (dua perangkat persis bersamaan lalu koneksi lambat), halaman Sandi menampilkan banner. Perilaku klien PowerSync saat unggahan ditolak (baris lokal diganti milik pemenang) belum teruji di lingkungan nyata.

**Siklus kunci.** DEK hanya ada di memori sebagai `CryptoKey` non-extractable (`sandi-store.ts`), tidak pernah ke storage. `useSandiAutoLock` (dipasang di AppShell, jadi berlaku di semua halaman) mengunci saat: tab disembunyikan ≥ batas pilihan (0/1/5/15 menit; 0 = segera), tidak ada interaksi selama batas itu, atau PIN aplikasi terkunci. Saat tab kembali terlihat, kunci diperiksa **sebelum** konten tampil. Hasil dekripsi hidup di komponen `UnlockedVault` yang hanya di-mount saat terbuka, jadi plaintext ikut hilang saat dikunci. Papan klip: sandi dihapus otomatis 30 detik setelah disalin dan saat dikunci (batasan browser: tidak bisa bila dokumen tidak fokus).

**Sinkron & balapan.** Wizard hanya bisa dimulai setelah sinkron pertama selesai; `createKey` menolak bila sudah ada record kunci. Dua perangkat yang membuat brankas bersamaan (sangat jarang) menyebabkan item di salah satunya tidak terbaca; UI menampilkan "N sandi tidak bisa dibuka" dan datanya tidak dihapus. Sandi tidak masuk indeks FTS, palette, tag, maupun tautan (sengaja). Dihapus = soft delete + Urungkan (toast), dibersihkan permanen setelah 30 hari. Ekspor JSON dan backup memuat ciphertext saja.

**Generator** (`generator.ts`, murni): `crypto.getRandomValues` + rejection sampling (tanpa bias modulo), tiap jenis karakter yang dipilih dijamin muncul, mode karakter (8–128) dan frasa sandi (EFF 7.776 kata, ±12,9 bit/kata, dimuat lazy). Hanya **pengaturan** generator yang diingat per perangkat, tidak pernah sandinya. Bisa dipakai tanpa membuka brankas.

**Belum ada** (sengaja di luar cakupan awal): impor/ekspor CSV, pindai QR lewat kamera (kunci TOTP ditempel manual), passkey/biometrik untuk membuka, pengecekan kebocoran (HIBP), Sampah khusus sandi.

## Konfigurasi berversi (Vault)

Berkas `.env`/JSON berversi, **memakai kunci brankas Sandi** (bukan kunci sendiri): isi `.env`
hampir selalu memuat rahasia, jadi diperlakukan seperti isi brankas. Kode: `src/features/vault/config/`.

- **Metadata teks biasa, isi terenkripsi.** `config_files` memuat nama, format, lingkungan, dan
  `project_id` apa adanya, supaya daftar tetap tampil saat brankas terkunci. `config_versions.enc`
  memuat `{ text, note }` — isi berkas DAN catatan perubahannya (catatan bisa menyebut hal
  sensitif). AAD = `taskify-sandi/config/v1/{user}/{file}/{versi}`, jadi ciphertext tidak bisa
  dipindah ke berkas lain, versi lain, akun lain, atau ditukar menjadi item Sandi.
- 🔴 **Setiap jenis data baru yang dienkripsi dengan DEK brankas WAJIB ditambahkan ke
  `rekeyVaultRows`** (`features/sandi/vault-rekey.ts`). Kalau terlewat, mengganti master password
  membuat data itu tidak bisa dibuka **selamanya**: DEK dirotasi di setiap penggantian kunci dan
  kunci lama sudah ditimpa. Ada tes yang gagal bila integrasinya dilepas.
- **Teks mentah adalah sumber kebenaran.** Parser (`config-parse.ts`) tidak pernah menulis ulang
  berkas; hasilnya hanya untuk menampilkan nilai per kunci (agar bisa disembunyikan satu per
  satu), memvalidasi, dan membandingkan. Komentar, urutan, dan baris kosong tidak pernah hilang.
- **Perbandingan per kunci**, bukan per baris (untuk JSON per path seperti `db.pool.max`), jadi
  memindahkan baris atau mengubah komentar bukan "perubahan". Bisa juga membandingkan dua berkas
  berbeda — itulah cara menjawab "kunci apa yang belum ada di staging?"
- **Nomor versi (v1, v2, …) TIDAK disimpan**, dihitung dari urutan `created_at`/`id`.
  `UNIQUE(file_id, nomor)` akan menolak versi dari dua perangkat yang sama-sama offline (aturan
  "hindari UNIQUE di data yang bisa diedit"). Konsekuensinya nomor bisa bergeser bila versi dari
  perangkat yang tertinggal baru tiba belakangan.
- **Batas 256 KB per versi** ditegakkan di klien (`CONFIG_MAX_BYTES`, diukur byte UTF-8), karena
  CHECK Postgres berlaku pada ciphertext yang lebih panjang setelah padding + base64 — pesan
  23514 dari server tidak bisa menyebut batas yang dimengerti pengguna.
- **Rujukan lintas akun ditolak trigger** `config_check_owner`: FK hanya memeriksa baris ADA,
  bukan pemiliknya. Tabel inti memakai pemeriksaan yang sama lewat constraint trigger
  `check_ref_owner` (migrasi `20261016000100`): dompet, kategori, tugas, daftar, tag, hutang,
  dan transaksi berulang yang dirujuk harus milik user yang sama. Pesannya sama untuk "milik orang lain" dan "tidak ada", jadi tidak
  membocorkan keberadaan UUID.
- Project dihapus permanen → berkas menjadi "Tanpa project" (`SET NULL`), tidak ikut terhapus.
- Isi konfigurasi tidak masuk FTS, palette, tag, maupun tautan (sengaja, sama seperti Sandi).
- **Tidak ada tombol unduh**: isi hanya bisa disalin lewat `copySecret` (papan klip dihapus
  otomatis), supaya tidak ada salinan tanpa enkripsi yang tertinggal di disk.

**UI.** Tab ketiga di Vault (`/vault?tab=konfigurasi`, satu berkas di `?config=<id>`), plus seksi
di panel Project yang dibatasi project itu. Pintu masuk palette hanya membuka daftarnya.

- **Daftar tetap berguna saat brankas terkunci** — itu alasan metadata disimpan teks biasa. Baris
  terkunci ditandai ikon gembok + teks `sr-only`, bukan hanya warna.
- **Gerbang buka brankas ada di dalam panelnya** (`UnlockScreen` yang sama dengan Sandi), jadi
  tidak perlu pindah halaman. **Pemulihan master password sengaja TIDAK ada di sini**: itu
  merotasi kunci seluruh brankas, jadi tempatnya tetap di halaman Sandi.
- `useVaultKey` (`features/sandi/useVaultKey.ts`) adalah **satu-satunya** tempat yang membuang DEK
  usang dan membuka otomatis untuk perangkat tepercaya. Halaman Sandi memakainya juga. Kalau
  pemeriksaan itu diduplikasi, layar yang ketinggalan bisa diam-diam menulis dengan kunci usang —
  dan datanya tidak akan bisa dibuka setelah sinkron.
- Isi versi hanya didekripsi di komponen yang **di-mount saat brankas terbuka**, jadi plaintext
  ikut hilang saat dikunci. Terkunci saat mengedit = draf dibuang, dan itu diberitahukan.
- **Nilai disembunyikan secara bawaan** dengan jumlah titik tetap (panjang nilai tidak bocor),
  tersembunyi lagi otomatis setelah 15 detik. Teks mentah berada di balik gerbang yang sama.
- Pembersihan 30 hari (`purgeExpiredConfigFiles`) **menghapus versinya secara eksplisit**:
  `ON DELETE CASCADE` hanya ada di Postgres, tabel lokal PowerSync tidak punya foreign key.
  Berkas yang dihapus tidak tampil di halaman Sampah (pola `pw_items`); pemulihannya lewat
  &ldquo;Urungkan&rdquo; di toast.

## Musik (opsional)

Satu-satunya modul yang **tidak menyentuh basis data sama sekali**: tanpa tabel, tanpa migrasi, tanpa entri di `powersync/sync-config.yaml`, tanpa `withMeta`/`deleted_at`, tanpa FTS. Antrean, URL audio, dan lirik hidup di memori selama satu sesi dan hilang saat tab ditutup — memang itu yang diinginkan, karena URL hasil konversi berumur pendek.

- Datanya dari Worker terpisah, [`seseegy/music-taskify`](https://github.com/seseegy/music-taskify), lewat `VITE_MUSIC_API_URL` yang **opsional**: kosong = seluruh pintu masuk musik disembunyikan dan aplikasi tetap boot (pola `VITE_VAPID_PUBLIC_KEY`).
- Autentikasi memakai **JWT sesi Supabase**, diambil segar tiap permintaan lewat `getSession()` (pola `db/connector.ts`). Tidak ada token yang dibundel ke browser.
- `MusicBar` dipasang di `AppShell`, bukan di dalam halaman — router meng-unmount halaman saat pindah menu dan itu memutus musik. Ia memegang satu-satunya `<audio>` dan `useMusicPlayer()`.
- Pintu masuknya **hanya** CommandPalette (seksi "Musik") dan bilah itu sendiri. Tidak ada item di `NAV_ITEMS`: sidebar dan BottomNav sudah penuh.
- Mesin antreannya (`queue-core.ts`) dipindahkan apa adanya dari repo Worker beserta 60 tesnya.

Rancangan, batasan, dan alasannya: [`RANCANGAN-MUSIK.md`](RANCANGAN-MUSIK.md). Dua batas yang bukan bug: audionya **tidak bisa digeser posisinya** (hulu tidak melayani `Range`), dan lagu **pertama** perlu 12–28 detik (lagu berikutnya disiapkan di latar belakang).

## Batas data & penolakan server

- CHECK Postgres menolak baris yang melanggar batas (mis. `transactions.title` ≤ 120). Penolakan permanen masuk `upload_errors` (lokal), dan **sisa operasi dalam satu transaksi lokal ikut dibuang**; operasi sebelumnya sudah diterapkan, jadi satu transaksi lokal bisa berlaku sebagian di server. Karena itu semua jalur tulis memotong teks lewat `clip(…, LIMITS.x)` (`src/lib/limits.ts`, per code point seperti `char_length`). Ubah `LIMITS` bersamaan dengan CHECK-nya.
- Pengaturan → Sinkronisasi menampilkan daftar penolakan (tabel, penyebab), dengan tombol salin JSON dan bersihkan.

## Batasan yang diketahui

Sengaja tidak diubah (trade-off atau terlalu jarang untuk sebanding dengan risikonya):

- **Parser jam**: jam berformat titik tanpa penanda hanya dikenali bila menitnya 00/15/30/45 ("rapat 14.30"). "15.20" tidak dianggap jam karena bentrok dengan harga/nomor versi. Tulis "jam 15.20", "15:20", atau "15.20 WIB".
- **Catat cepat**: angka polos > 9 digit atau bersatuan hitung ("50000 orang") bukan nominal; tulis "50rb" atau "Rp 50.000". Kalimat dengan nominal + besok/lusa/"<hari> depan" menjadi **tugas** hanya bila ada kata kerja rencana bayar (bayar, cicil, transfer, kirim, setor, …) dan bukan pemasukan; selebihnya tetap transaksi. Jenis bisa diganti di palette (Alt+↑↓).
- **Sinkronisasi**: `PATCH` ke baris yang sudah dihapus permanen di server masuk `upload_errors` (`TASKIFY_ROW_MISSING`), tidak dipulihkan otomatis. Perangkat yang offline > 30 hari bisa menabrak FK (23503) pada baris yang sudah dipurge dan masuk `upload_errors`. Pembersihan 30 hari memakai jam perangkat (pola yang sama untuk semua entitas).
- **Pengingat**: setelah 5 percobaan (~12 menit) pengingat yang tetap gagal dilepas tanpa jejak selain log Edge Function. Jika satu perangkat berhasil dan perangkat lain gagal sementara, pengingat dianggap selesai.
- **Pengujian**: klaim cron yang benar-benar bersamaan (dua koneksi) hanya diuji manual di Postgres 16; suite PGlite memakai satu koneksi. Fungsi Edge (Deno) tidak punya tes langsung; logika orkestrasinya diekstrak ke `process.ts` agar teruji.

## Pengujian

`pnpm test` (Vitest) bagian dari `pnpm check`. Tidak butuh DOM/server:

- `src/**/*.test.ts`: logika murni (tanggal WIB, recurrence, parser, CSV, batas panjang), query SQLite (`node:sqlite`), dan store.
- `supabase/tests/migrations.test.ts`: menjalankan semua migrasi berurutan di Postgres sungguhan (PGlite) lalu menguji RLS, publication, seed akun baru, CHECK, dan siklus pengingat (klaim, coba ulang, selesai, hak akses).
- Proses tes berjalan di zona waktu `America/Los_Angeles` agar kode yang diam-diam bergantung pada zona waktu perangkat ketahuan.
- Menambah migrasi: jalankan juga uji di atas; fungsi Edge (Deno) belum punya tes otomatis.

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
| 8     | Sandi (password manager E2EE)                                                              | ✅     |
| 9     | Pemutar musik (opsional, Worker terpisah — tanpa basis data)                               | ✅     |
| 10    | Catatan (bebas atau ditempel ke tanggal, banyak per hari, tag/tautan/pin/pencarian)        | ✅     |
