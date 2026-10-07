# Konvensi Taskify

- Bahasa UI, komentar, dan dokumentasi: **Bahasa Indonesia**. Rute juga berbahasa Indonesia (`/tugas`, `/keuangan`).
- Zona waktu WIB, minggu dimulai Senin, mata uang IDR (integer rupiah, tanpa float).
- Ikuti konvensi data di `docs/ARCHITECTURE.md`. Menambah kolom/tabel = ubah migrasi Supabase **dan** `powersync/sync-config.yaml` **dan** `src/db/schema.ts`.
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
