# Design System Taskify

Prinsip: **tidak ada latar polos.** Semua didefinisikan di [`src/styles/index.css`](../src/styles/index.css).

## Tema

|       | Terang — "Aurora pagi"        | Gelap — "Nebula malam"          |
| ----- | ----------------------------- | ------------------------------- |
| Dasar | Lavender → pink → biru langit | Indigo pekat → ungu → biru laut |
| Blob  | Ungu muda, pink, cyan, kuning | Violet, magenta, teal, indigo   |
| Teks  | `#1e1b4b`                     | `#ede9fe`                       |

Latar = gradasi dasar + 4 blob radial yang bergerak pelan (22 dtk) + tekstur noise SVG halus. Animasi otomatis mati jika perangkat meminta _reduced motion_.

Tema disimpan per perangkat (`localStorage`), dan skrip di `index.html` memasangnya sebelum React render, jadi tidak ada kedipan putih.

## Utility

| Kelas                                                                                       | Pakai untuk                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `glass` / `glass-strong`                                                                    | Kartu, panel, input, nav (kaca semi-transparan + blur) |
| `bg-gradient-brand`                                                                         | Aksi utama, logo (indigo → ungu → pink)                |
| `bg-gradient-{tasks,journal,finance,vault,calendar,settings}`                               | Identitas modul (ikon, header, sel aktif)              |
| `text-gradient-brand`                                                                       | Angka/judul penting (saldo, logo)                      |
| `shine`                                                                                     | Kilau tipis di atas elemen bergradasi                  |
| `text-fg`, `text-muted`, `bg-surface`, `border-line`, `text-primary/danger/success/warning` | Token warna yang otomatis menyesuaikan tema            |
| `bg-mod-*`                                                                                  | Warna solid modul (titik di kalender)                  |

## Warna modul

| Modul    | Gradasi         | Titik kalender |
| -------- | --------------- | -------------- |
| Tugas    | violet → indigo | `#8b5cf6`      |
| Jurnal   | amber → rose    | `#f59e0b`      |
| Keuangan | emerald → sky   | `#10b981`      |
| Vault    | cyan → blue     | `#06b6d4`      |
| Kalender | indigo → sky    | `#6366f1`      |

## Komponen

`Button` (primary/secondary/ghost/danger), `Card`, `Input`/`Label`, `Badge`, `SegmentedControl`, `EmptyState`, `PageHeader`. Font: **Plus Jakarta Sans** (self-hosted, tetap tersedia offline).

## Ukuran ikon

Hanya lima ukuran (skala Tailwind, kelipatan 4px kecuali yang terkecil). Jangan memakai nilai arbitrer seperti `size-[18px]`.

| Kelas      | Piksel | Pakai untuk                                                         |
| ---------- | ------ | ------------------------------------------------------------------- |
| `size-3`   | 12     | Tanda status mungil (centang kecil, panah di baris transaksi)       |
| `size-3.5` | 14     | Ikon di samping teks `text-xs` (chip, metadata, tombol kecil)       |
| `size-4`   | 16     | Ikon di samping teks `text-sm` dan di dalam `Button` (default)      |
| `size-5`   | 20     | Ikon navigasi, ikon kategori ukuran `md`, ikon di dalam ubin        |
| `size-6`   | 24     | Ikon menonjol (tombol tengah Kalender, `EmptyState`, kategori `lg`) |

Ikon dekoratif di samping teks yang terlihat harus `aria-hidden` (lucide sudah melakukannya otomatis bila tidak diberi `aria-label`/`title`).

## Teks kecil

Ukuran teks terkecil adalah `text-xs` (12px). Jangan memakai `text-[10px]`/`text-[11px]`. Untuk membuat teks lebih redup, pakai warna (`text-muted`), bukan `opacity-*` — opacity menurunkan kontras di bawah 4.5:1.

## Tata letak

- **≥ 1024px**: sidebar kaca di kiri.
- **< 1024px**: header atas (status sync, Vault, Pengaturan) + bottom nav. **Kalender** berada di tengah dan menonjol sebagai pusat aplikasi.
- Safe-area iOS/Android dihormati (`env(safe-area-inset-*)`).
