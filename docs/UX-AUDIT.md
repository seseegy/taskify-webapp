# Audit UI/UX & Aksesibilitas — Taskify

Tanggal: 6 Okt 2026 · Metode: skill `ui-ux-pro-max` (UX guidelines, WCAG 2.2, stack React) + tinjauan kode seluruh `src/` + hitung kontras token.
Status: **hanya audit, belum ada kode yang diubah.**

## Ringkasan

Fondasinya sudah kuat: `<dialog>` native, `:focus-visible` global, `prefers-reduced-motion`, `lang="id"`, label `aria-label` di hampir semua tombol ikon, undo toast + soft-delete, `tabular-nums` + `Intl id-ID` untuk nominal, dan empty state di semua modul. Masalah terbesarnya ada di empat area:

1. **Kontras di atas kaca/gradasi**: `success`/`warning` mode terang, placeholder `/50–/70`, dan teks putih di atas gradasi modul.
2. **Target sentuh kecil**: checkbox tugas 20–24px, heatmap 12px, bar harian ±7px, tombol hapus chip 12px.
3. **Pola ARIA komposit yang tidak lengkap**: grid kalender/heatmap, combobox palette & TagPicker, nama dialog.
4. **Ketahanan data**: rantai autosave jurnal bisa macet diam-diam.

## Kontras token (dihitung di atas kaca ≈ putih 55% di atas lavender)

| Token                                           | Terang      | Gelap  | Catatan                                    |
| ----------------------------------------------- | ----------- | ------ | ------------------------------------------ |
| `muted`                                         | 6.1 ✅      | 6.8 ✅ |                                            |
| `danger`                                        | 4.35 ⚠️     | 6.1 ✅ | sedikit di bawah 4.5 untuk teks kecil      |
| `success`                                       | **3.49 ❌** | 8.6 ✅ | "Tersimpan", nominal pemasukan             |
| `warning`                                       | **2.95 ❌** | 9.8 ✅ | banner sampah, BudgetBar "perlu perhatian" |
| `muted/70`                                      | **3.18 ❌** | —      | semua placeholder                          |
| `muted/50`                                      | **2.16 ❌** | 2.7 ❌ | nomor baris kode, placeholder MoneyInput   |
| Putih di `bg-gradient-brand`                    | 3.5–4.0 ❌  |        | teks tombol primary `text-sm` (butuh 4.5)  |
| Putih di gradasi finance/vault/calendar         | 2.1–2.5 ❌  |        | ikon putih (butuh 3:1 non-teks)            |
| Putih di amber-400 (mood "Biasa", badge jurnal) | **1.67 ❌** |        |                                            |

**Saran:** mode terang pakai `--success: #047857`, `--warning: #b45309`, `--danger: #be123c`. Placeholder minimal `text-muted` (tanpa opacity). Gelapkan stop gradasi (mis. `emerald-600 → sky-600`, `amber-500 → rose-600`), atau pakai teks gelap di atas amber/lime.

## Temuan per prioritas

### 🔴 Critical

| #   | Lokasi                                                           | Masalah                                                                                                                                                  | Perbaikan                                                                                                                                                                 |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `journal/components/JournalEditor.tsx:85-106`                    | Rantai `chainRef.then(...)` tanpa `catch`. Begitu satu simpan gagal, **semua simpan berikutnya dilewati diam-diam** dan status tertahan di "Menyimpan…". | `try/catch` di dalam rantai, tambah state `error` + "Gagal menyimpan · Coba lagi", dan flush saat `pagehide`/`visibilitychange`.                                          |
| C2  | `finance/components/Charts.tsx:88-107` (DailyBars)               | ±31 `<button>` tanpa nama di dalam `role="img"`, lebar target ±7px, nilainya hanya ada di `title` (hover).                                               | Bar dibuat non-interaktif dengan ringkasan teks + daftar "per hari", atau `role="group"` dengan `aria-label="5 Okt: Rp 25.000"` per bar dan area sentuh yang lebih besar. |
| C3  | `finance/components/TransactionSheet.tsx:140` + `MoneyInput.tsx` | Field nominal (input terpenting) tidak punya label. Error tidak ditautkan (`aria-describedby`) dan tidak diumumkan.                                      | Tambah prop `aria-label`/`id`+`<Label>`, beri `id` pada pesan error lalu `aria-describedby`, dan `role="alert"` saat invalid.                                             |
| C4  | `vault/VaultPage.tsx:56-65`                                      | Tombol "+" di HP hanya ikon, tanpa `aria-label`.                                                                                                         | `aria-label={tab==='snippet'?'Snippet baru':'Project baru'}`.                                                                                                             |
| C5  | `tags/TagPicker.tsx:98`                                          | `onBlur → setTimeout(close,150)`: saat Tab ke saran, list hilang sehingga **pengguna keyboard tidak bisa memilih saran**. Tombol hapus chip ±12px.       | Pola combobox (panah + `aria-activedescendant`), tutup hanya jika fokus keluar container (`relatedTarget`), area sentuh tombol X ≥ 24px.                                  |
| C6  | `components/ui/Sheet.tsx:47,83`                                  | Semua dialog tidak punya nama aksesibel.                                                                                                                 | `useId()`, lalu `id` di judul + `aria-labelledby` di `<dialog>`.                                                                                                          |

