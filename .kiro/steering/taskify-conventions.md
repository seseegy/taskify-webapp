# Konvensi Taskify

- Bahasa UI, komentar, dan dokumentasi: **Bahasa Indonesia**. Rute juga berbahasa Indonesia (`/tugas`, `/keuangan`).
- Zona waktu WIB, minggu dimulai Senin, mata uang IDR (integer rupiah, tanpa float).
- Ikuti konvensi data di `docs/ARCHITECTURE.md`. Menambah kolom/tabel = ubah migrasi Supabase **dan** `powersync/sync-config.yaml` **dan** `src/db/schema.ts`. Tabel baru untuk klien juga wajib mendapat policy restrictive `mfa_aal2` (pola di migrasi `…_mfa_enforce.sql`), dan query Sync Streams-nya wajib memuat `AND auth.parameter('aal') = 'aal2'`.
- Semua baca/tulis lewat DB lokal (Drizzle/`useQuery`), bukan langsung ke Supabase. Setiap query wajib memfilter `deleted_at IS NULL`.
- Pakai helper `withMeta` / `touch` / `softDeleted` dari `src/db/mutations.ts` untuk menulis.
- Tanggal lokal pakai `todayLocal()`, `parseLocalDate()`, `toLocalDate()` dari `src/lib/date.ts`, jangan `new Date('YYYY-MM-DD')`.
- UI: tidak ada latar polos. Pakai `glass`, gradasi `bg-gradient-*`, dan token warna dari `docs/DESIGN.md`.
- Kode modul di `src/features/<modul>`; yang dipakai ≥2 modul naik ke `components/` atau `lib/`.
- "Hari ini" di komponen/hook pakai `useToday()` (`src/lib/useToday.ts`), bukan `todayLocal()` langsung, supaya ikut berganti saat tengah malam. `todayLocal()` hanya untuk event handler/aksi.
- Teks yang ditulis ke kolom ber-CHECK panjang dipotong dengan `clip(x, LIMITS.…)` (`src/lib/limits.ts`); samakan `LIMITS` dengan CHECK di migrasi.
- Aturan hitung statistik (Kalender, Review, heatmap, Beranda) harus sama: hanya tugas induk (`parent_id IS NULL`), tanpa transfer & transaksi hutang.
- Logika baru yang murni (parser, tanggal, recurrence, query) wajib disertai tes `*.test.ts`. Migrasi baru: tambahkan skenario di `supabase/tests/migrations.test.ts`.
- Sebelum commit: `pnpm check` (sudah termasuk tes) dan `pnpm build` harus lolos.
- Jangan pernah menaruh key R2 atau service_role Supabase di kode client / variabel `VITE_*`.
- **Data terenkripsi DEK brankas**: setiap jenis data baru yang dienkripsi dengan DEK Sandi WAJIB ikut dienkripsi ulang di `rekeyVaultRows` (`src/features/sandi/vault-rekey.ts`), dengan AAD berdomain sendiri. Kalau terlewat, ganti master password membuat data itu tidak bisa dibuka selamanya.
- **Sandi** (`src/features/sandi`): isi item HANYA boleh ditulis ke DB lewat `encryptItem` (E2EE). Jangan menambah kolom plaintext (judul/URL/username) di `pw_items`, jangan memasukkannya ke FTS/palette/tag, jangan menyimpan DEK/master password di storage mana pun, dan jangan mencatat (log) isi item. URL dari item wajib lewat `safeUrl` sebelum jadi `href`. Rahasia disalin lewat `copySecret` (auto-hapus), bukan `clipboard.writeText` langsung.
- Mengubah `powersync/sync-config.yaml` berarti HARUS di-deploy ulang manual di PowerSync Dashboard (tidak otomatis).
