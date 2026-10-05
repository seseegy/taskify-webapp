# Konvensi Taskify

- Bahasa UI, komentar, dan dokumentasi: **Bahasa Indonesia**. Rute juga berbahasa Indonesia (`/tugas`, `/keuangan`).
- Zona waktu WIB, minggu dimulai Senin, mata uang IDR (integer rupiah, tanpa float).
- Ikuti konvensi data di `docs/ARCHITECTURE.md`. Menambah kolom/tabel = ubah migrasi Supabase **dan** `powersync/sync-config.yaml` **dan** `src/db/schema.ts`.
- Semua baca/tulis lewat DB lokal (Drizzle/`useQuery`), bukan langsung ke Supabase. Setiap query wajib memfilter `deleted_at IS NULL`.
- Pakai helper `withMeta` / `touch` / `softDeleted` dari `src/db/mutations.ts` untuk menulis.
- Tanggal lokal pakai `todayLocal()`, `parseLocalDate()`, `toLocalDate()` dari `src/lib/date.ts`, jangan `new Date('YYYY-MM-DD')`.
- UI: tidak ada latar polos. Pakai `glass`, gradasi `bg-gradient-*`, dan token warna dari `docs/DESIGN.md`.
- Kode modul di `src/features/<modul>`; yang dipakai ≥2 modul naik ke `components/` atau `lib/`.
- Sebelum commit: `pnpm check` dan `pnpm build` harus lolos.
- Jangan pernah menaruh key R2 atau service_role Supabase di kode client / variabel `VITE_*`.
