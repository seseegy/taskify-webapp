# Design System Taskify

Prinsip: **tidak ada latar polos.** Semua didefinisikan di [`src/styles/index.css`](../src/styles/index.css).

## Tema

|       | Terang — "Aurora pagi"        | Gelap — "Nebula malam"          |
| ----- | ----------------------------- | ------------------------------- |
| Dasar | Lavender → pink → biru langit | Indigo pekat → ungu → biru laut |
| Blob  | Ungu muda, pink, cyan, kuning | Violet, magenta, teal, indigo   |
| Teks  | `#1e1b4b`                     | `#ede9fe`                       |

Latar = gradasi dasar + 4 blob radial **statis** + tekstur noise SVG halus. Blob sengaja tidak dianimasikan: lapisan latar yang bergerak memaksa seluruh layar digambar ulang setiap frame walau aplikasi diam (diukur ±50% CPU proses GPU saat idle). Lihat komentar `app-backdrop` di `src/styles/index.css`.

Tema disimpan per perangkat (`localStorage`), dan skrip di `index.html` memasangnya sebelum React render, jadi tidak ada kedipan putih.

## Utility

| Kelas                                                                                       | Pakai untuk                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `glass` / `glass-strong`                                                                    | Kartu, panel, input, nav (kaca semi-transparan; blur latar hanya di desktop) |
| `bg-gradient-brand`                                                                         | Aksi utama, logo (indigo → ungu → pink)                                      |
| `bg-gradient-{tasks,journal,notes,finance,vault,calendar,sandi,settings,music}`             | Identitas modul (ikon, header, sel aktif)                                    |
| `text-gradient-brand`                                                                       | Angka/judul penting (saldo, logo)                                            |
| `shine`                                                                                     | Kilau tipis di atas elemen bergradasi                                        |
| `text-fg`, `text-muted`, `bg-surface`, `border-line`, `text-primary/danger/success/warning` | Token warna yang otomatis menyesuaikan tema                                  |
| `bg-mod-*`                                                                                  | Warna solid modul (titik di kalender)                                        |

## Warna modul

| Modul    | Gradasi         | Titik kalender |
| -------- | --------------- | -------------- |
| Tugas    | violet → indigo | `#8b5cf6`      |
| Jurnal   | amber → rose    | `#f59e0b`      |
| Catatan  | lime → green    | `#65a30d`      |
| Keuangan | emerald → sky   | `#10b981`      |
| Vault    | cyan → blue     | `#06b6d4`      |
| Kalender | indigo → sky    | `#6366f1`      |
| Sandi    | rose → violet   | `#f43f5e`      |
| Musik    | fuchsia → ungu  | —              |

Musik **tidak punya** `--color-mod-music`. Token `bg-mod-*` ada khusus untuk titik aktivitas di
kalender dan legenda Review, dan musik tidak pernah muncul di sana — tidak ada "aktivitas musik"
yang tersimpan per tanggal, karena pemutar tidak menyentuh basis data sama sekali. Menambahkan
tokennya berarti menambah warna yang tidak dipakai siapa pun.

Gradasinya dipilih supaya masih jelas berbeda dari tetangga terdekatnya: Sandi mulai dari merah,
Tugas berakhir di biru, dan gradasi brand melewati tiga warna.

## Kontras warna

Teks normal wajib ≥ **4.5:1** (WCAG 1.4.3) di tema terang **dan** gelap. Pengukuran memakai kasus
terburuk, bukan satu sampel (tanpa mengandalkan blur, yang tidak ada di HP): setiap stop gradasi dasar dan setiap blob di bawah kaca
(`--surface` dan `--surface-strong`), serta token status sebagai teks di atas tint `bg-<token>/10`
dan `/15` (Badge, banner) dan `text-danger/80`.

| Token (terang) | Nilai     | Catatan                               |
| -------------- | --------- | ------------------------------------- |
| `danger`       | `#9f1239` | rose-800                              |
| `success`      | `#065f46` | emerald-800                           |
| `warning`      | `#92400e` | amber-800                             |
| `danger` gelap | `#fda4af` | rose-300; rose-400 gagal di atas tint |

Jangan mencerahkan token ini "supaya lebih cantik" tanpa mengukur ulang. Jalankan:

```bash
pnpm check:contrast   # membaca token langsung dari src/styles/index.css; ikut dalam `pnpm check`
```

Latar yang **tidak** ikut tema (mis. overlay di atas gambar) tidak boleh memakai token status;
pakai warna tetap seperti `bg-rose-800/90`.

## Komponen

`Button` (primary/secondary/ghost/danger), `Card`, `Input`/`Label`, `Badge`, `SegmentedControl`, `EmptyState`, `PageHeader`. Font: **Plus Jakarta Sans** (self-hosted, tetap tersedia offline).

## Tata letak

- **≥ 1024px**: sidebar kaca di kiri.
- **< 1024px**: header atas (pencarian, status sync, Vault, Sandi, Pengaturan; teks logo disembunyikan di bawah 400px agar muat) + bottom nav. **Kalender** berada di tengah dan menonjol sebagai pusat aplikasi.
- Safe-area iOS/Android dihormati (`env(safe-area-inset-*)`).

### Elemen mengapung di dasar layar

Jangan menulis `bottom-<angka>` sendiri untuk elemen `fixed` di dasar layar. Pakai variabel di
`src/styles/index.css`:

| Variabel                 | Untuk                                                           |
| ------------------------ | --------------------------------------------------------------- |
| `--stack-bottom`         | Kontrol milik halaman (FAB Keuangan)                            |
| `--stack-bottom-overlay` | Yang harus di atas segalanya (Toaster, UpdatePrompt) — ikut FAB |

Bilah pemutar musik adalah pengecualian, dan harus begitu: ia tidak bisa memakai
`--stack-bottom`, karena variabel itu sudah **memuat tingginya sendiri** (`--music-bar-h`) —
hasilnya bilah akan melayang satu tinggi bilah di atas tempatnya. Jadi bilah musik duduk di
`bottom-[var(--bottom-nav-h)]` dengan `pb-[var(--stack-gap)]` sendiri, dan **mengumumkan** tinggi
terukurnya ke `--music-bar-h` supaya yang lain menyingkir. Aturan umumnya: elemen yang menjadi
salah satu suku `--stack-bottom` memposisikan dirinya dari suku di bawahnya, bukan dari
jumlahnya.

Keduanya sudah menjumlahkan tinggi navigasi bawah (`--bottom-nav-h`, nol di `lg`), bilah musik
(`--music-bar-h`), dan FAB halaman (`--fab-h`), termasuk safe-area. Menambah elemen baru =
menambah satu suku di berkas itu, bukan mengarang angka baru lalu mencocokkannya dengan tangan.

Halaman yang punya FAB memasang penandanya di `document.documentElement` (`[data-fab]`), bukan di
`<body>` — `var()` di dalam custom property memakai nilai pada elemen tempat ia dideklarasikan,
jadi penanda di body tidak akan terbaca oleh variabel yang dideklarasikan di `:root`.