### 🟠 High

| #   | Lokasi                                                     | Masalah                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | `tasks/components/TaskCheckbox.tsx:30`                     | Aksi utama aplikasi berukuran 20px (`sm`, gagal WCAG 2.5.8) / 24px (`md`). Perbesar area sentuh dengan `before:absolute before:-inset-2.5`.                                                                             |
| H2  | `tasks/components/TaskRow.tsx:105-111`                     | `div role="button"` membungkus checkbox & tombol "Pulihkan" (kontrol bersarang), dan Space tidak ditangani. Jadikan judul sebuah `<button>` dan checkbox sibling-nya.                                                   |
| H3  | `TaskRow.tsx:62-85`                                        | Chip ikon saja (Berulang, Pengingat, Catatan) tanpa teks `sr-only`.                                                                                                                                                     |
| H4  | `calendar/CalendarPage.tsx:203-258`                        | `role="grid"` tanpa `row`/`columnheader`, tanpa navigasi panah (35–42 Tab stop). `aria-label` hanya berisi tanggal sehingga aktivitas tidak terbaca, dan tidak ada `aria-current="date"`.                               |
| H5  | `review/ActivityHeatmap.tsx:55-84`                         | Grid tidak valid, 182 Tab stop, sel 12–14px, intensitas hanya warna. Lebih baik `role="img"` + ringkasan + tabel alternatif.                                                                                            |
| H6  | `tasks/components/TaskDetailSheet.tsx:81`                  | Mode sampah memakai `pointer-events-none`, jadi field **masih bisa diedit lewat keyboard**. Pakai `inert` / `<fieldset disabled>`.                                                                                      |
| H7  | `search/CommandPalette.tsx:261-349`                        | Tidak ada `role="combobox"`, `aria-activedescendant`, atau `aria-controls`. Isi `listbox` tidak valid (`<p>` header, opsi bisa di-Tab), dan Tab dibajak saat mode catat cepat.                                          |
| H8  | `lock/LockScreen.tsx` + `LockGate.tsx`                     | Tidak ada input asli (tidak bisa paste/password manager/`inputMode`). Fokus hilang ke `<body>` di belakang `inert`. `role="alert"` mengumumkan ulang hitung mundur tiap detik.                                          |
| H9  | `app/router.tsx`, `App.tsx`                                | Tanpa `errorElement`/error boundary (layar bawaan berbahasa Inggris / layar putih), tanpa `document.title` per halaman, tanpa skip link, fokus tidak dipindah saat ganti rute, tanpa `lazy()` (JSZip ikut bundle awal). |
| H10 | `MoneyInput.tsx:60`                                        | `inputMode="decimal"` membuat sufiks "25rb / 1,5jt" yang diiklankan tidak bisa diketik di HP.                                                                                                                           |
| H11 | `TransactionSheet.tsx:90-91,291`, `PlanningDialogs.tsx`    | Validasi hanya lewat toast + tombol submit disabled tanpa alasan.                                                                                                                                                       |
| H12 | `finance/components/PlanningDialogs.tsx:132-141`           | Hapus anggaran tanpa konfirmasi dan tanpa undo.                                                                                                                                                                         |
| H13 | `components/ui/toast-store.ts:24`                          | Undo toast hilang setelah 5 detik tanpa jeda saat hover/fokus (WCAG 2.2.1), padahal itu satu-satunya pengaman. Toaster `bottom-28` juga menutupi FAB keuangan.                                                          |
| H14 | `journal/components/MoodChart.tsx`                         | Hanya `aria-label` statis; titik ±7px dengan tooltip hover; gradasi merah→hijau tanpa label sumbu.                                                                                                                      |
| H15 | `finance/tabs/PlanningTabs.tsx:180-191`                    | Nominal transaksi berulang tanpa tanda +/−, sehingga pemasukan vs pengeluaran hanya dibedakan warna.                                                                                                                    |
| H16 | `JournalEditor.tsx` (judul, tanggal), `MarkdownEditor.tsx` | `outline-none` + `focus:ring-0` sehingga tidak ada indikator fokus yang terlihat.                                                                                                                                       |

