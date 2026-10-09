# Rancangan: pemutar musik di Taskify

Rancangan UI/UX, backend, dan keamanan untuk memasang pemutar musik
([`seseegy/music-taskify`](https://github.com/seseegy/music-taskify)) ke dalam Taskify.

**Kontrak API-nya ada di dokumen terpisah:** [`music-taskify/docs/API.md`](https://github.com/seseegy/music-taskify/blob/main/docs/API.md).
Dokumen ini tentang **cara memasangnya di sini** — bukan mengulang kontrak API.

> **Status:** tahap 1–6 selesai. Tahap 1–3 (Worker jadi REST API, autentikasi JWT, deploy) ada di
> repo `music-taskify`; **tahap 4 (CSP + variabel tumpukan bawah), 5 (mesin antrean + tipe data),
> dan 6 (klien REST + JWT) sudah dikerjakan di repo ini.** Tahap 7–9 belum ada; tahap 10
> dibatalkan.

## Keputusan yang berubah setelah rancangan ini ditulis

| Hal                   | Keputusan                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Radio**             | **Tidak dibawa.** Hanya cari lagu lalu putar. Tab "Radio" dan `stations.ts`/`radio-core.ts` batal dipindahkan                                                                       |
| **Lirik**             | **Ikut.** Hampir gratis — `/v1/track` yang dipanggil tiap lagu sudah mengembalikan `lyricsId`                                                                                       |
| **Base URL Worker**   | `https://music-taskify.rosdiyttaa.workers.dev` (bukan `…-api…` seperti di `wrangler.toml`), lewat `VITE_MUSIC_API_URL` yang **opsional** — kosong = pintu masuk musik disembunyikan |
| **JWT Supabase**      | Sudah **asimetris**. `SUPABASE_JWT_SECRET` tidak diperlukan dan tidak boleh disetel                                                                                                 |
| **Kontrol OS**        | `mediaSession` action handler ditambahkan (tidak ada di rancangan asli) agar bisa dikontrol dari layar kunci                                                                        |
| **Geser posisi lagu** | Tetap tidak mungkin (hulu tidak melayani `Range`). Tidak akan dibuat bilah yang tampak bisa digeser                                                                                 |

**Konsekuensi membuang radio yang perlu diingat:** radio tadinya satu-satunya cadangan saat
layanan konverter mati — dan tabel [Risiko](#risiko) menilai kemungkinan itu **"Tinggi"**.
Sekarang bila konverter mati, yang bisa dilakukan hanya menampilkan pesan error yang jelas.

---

## Daftar isi

- [Keputusan utama](#keputusan-utama)
- [Batasan nyata yang membentuk rancangan ini](#batasan-nyata-yang-membentuk-rancangan-ini)
- [Bagian 1 — UI/UX](#bagian-1--uiux)
- [Bagian 2 — Backend](#bagian-2--backend)
- [Bagian 3 — Keamanan](#bagian-3--keamanan)
- [Rencana kerja](#rencana-kerja)
- [Risiko](#risiko)
- [Yang belum bisa saya pastikan](#yang-belum-bisa-saya-pastikan)

---

## Keputusan utama

| #   | Keputusan                                                     | Alasan singkat                                                                                                                   |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **UI pindah ke repo ini**, `music-taskify` jadi REST API saja | Yang sering disentuh adalah tampilan & penempatan; itu jauh lebih enak kalau menyatu dengan aplikasi                             |
| 2   | **Bilah tipis + `Sheet`**, bukan panel besar permanen         | Sidebar sudah kehabisan tinggi dan header mobile sudah kehabisan lebar — terukur, bukan perasaan                                 |
| 3   | **Pintu masuk lewat CommandPalette**                          | Satu-satunya tempat menambah fitur dengan ongkos ruang **nol**                                                                   |
| 4   | **Autentikasi pakai JWT Supabase, bukan token bundel**        | Karena privat dan khusus aplikasi ini, identitas penggunanya sudah ada. Token bundel bisa dibaca siapa pun yang membuka aplikasi |
| 5   | **Satu variabel CSS untuk tumpukan bawah**                    | Offset Toaster/UpdatePrompt/FAB sekarang angka literal yang dikoordinasi manual; menambah bilah akan menabraknya                 |
| 6   | **Format audio `m4a`**                                        | 3,31 MB vs 8,22 MB mp3 — 60% lebih hemat, dan didukung Safari/iOS                                                                |
| 7   | **Timer Pomodoro tidak dibawa**                               | Sudah ada modul produktivitas sendiri di Taskify; menambah timer kedua membingungkan                                             |

---

## Batasan nyata yang membentuk rancangan ini

Semua angka di bawah dari kode yang ada sekarang, bukan perkiraan.

### Sidebar desktop: tidak ada ruang vertikal

`AppShell.tsx:103` — `<aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col p-4 lg:flex">`.
Lebar bersih kartu kaca di dalamnya ~256px. Komentar di `AppShell.tsx:110-112` mencatat
masalah yang sudah pernah terjadi:

> "sidebar setinggi h-dvh, dan 9 menu + logo + pencarian + footer butuh ~765px. Di laptop
> 1366x768 (viewport ~650px) menu terakhir (Sandi, Pengaturan) terpotong dan tidak bisa
> diklik sama sekali."

Solusinya saat itu: `nav` jadi bisa digulir (`min-h-0 flex-1 overflow-y-auto`).

**Konsekuensi:** apa pun yang ditambahkan ke sidebar **mengambil tinggi dari area menu yang
sudah sempit.** Jadi pemutar **tidak** ditaruh di sidebar.

### Header mobile: tidak ada ruang horizontal

`AppShell.tsx:161-169` menghitungnya eksplisit: logo 36 + search 36 + sync 36 + 4 tombol
36 + gap. Di 320px, ikon Review saja sudah lebih 18px — itu sebabnya ada breakpoint
arbitrer `min-[360px]` dan `min-[430px]`.

**Konsekuensi:** **tidak boleh** menambah ikon ke header mobile.

### Tumpukan bawah di mobile sudah ramai

| Elemen       | Posisi                                                        | z-index  | Berkas                        |
| ------------ | ------------------------------------------------------------- | -------- | ----------------------------- |
| Toaster      | `bottom-44` (176px) → `sm:bottom-28` → `lg:bottom-6`          | `z-[60]` | `ui/Toaster.tsx:20`           |
| UpdatePrompt | `bottom-24` (96px) → `lg:bottom-6`                            | `z-40`   | `layout/UpdatePrompt.tsx:31`  |
| BottomNav    | `bottom-0`, tinggi ~82px, tombol tengah menonjol 28px         | `z-30`   | `AppShell.tsx`                |
| FAB Keuangan | `bottom-28` (112px), kanan, `sm:hidden`, hanya di `/keuangan` | `z-20`   | `finance/FinancePage.tsx:126` |

Perhatikan tiga elemen ini **berpindah posisi di breakpoint yang berbeda-beda** (`sm` untuk
Toaster dan FAB, `lg` untuk Toaster dan UpdatePrompt). Jadi tumpukannya bukan satu susunan,
melainkan tiga susunan berbeda tergantung lebar layar — dan semuanya diatur angka literal
yang terpisah.

Komentar `Toaster.tsx:14-15` menyebut koordinasinya manual: _"Di HP (< sm) posisinya di
atas FAB 'Catat transaksi' (bottom-28 + size-14)"_.

**Tidak ada variabel bersama untuk tinggi tumpukan ini — semuanya angka literal.**
Menambah bilah pemutar di `bottom-24` akan **menabrak UpdatePrompt**, dan bug itu hanya
muncul saat ada update service worker. Itu jenis bug yang baru ketemu berbulan-bulan
kemudian.

### Yang bisa dipakai ulang

| Aset                                                            | Letak                                   | Dipakai untuk                                                                    |
| --------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| `Sheet` (`<dialog>` native)                                     | `ui/Sheet.tsx`                          | Panel pencarian/antrean/lirik — fokus terkunci, Esc, klik backdrop, sudah gratis |
| `CommandPalette`                                                | `features/search/CommandPalette.tsx`    | Pintu masuk, model `Item { section, icon, title, keywords, run }`                |
| `glass` / `glass-strong`                                        | `styles/index.css:166-181`              | Permukaan; `glass-strong` untuk yang mengapung                                   |
| Token tema                                                      | `styles/index.css` `@theme`             | `text-fg`, `text-muted`, `border-line`, `bg-surface`, `--primary`                |
| `bg-gradient-brand`                                             | `styles/index.css:183`                  | Aksen utama (indigo → purple → pink)                                             |
| `lucide-react`                                                  | seluruh aplikasi                        | **Semua** ikon. Tidak ada SVG inline                                             |
| Pola Zustand                                                    | `ui/toast-store.ts`, `confirm-store.ts` | Store singleton + API imperatif                                                  |
| `Button`, `Badge`, `EmptyState`, `SegmentedControl`, `Checkbox` | `ui/`                                   | Kontrol di dalam Sheet                                                           |

---

## Bagian 1 — UI/UX

### Prinsip

1. **Musik itu latar, bukan tujuan.** Taskify dipakai untuk kerja. Pemutar tidak boleh
   meminta perhatian, dan tidak boleh mengambil ruang dari pekerjaan.
2. **Nol ruang saat tidak dipakai.** Kalau tidak ada yang diputar, tidak ada apa-apa di layar.
3. **Jujur soal menunggu.** Lagu pertama butuh 12–28 detik. Itu tidak bisa disembunyikan,
   jadi harus dijelaskan — bukan ditutup spinner tanpa keterangan.
4. **Ikuti bahasa desain yang ada.** Tidak ada warna baru, tidak ada ikon di luar lucide.

### Anatomi: dua lapis saja

```
┌─ Lapis 1: BILAH MINI (selalu terlihat saat ada yang diputar) ─────────┐
│  [▶]  Monokrom                            [◀][▶]  [🔇] [━━━━○──]     │
│       Tulus · 3/16                                                     │
│  ▓▓▓▓▓▓▓▓░░░░░░░  Menyiapkan audio… 45%     ← hanya saat menyiapkan   │
└────────────────────────────────────────────────────────────────────────┘
        ↑ ketuk judulnya → buka lapis 2

┌─ Lapis 2: SHEET (dipanggil, tidak permanen) ──────────────────────────┐
│  [ Cari lagu ] [ Antrean (16) ] [ Lirik ] [ Radio ]   ← SegmentedControl│
│  ──────────────────────────────────────────────────────────────────── │
│  isi tab                                                               │
└────────────────────────────────────────────────────────────────────────┘
```

Semua yang berat — pencarian, antrean, lirik, pilih stasiun — ada di `Sheet`.
Bilah mini hanya: putar/jeda, lagu sekarang, lagu sebelum/berikutnya, bisu, volume.

**Kenapa begini:** `Sheet` sudah menangani fokus terkunci, Esc, dan klik backdrop. Membuat
panel sendiri berarti menulis ulang semua itu — dan di mobile `Sheet variant="side"` sudah
jadi bottom sheet `max-h-[88dvh]`, yang persis bentuk yang dibutuhkan.

### Penempatan — berbeda di desktop dan mobile, dengan alasan

#### Desktop (`lg` ke atas)

Bilah mini **menempel di dasar kolom konten**, bukan di sidebar:

```
fixed bottom-0 left-72 right-0  z-30   (hidden di bawah lg)
```

- Tidak mengambil tinggi sidebar yang sudah kritis.
- `main` mendapat `padding-bottom` tambahan saat bilah terlihat, supaya konten terakhir
  tidak tertutup.
- Bawah-tengah desktop sudah dipakai Toaster dan UpdatePrompt (`lg:bottom-6`), jadi
  keduanya perlu dinaikkan setinggi bilah — lihat [variabel tumpukan bawah](#satu-sumber-kebenaran-untuk-tumpukan-bawah).

Saat **tidak** ada yang diputar, bilah tetap ada di desktop dalam bentuk ramping berisi
tombol putar + tulisan "Musik". Di desktop ruangnya ada, dan pintu masuk yang terlihat
lebih baik daripada yang harus diingat.

#### Mobile (di bawah `lg`)

Bilah mini **hanya muncul saat ada yang diputar**, menempel di atas BottomNav:

```
fixed inset-x-3 bottom-[var(--stack-bottom)]  z-40
```

Saat tidak ada yang diputar: **tidak ada apa pun**. Pintu masuknya CommandPalette.

Alasan asimetri ini: header mobile tidak punya sisa lebar, BottomNav sudah 5 item dengan
tombol tengah menonjol, dan pita 96–176px di atasnya sudah diperebutkan tiga elemen. Jadi
di mobile pemutar **harus** membayar ruang hanya saat benar-benar dipakai.

#### Satu sumber kebenaran untuk tumpukan bawah

Masalah yang harus diselesaikan dulu, sebelum menambah apa pun:

```css
/* styles/index.css */
:root {
  --bottom-nav-h: 0px; /* diisi 82px di bawah lg lewat media query */
  --music-bar-h: 0px; /* diisi oleh pemutar saat terlihat */
  --stack-bottom: calc(var(--bottom-nav-h) + var(--music-bar-h) + 0.75rem);
}
```

Lalu `Toaster`, `UpdatePrompt`, dan FAB Keuangan memakai `bottom-[var(--stack-bottom)]`
alih-alih `bottom-44` / `bottom-24` / `bottom-28`.

**Ini menyentuh tiga berkas yang sudah ada.** Saya sebut terus terang karena itu bukan
pekerjaan "pemutar musik" — tapi tanpa itu, bilah pemutar akan menabrak UpdatePrompt, dan
bug itu hanya muncul saat ada update service worker.

**Peta z-index final:**

| Lapis                    | z                         | Catatan                                                      |
| ------------------------ | ------------------------- | ------------------------------------------------------------ |
| Progress bar rute        | `z-[65]`                  | sudah ada                                                    |
| Toaster                  | `z-[60]`                  | sudah ada                                                    |
| Sheet pemutar            | `z-50` (native top layer) | `<dialog>` selalu di atas                                    |
| **Bilah mini**           | **`z-40`**                | sejajar UpdatePrompt, tapi offset-nya tidak lagi bertabrakan |
| UpdatePrompt             | `z-40`                    | sudah ada                                                    |
| MobileHeader / BottomNav | `z-30`                    | sudah ada                                                    |
| FAB Keuangan             | `z-20`                    | sudah ada                                                    |

### Pintu masuk

**CommandPalette** (`Ctrl/Cmd+K`, atau `/`, atau tombol Search di header mobile) — section
baru `"Musik"`:

| Item           | `keywords`                         | Aksi                                                        |
| -------------- | ---------------------------------- | ----------------------------------------------------------- |
| Cari lagu      | `musik lagu putar play music cari` | buka Sheet tab "Cari lagu"                                  |
| Antrean        | `musik antrean queue daftar`       | buka Sheet tab "Antrean"                                    |
| Lirik lagu ini | `musik lirik lyrics teks`          | buka Sheet tab "Lirik" (disembunyikan bila tidak ada lirik) |
| Radio fokus    | `musik radio fokus ambient lofi`   | buka Sheet tab "Radio"                                      |
| Putar / Jeda   | `musik putar jeda pause stop`      | toggle langsung, tanpa membuka Sheet                        |

Ongkos ruang: **nol**. Dan di mobile ini otomatis dapat pintu masuk, karena tombol Search
di header sudah membuka palette yang sama.

**Tidak** menambah item ke `NAV_ITEMS` — sidebar sudah penuh dan BottomNav sudah 5 item.

### Keadaan dan apa yang dilihat pengguna

| Keadaan        | Bilah mini                                        | Status                               |
| -------------- | ------------------------------------------------- | ------------------------------------ |
| `idle`         | Desktop: ramping, tombol putar. Mobile: tidak ada | "Musik"                              |
| `preparing`    | Judul + bilah progres determinate                 | "Menyiapkan audio… 45%"              |
| `playing`      | Judul + artis + `3/16`                            | artis · posisi antrean               |
| `paused`       | Sama, ikon jadi putar                             | artis                                |
| `awaitingMore` | Judul lagu terakhir                               | "Mencari lagu lanjutan…"             |
| `error`        | Judul + tombol "Coba lagi"                        | pesan dari API, langsung ditampilkan |
| offline        | Bilah tetap, kontrol dinonaktifkan                | "Tidak ada koneksi"                  |

Pesan error dari API sudah berbahasa Indonesia dan **dirancang untuk ditampilkan langsung**
— tidak perlu diterjemahkan ulang di sini.

### Menunggu 12–28 detik: ini masalah UX, bukan masalah teknis

Yang tidak boleh: spinner tanpa keterangan. Lima belas detik dengan spinner = pengguna
mengira aplikasinya macet.

Rancangannya:

1. **Judul lagu tampil seketika**, sebelum audionya siap. Pengguna tahu klikannya sampai.
2. **Bilah progres determinate** dengan angka, dari `/v1/stream/poll`. Bergerak = hidup.
3. **Angka tidak boleh mundur.** Hulu kadang melaporkan progres turun; tampilkan nilai
   tertinggi yang pernah dilihat.
4. **Prefetch** menyiapkan lagu berikutnya selagi yang sekarang berbunyi — jadi hanya lagu
   **pertama** yang terasa menunggu. Ini yang membuat fiturnya layak dipakai; tanpa itu
   setiap lagu perlu ditunggu belasan detik.
5. **Tulis apa adanya di UI**: tab "Cari lagu" memuat satu baris keterangan bahwa lagu
   pertama perlu ±15 detik. Harapan yang dikelola lebih baik daripada kejutan.
6. **Radio sebagai jalan cepat.** Kalau yang dibutuhkan cuma "ada suara sekarang", radio
   berbunyi 1–3 detik. Dua sumber ini tidak pernah berbunyi bersamaan.

### Aksesibilitas

| Hal                              | Rancangan                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                           | Satu `role="status"` dengan `aria-live="polite"`. **Hanya saat `preparing`/`reconnecting`** — kalau selalu polite, pembaca layar mengumumkan tiap pergantian lagu dan itu mengganggu |
| Progres                          | `role="progressbar"` + `aria-valuenow/min/max` + `aria-label="Menyiapkan audio"`                                                                                                     |
| Judul sedang diputar             | `<h3>` — memberi titik navigasi pembaca layar, dan membedakannya dari judul yang sama di daftar hasil                                                                                |
| Tombol ikon                      | Semua wajib `aria-label`; tombol mode (ulang/acak/bisu/lanjut-otomatis) wajib `aria-pressed`                                                                                         |
| Target sentuh                    | **≥44px di mobile.** Kontrol di `music-taskify` sekarang `size-8` (32px) — **harus diperbesar**, ini perbaikan nyata bukan sekadar pemindahan                                        |
| Daftar hasil & antrean           | `aria-current="true"` pada baris yang sedang diputar                                                                                                                                 |
| Fokus                            | Ditangani `Sheet` (native `<dialog>`). Setelah Sheet ditutup, fokus kembali ke pemicunya                                                                                             |
| Pintasan papan tunggal           | **Tidak ada.** `/` sudah dipakai palette, dan spasi/panah akan bertabrakan dengan pengetikan. Kontrol hanya lewat tombol dan palette                                                 |
| `prefers-reduced-motion`         | Sudah ada blok global di `styles/index.css` yang mematikan animasi. Spinner harus ikut: ganti jadi bilah progres statis                                                              |
| Warna bukan satu-satunya penanda | Lagu aktif ditandai ikon `▶` **dan** latar, bukan hanya warna                                                                                                                        |

### Tema terang dan gelap

Kelas keras dari `music-taskify` (`bg-white/5`, `text-white/60`, `bg-violet-500`,
`border-white/10`) **dirancang untuk latar gelap saja** dan akan rusak di tema terang.

Pemetaan yang harus dilakukan:

| Dari                                              | Jadi                             |
| ------------------------------------------------- | -------------------------------- |
| `bg-white/5 border-white/10 backdrop-blur`        | `glass-strong` (bilah mengapung) |
| `text-white`                                      | `text-fg`                        |
| `text-white/60`, `text-white/50`, `text-white/40` | `text-muted`                     |
| `bg-violet-500` (tombol utama)                    | `bg-gradient-brand` + `shine`    |
| `bg-white/10 hover:bg-white/20`                   | `glass` + `hover:text-fg`        |
| `bg-rose-500/20 text-rose-100`                    | `bg-danger/15 text-danger`       |
| `bg-amber-400/20 text-amber-200`                  | `bg-warning/15 text-warning`     |

> Nilai `danger`/`success`/`warning` dipilih agar kontrasnya ≥4.5:1 **termasuk sebagai teks
> di atas tint `/10..15`** (komentar `styles/index.css:85-88`). Jangan dicerahkan tanpa
> mengukur ulang.

Slider volume sudah digambar ulang sepenuhnya di CSS global (`input[type=range]`), jadi
volume akan langsung sesuai tema tanpa kerja tambahan.

### Ikon: ganti semua ke lucide

`music-taskify` memakai SVG inline; di sini **tidak ada SVG inline** sama sekali.

| Fungsi               | lucide                                                    |
| -------------------- | --------------------------------------------------------- |
| Putar / Jeda         | `Play` / `Pause`                                          |
| Lagu sebelum/berikut | `SkipBack` / `SkipForward`                                |
| Ulang / ulang satu   | `Repeat` / `Repeat1`                                      |
| Acak                 | `Shuffle`                                                 |
| Volume / bisu        | `Volume2` / `VolumeX`                                     |
| Lanjut otomatis      | `Infinity`                                                |
| Musik / radio        | `Music` / `Radio`                                         |
| Antrean              | `ListMusic`                                               |
| Lirik                | `FileText`                                                |
| Menyiapkan           | `Loader2` (`animate-spin`, dimatikan oleh reduced-motion) |

### Struktur berkas di repo ini

```
src/features/music/
  types.ts                bentuk data dari API (Thumb, Song, Track)
  queue-core.ts           mesin keadaan antrean, murni (dari music-taskify, teruji)
  queue-core.test.ts
  MusicBar.tsx            bilah mini (desktop + mobile) — titik pasang di AppShell
  MusicSheet.tsx          Sheet dengan 3 tab
  SearchTab.tsx           pencarian + "Muat lagi"
  QueueTab.tsx            antrean + lompat lagu
  LyricsTab.tsx           lirik
  music-store.ts          store Zustand untuk Sheet (pola toast-store)
  useMusicPlayer.ts       antrean + prefetch + elemen <audio> + mediaSession
  music-view.ts           durasi, waktu, dan baris status — murni
  music-view.test.ts
  api-client.ts           klien REST + ambil JWT Supabase
  api-client.test.ts
  music-palette.ts        item untuk CommandPalette
  music-palette.test.ts
```

Tanpa `RadioTab.tsx`, `useRadio.ts`, `radio-core.ts`, dan `stations.ts`: radio
[tidak dibawa](#keputusan-yang-berubah-setelah-rancangan-ini-ditulis).

`MusicBar` dipasang di `AppShell`, **bukan** di dalam halaman — router meng-unmount halaman
saat pindah menu dan itu akan memutus musik di tengah lagu. Pola yang sama seperti
`Toaster` dan `ConfirmDialog`.

`queue-core.ts` dipindahkan **apa adanya** beserta tesnya (60 tes) — satu-satunya perubahan
adalah jalur impor tipe `Song`. Perilakunya sudah terkunci tes itu, jadi tidak ada alasan
menulis ulang.

Tipe `Track` di repo asal punya field `lyrics`; field itu **dibuang** di sini karena
`/v1/track` tidak pernah mengirimnya — teks liriknya datang dari `/v1/lyrics`. Tipe album,
playlist, dan artis juga tidak dibawa: lingkupnya "cari lagu lalu putar", jadi tipe itu akan
jadi kode mati.

---

## Bagian 2 — Backend

### Pembagian repo

| Repo                   | Isi                                        | Deploy                         |
| ---------------------- | ------------------------------------------ | ------------------------------ |
| `music-taskify`        | Worker (REST API) + parser + fixture + tes | `wrangler deploy` → Cloudflare |
| `taskify-webapp` (ini) | Seluruh UI, antrean, prefetch, radio       | ikut deploy aplikasi           |

Parser pindah ke sisi **server**. Keuntungannya diukur: respons `/v1/track` 541 KB → 18 KB,
dan `/v1/search` 204 KB → 12 KB.

Ongkosnya jujur: perbaikan parser sekarang perlu **redeploy Worker**, bukan hanya deploy
frontend. YouTube suka mengubah bentuk responsnya, jadi ini akan terasa suatu hari.

### Alur data

```
Browser                          Worker                        Hulu
   │                                │                            │
   │ getSession() → JWT             │                            │
   │───── POST /v1/search ─────────►│                            │
   │      Bearer <JWT Supabase>     │ verifikasi JWT (JWKS)      │
   │                                │ cek cache tepi             │
   │                                │──── InnerTube search ─────►│
   │                                │◄─── 204 KB JSON mentah ────│
   │                                │ parse (0,95 ms)            │
   │◄───── 12 KB JSON rapi ─────────│ simpan ke cache            │
   │                                │                            │
   │───── POST /v1/stream/init ────►│──── konverter ────────────►│
   │◄───── { job }──────────────────│                            │
   │───── POST /v1/stream/poll ────►│  (ulangi tiap 1200 ms)     │
   │◄───── { progress: 45 } ────────│                            │
   │◄───── { url } ─────────────────│                            │
   │                                                             │
   │═════ GET audio LANGSUNG ke CDN konverter ══════════════════►│
                                     ↑ tidak lewat Worker
```

**Audio tidak diproksi lewat Worker.** 3–8 MB per lagu akan menghabiskan bandwidth Worker,
padahal browser bisa mengambilnya langsung (sudah diuji: tidak perlu `Referer`).

### Cache

| Endpoint                                  | TTL            | Kunci                        |
| ----------------------------------------- | -------------- | ---------------------------- |
| `/v1/search`                              | 600 s          | `filter` + `q` huruf kecil   |
| `/v1/track`                               | 600 s          | `videoId` + `limit`          |
| `/v1/album`, `/v1/playlist`, `/v1/lyrics` | 3600 s         | `browseId` / isi cursor      |
| `/v1/stream/*`                            | tidak di-cache | per-tugas, URL-nya sementara |

Memakai **Cache API Worker** (sisi server, kunci sintetis), bukan `Cache-Control: public`.
Alasannya di [bagian keamanan](#cache-tidak-boleh-publik).

### Kuota dan biaya

Paket gratis Cloudflare: 100.000 permintaan/hari, 10 ms CPU/permintaan, 50 subrequest/permintaan.

Satu jam mendengarkan ≈ 20 lagu ≈ **~60 permintaan** (search, track, init, ~15 poll per
lagu). Delapan jam kerja ≈ 500 permintaan/hari. **Aman jauh di bawah kuota** — dan ini
memang hanya untuk satu orang.

Ongkos CPU terberat terukur **1,90 ms dari 10 ms**.

### Pemakaian data pengguna

|               | Rancangan lama (mentah + mp3) | Rancangan ini (rapi + m4a) |
| ------------- | ----------------------------- | -------------------------- |
| Metadata/jam  | ~11 MB                        | ~0,4 MB                    |
| Audio/jam     | 164 MB                        | 66 MB                      |
| **Total/jam** | **~175 MB**                   | **~67 MB**                 |

---

## Bagian 3 — Keamanan

### Model ancaman: apa yang dilindungi dari siapa

Ini aplikasi **pribadi satu pengguna**. Yang dilindungi **bukan** data musik — itu tidak
rahasia. Yang dilindungi:

| Aset                     | Ancaman                                   | Dampak kalau jebol                                  |
| ------------------------ | ----------------------------------------- | --------------------------------------------------- |
| Kuota konverter & Worker | Orang lain memakai API Anda               | Kuota habis, layanan konverter memblokir kunci Anda |
| Kunci API konverter      | Terbaca dari browser                      | Dipakai orang lain sampai diblokir                  |
| Worker sebagai proksi    | Dipakai memanggil InnerTube/URL sembarang | IP Worker Anda diblokir YouTube; SSRF               |
| Reputasi IP              | Dipakai menyalahgunakan YouTube           | Seluruh API mati                                    |

Yang **tidak** jadi ancaman di sini: data pengguna lain (tidak ada pengguna lain), dan
kebocoran isi musik (publik).

### Autentikasi: ganti token bundel dengan JWT Supabase

Rancangan sebelumnya memakai `APP_TOKEN` yang dibundel ke browser lewat
`VITE_MUSIC_API_TOKEN`. **Masalahnya nyata:** variabel `VITE_*` masuk ke bundel JavaScript,
jadi siapa pun yang membuka aplikasi bisa membacanya dari DevTools dan memakai API Anda
selamanya.

Karena API ini **privat dan khusus Taskify**, identitas penggunanya sudah tersedia.

```
Browser                                   Worker
  │                                          │
  │ supabase.auth.getSession()               │
  │ → session.access_token (JWT, ~1 jam)     │
  │                                          │
  │── Authorization: Bearer <JWT> ──────────►│
  │                                          │ 1. ambil JWKS Supabase (di-cache)
  │                                          │ 2. verifikasi tanda tangan
  │                                          │ 3. cek exp, iss, aud
  │                                          │ 4. cek sub ∈ ALLOWED_USER_IDS
  │◄─────────── 200 / 401 / 403 ─────────────│
```

**Kunci publiknya diambil dari endpoint JWKS Supabase:**

```
https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

Kunci privat tidak pernah meninggalkan server Supabase, dan verifikasi bisa dilakukan
**tanpa memanggil Supabase** setiap permintaan ([JWT Signing Keys, dokumentasi Supabase](https://supabase.com/docs/guides/auth/signing-keys)
— isi diparafrasekan untuk kepatuhan lisensi).

Rincian implementasi:

| Hal             | Rancangan                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Verifikasi      | `crypto.subtle` (WebCrypto, tersedia di Workers) atau `jose`. Tanpa panggilan jaringan per permintaan                   |
| Cache JWKS      | Di memori Worker + Cache API, TTL 1 jam. Kalau `kid` tidak dikenal → ambil ulang **sekali**, lalu tolak                 |
| Algoritma       | **Dipaku** ke `alg` dari JWKS (ES256/RS256). `alg: none` dan `HS256` **ditolak** — ini kelas kerentanan JWT yang klasik |
| Klaim wajib     | `exp` (belum lewat), `iss` = `https://<ref>.supabase.co/auth/v1`, `aud` = `authenticated`                               |
| Otorisasi       | `sub` harus ada di `ALLOWED_USER_IDS` (daftar UUID, dipisah koma). **Login saja tidak cukup**                           |
| Toleransi waktu | 60 detik, untuk jam perangkat yang sedikit melenceng                                                                    |

Kenapa `ALLOWED_USER_IDS` perlu padahal hanya Anda: kalau suatu hari proyek Supabase ini
dibuka untuk pendaftaran, tanpa daftar izin **setiap orang yang mendaftar** otomatis dapat
akses ke kuota konverter Anda.

#### Sisi klien: ambil token segar setiap permintaan

Mengikuti pola `connector.ts:37-53` yang sudah ada:

```ts
const {
  data: { session },
} = await supabase.auth.getSession();
if (!session) throw new MusicError('Sesi berakhir. Masuk ulang.');
headers.Authorization = `Bearer ${session.access_token}`;
```

**Jangan di-cache di variabel modul.** `autoRefreshToken: true` sudah aktif
(`lib/supabase.ts`), jadi `getSession()` selalu memberi token yang masih berlaku. Token
yang disimpan sendiri akan kedaluwarsa di tengah sesi mendengarkan dan menghasilkan 401
yang membingungkan.

Semua yang ada di dalam router dijamin `signed_in` (`App.tsx:18-47`), jadi di `AppShell`
sesi selalu tersedia.

#### Konsekuensi yang harus diterima

| Konsekuensi                                        | Penilaian                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Pemutar perlu login                                | Sudah begitu — seluruh aplikasi di belakang `AuthGate`                                                      |
| Perlu `project-ref` Supabase di konfigurasi Worker | Bukan rahasia, ada di bundel aplikasi juga                                                                  |
| XSS di aplikasi bisa mencuri JWT                   | Benar, tapi XSS sudah berarti akses penuh ke data Taskify. Musik bukan aset paling berharga di skenario itu |

### CORS

```toml
ALLOWED_ORIGINS = "https://<domain-taskify-anda>"
```

- Satu origin saja. `*` **hanya** untuk `wrangler dev` lokal.
- Origin tidak terdaftar → **403 sebelum** menyentuh hulu, jadi tidak membuang kuota.
- `Vary: Origin` selalu dikirim.

CORS **bukan** lapisan keamanan utama — ia hanya mencegah browser lain memakai API, dan
tidak menghentikan `curl`. Yang menghentikan `curl` adalah JWT.

### CSP: tanpa ini audionya diblokir diam-diam

CSP sekarang (`public/_headers`) **tidak punya `media-src`**, jadi jatuh ke
`default-src 'self'` — artinya **semua audio dari domain luar diblokir.** Gejalanya: tidak
ada suara, gambar album kosong, tanpa pesan error yang jelas di UI.

Dan `img-src 'self' data: blob:` tidak mengizinkan `https:`, jadi gambar album juga mati.

Perubahan yang diperlukan:

```
connect-src 'self' https: wss:;      ← sudah longgar, Worker sudah tercakup

media-src   https://*.savenow.to https://*.lbserver.xyz
            https://ice1.somafm.com https://icecast.radiofrance.fr
            https://stream.radioparadise.com;

img-src     'self' data: blob:
            https://i.ytimg.com https://yt3.googleusercontent.com
            https://yt3.ggpht.com;
```

Catatan:

- Host audio konverter adalah **subdomain bernomor** (`ricky4.savenow.to`), jadi wildcard
  `*.savenow.to` memang perlu — menulis satu host tidak cukup.
- Ini juga berarti **radio belum pernah benar-benar diuji di aplikasi ini.** Klaim "radio
  berbunyi 1–3 detik" di README `music-taskify` hanya terbukti di halaman demo yang **tidak
  punya CSP**. Di sini radio pun akan diblokir sampai `media-src` ditambahkan.
- `img-src` sengaja tidak dibuat `https:` terbuka — tiga host itu yang terpantau dari
  fixture asli. Kalau ada host lain muncul, tambahkan setelah dilihat, jangan diborong.

### Validasi masukan di Worker

| Masukan         | Aturan                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `videoId`       | Tepat 11 karakter `[A-Za-z0-9_-]`                                                                                                                      |
| `browseId`      | Hanya awalan yang dikenal: `MPREb_`, `VL`, `PL`, `OLAK5uy_`, `UC`, `MPLA`, `MPSP`, `MPLY`, `RDAMVM`, `RDCLAK`. `FEmusic_home` dan sejenisnya → **400** |
| `q`             | 1–200 karakter                                                                                                                                         |
| `filter`        | Daftar tertutup 5 nilai. Diperiksa dengan `hasOwnProperty`, **bukan** `in` — supaya `toString`/`constructor` tidak lolos                               |
| `format`        | Daftar tertutup: `m4a`, `mp3`, `opus`, `webm`                                                                                                          |
| `limit`         | 1–49                                                                                                                                                   |
| `cursor`, `job` | Buram, maks 512 karakter                                                                                                                               |

Tanpa pembatasan `browseId`, Worker jadi **proksi bebas ke seluruh InnerTube** — siapa pun
yang punya JWT bisa memakai IP Worker Anda untuk memanggil endpoint apa pun di YouTube.

### SSRF

`job` dan `cursor` berisi URL hulu yang disandikan buram. Saat dibuka:

1. Harus bisa di-parse sebagai URL.
2. `protocol` harus `https:`.
3. **`hostname`** harus ada di daftar izin.

Pemeriksaan pada `hostname` hasil parsing, bukan pencocokan string — supaya
`https://p.savenow.to@attacker.example/x` ditolak (hostname-nya `attacker.example`). Sudah
ada tesnya.

### Rahasia

| Rahasia                | Tempat                      | Catatan                                             |
| ---------------------- | --------------------------- | --------------------------------------------------- |
| `CONVERTER_API_KEY`    | `wrangler secret`           | **Tidak pernah** ke browser                         |
| `ALLOWED_USER_IDS`     | `wrangler secret`           | UUID bukan rahasia, tapi tidak perlu dipublikasikan |
| `SUPABASE_PROJECT_REF` | `[vars]` di `wrangler.toml` | Bukan rahasia                                       |
| ~~`APP_TOKEN`~~        | —                           | **Dihapus**, diganti JWT                            |

> **`CONVERTER_API_KEY` yang sekarang harus dianggap sudah bocor** — nilainya pernah lewat
> di percakapan. Ganti kalau layanannya mengizinkan.

### Cache tidak boleh publik

Respons API ini **tidak sensitif** (metadata musik publik). Tapi header
`Cache-Control: public` pada respons yang diautentikasi adalah kebiasaan buruk: proksi
bersama bisa menyimpannya, dan pola itu akan salah besar kalau suatu hari ada endpoint
yang per-pengguna.

Rancangan: pakai **Cache API Worker** (sisi server, kunci sintetis buatan sendiri) dan
kirim `Cache-Control: private, max-age=<ttl>` ke browser. Manfaat kecepatannya sama,
tanpa kebiasaan yang berisiko.

Dan **autentikasi diperiksa sebelum cache dibaca** — bukan sesudah. Urutan yang terbalik
akan membuat cache jadi jalan pintas melewati autentikasi.

### Pembatasan laju

Kalau JWT bocor (mis. lewat XSS), penyalahgunaan terbesar adalah menghabiskan kuota
konverter. Rancangan berlapis:

1. **Daftar izin pengguna** — sudah membatasi ke satu `sub`.
2. **Aturan rate limiting Cloudflare** pada route Worker — konfigurasi, bukan kode.
3. **Batas di dalam Worker**: `/v1/stream/init` adalah yang termahal (memicu konversi).
   Tolak kalau ada lebih dari N konversi per menit per `sub`.

> Poin 3 memerlukan penyimpanan status antar permintaan (KV atau Durable Object). **Belum
> saya rancang detailnya**, dan untuk satu pengguna manfaatnya kecil. Saya catat sebagai
> pekerjaan menyusul, bukan saya klaim sudah ada.

### Yang TIDAK dilindungi — terus terang

| Tidak terlindungi                                | Kenapa diterima                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| XSS di Taskify bisa mencuri JWT lalu memakai API | XSS sudah berarti akses penuh ke seluruh data Taskify. Musik bukan aset terburuk di skenario itu |
| Anda sendiri bisa menyalahgunakan kuota          | Ini aplikasi pribadi                                                                             |
| Layanan konverter bisa mati kapan saja           | Di luar kendali. Radio tetap jalan sebagai cadangan                                              |
| Pemakaiannya melanggar ToS YouTube               | **Tidak bisa diatasi secara teknis.** Pemakaian pribadi, jangan dipublikasikan sebagai layanan   |

---

## Rencana kerja

Dipecah supaya setiap langkah bisa diuji sendiri dan tidak ada PR raksasa.

| #      | Pekerjaan                                                                                                                          | Repo             | Bisa diuji dengan                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| 1      | Worker jadi REST API rapi: parser pindah ke server, paginasi cursor, `format`, perbaiki plafon antrean 15→49, tambah awalan `MPLY` | `music-taskify`  | `curl` + `verify-dev.sh` + tes                                        |
| 2      | Autentikasi JWT Supabase + JWKS + daftar izin `sub`, hapus `APP_TOKEN`                                                             | `music-taskify`  | tes unit (JWT palsu, kedaluwarsa, `alg` salah, `sub` tidak terdaftar) |
| 3      | Anda deploy: `wrangler secret put` ×2, `wrangler deploy`                                                                           | —                | `curl` ke Worker sungguhan                                            |
| 4 ✅   | **CSP + variabel tumpukan bawah**                                                                                                  | `taskify-webapp` | buka aplikasi, periksa konsol bersih                                  |
| 5 ✅   | **Pindahkan mesin keadaan antrean + tesnya, dan tipe datanya**                                                                     | `taskify-webapp` | 60 tes yang sudah ada tetap lulus                                     |
| 6 ✅   | **`api-client.ts` + ambil JWT + `VITE_MUSIC_API_URL` (opsional)**                                                                  | `taskify-webapp` | 32 tes dengan `fetch` palsu                                           |
| 7      | `MusicBar` + pasang di `AppShell`                                                                                                  | `taskify-webapp` | tes komponen + lihat di layar                                         |
| 8      | `MusicSheet` 3 tab (Cari lagu, Antrean, Lirik — tanpa Radio)                                                                       | `taskify-webapp` | tes komponen                                                          |
| 9      | Item CommandPalette                                                                                                                | `taskify-webapp` | tes komponen                                                          |
| ~~10~~ | ~~Radio + stasiun~~ — **dibatalkan**, lihat [keputusan](#keputusan-yang-berubah-setelah-rancangan-ini-ditulis)                     | —                | —                                                                     |

Langkah **4 harus lebih dulu dari 7**. Tanpa CSP yang benar, pemutarnya akan terlihat
bekerja tapi bisu — dan itu akan terasa seperti bug di kode pemutar, padahal bukan.

---

## Risiko

| Risiko                                                      | Kemungkinan                                          | Rencana                                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Layanan konverter mati                                      | **Tinggi** — layanan seperti ini memang tidak stabil | Dua domain fallback sudah ada. Kalau keduanya mati, radio tetap jalan dan pencarian tetap bisa menampilkan hasil |
| YouTube mengubah bentuk respons                             | Sedang                                               | Parser diuji terhadap fixture asli. Perbaikan perlu redeploy Worker — konsekuensi yang sudah dipilih sadar       |
| Proyek Supabase masih memakai JWT simetris lama             | **Tidak diketahui**                                  | Lihat bagian di bawah                                                                                            |
| Variabel tumpukan bawah merusak posisi Toaster/UpdatePrompt | Sedang                                               | Langkah 4 terpisah dan bisa dibatalkan sendiri. Diperiksa dengan mata di tiga lebar layar                        |
| CPU Worker melewati 10 ms di perangkat Cloudflare           | Rendah (1,90 ms dari 10 ms)                          | Kalau terjadi, rute itu saja dikembalikan ke mode mentah                                                         |
| ToS YouTube                                                 | —                                                    | Pemakaian pribadi. Tidak dipublikasikan                                                                          |

---

## Yang belum bisa saya pastikan

Saya tidak bisa melihat dashboard Supabase Anda, jadi **satu asumsi penting belum
terverifikasi**: apakah proyek Anda sudah memakai **JWT asimetris** (ES256/RS256 dengan
JWKS) atau masih **JWT simetris lama** (HS256 dengan satu JWT secret).

Periksa dengan satu perintah — ganti `<project-ref>` dengan milik Anda:

```bash
curl -s https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

| Hasil                              | Arti           | Rancangannya                                                             |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------ |
| Ada `keys` berisi kunci `EC`/`RSA` | Asimetris      | **Rancangan di atas dipakai apa adanya**                                 |
| `keys` kosong, atau hanya `oct`    | Masih simetris | Worker perlu `SUPABASE_JWT_SECRET` sebagai secret untuk verifikasi HS256 |

Kalau ternyata masih simetris, keamanannya **masih jauh lebih baik** daripada token bundel
— secret-nya tetap hanya di sisi Worker dan tidak pernah dikirim ke browser. Tapi
asimetris lebih baik lagi, dan Supabase menyediakan migrasinya di dashboard.

Dua hal lain yang saya catat sebagai belum terbukti, bukan saya anggap beres:

- **Batas 100 trek untuk album** belum terbukti (tidak ada album di sampel saya yang
  mendekati 100 trek). Kode paginasi playlist dipakai bersama, jadi tetap tertangani.
- **Suara yang benar-benar keluar dari speaker** belum pernah saya uji — sandbox tidak bisa
  mempertahankan server hidup untuk dibuka browser. Itu uji pertama yang harus Anda
  lakukan setelah langkah 4 dan 7.