### 🟡 Medium

- **Status hanya lewat warna:**
  - prioritas (ring checkbox);
  - overdue (`text-danger`);
  - "hari ini" (kalender, WeekStrip);
  - project aktif (VaultPage);
  - file terpilih (ZipViewer);
  - versi terbaru;
  - opsi kunci otomatis (PinSettings).
- **Radio tanpa navigasi panah / roving tabindex:** `SegmentedControl`, prioritas, kategori, mood, Color/IconPicker. Kategori & mood juga bisa di-_deselect_ dengan klik ulang, yang bukan perilaku radio.
- **Progress tanpa `role="progressbar"`:** subtask, BudgetBar, unggahan vault & lampiran, kuota R2.
- **Target 24–36px pada aksi mobile:**
  - tombol header `size-9`;
  - `size-7` "Daftar baru";
  - MonthSwitcher `size-8`;
  - "Kelola/Semua" (±20px);
  - "Kosongkan" jurnal (±16px);
  - tombol X batal unggah / di LinksPanel / ZipViewer (16–22px).
- **Tanpa skeleton loading** (`return null` atau empty state berkedip):
  - TasksPage;
  - FocusCard (muncul "Semua beres 🎉" padahal data belum dimuat);
  - TransactionsTab;
  - JournalPage;
  - TrashPage.
- **Aksesibilitas:**
  - `aria-label` di `<div>` generik diabaikan (ActivityDots, titik PIN);
  - CopySnippet `aria-label` menimpa teks visible (WCAG 2.5.3);
  - ZipViewer folder tanpa `aria-expanded`.
- **Teks bantuan hanya di placeholder:**
  - sintaks QuickAdd;
  - bantuan Markdown;
  - contoh catat cepat.
- **Label `aria-label` Inggris di picker:**
  - warna (`"emerald"`);
  - ikon (`"piggy-bank"`).
- **Daftar panjang tanpa virtualisasi:** Semua/Selesai/Sampah tugas, transaksi.
- **Hover-only:**
  - detail SyncStatus & kuota R2 hanya di `title`;
  - tombol hapus subtask / lepas tautan `opacity-60` tanpa `focus-visible:opacity-100`.

### ⚪ Low

- 25 pemakaian `text-[10px]`/`text-[11px]`, termasuk label bottom nav, sumbu chart, sel kalender, dan chip tag.
- `opacity-40/60/75` pada teks (hari di luar bulan, baris dijeda/lunas/virtual).
- Emoji di copy (✨ 🎉) tanpa `aria-hidden`.
- Ukuran ikon campur (`size-3`/`3.5`/`4`/`[18px]`). Sebaiknya ditetapkan sebagai token.
- `avg.toFixed(1)` menghasilkan "3.5" (harusnya "3,5"). Fallback "1 bulan lalu" salah (`JournalInsights.tsx:103`).
- `UpdatePrompt` memakai `role="alert"` untuk pesan tidak mendesak. Toaster punya live region bersarang (bisa diumumkan dobel).
- Tombol debug `console.log` ikut ke produksi (`SettingsPage.tsx:177`).
- Login tanpa toggle tampilkan sandi. `window.confirm` tidak serasi dengan desain kaca.
- Animasi blob latar `filter: blur(40px)` + banyak `backdrop-filter` bisa berat di HP low-end. Pertimbangkan mematikan blob saat baterai hemat atau di `glass` bertingkat.

## Urutan perbaikan yang disarankan

1. **Sprint 1 (fondasi, dampak luas):**
   - token kontras;
   - `Sheet` `aria-labelledby`;
   - area sentuh TaskCheckbox;
   - perbaikan TaskRow;
   - autosave jurnal (C1);
   - label MoneyInput;
   - `aria-label` tombol + Vault;
   - durasi/pause undo toast.
2. **Sprint 2 (pola komposit):**
   - combobox (palette, TagPicker);
   - grid kalender + heatmap;
   - LockScreen sebagai dialog + input tersembunyi;
   - radio roving di `SegmentedControl` (otomatis memperbaiki banyak tempat).
3. **Sprint 3 (shell & polish):**
   - `errorElement`, `document.title`, skip link, fokus rute, `lazy()`;
   - skeleton loading;
   - chart text alternative;
   - progressbar;
   - teks kecil → minimal 12px.
