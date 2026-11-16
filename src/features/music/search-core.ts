/**
 * Logika pencarian lagu yang tidak butuh React — penggabungan halaman dan aturan paginasi.
 *
 * Dipisahkan karena dua aturannya datang dari kontrak API dan mudah dilanggar tanpa sadar:
 * Worker tidak menyimpan status (jadi dedupe antar halaman tugas klien), dan halaman
 * berikutnya hanya ada bila respons memuat `cursor` — termasuk di tab "Semua", yang
 * cursor-nya digabung Worker dari semua jenis hasil (`mergedCursor`).
 */

import type { SearchFilter } from './api-client';
import type { Song } from './types';

/**
 * Tab filter di panel pencarian.
 *
 * `undefined` = tanpa filter (hasil campuran). Nilainya sengaja bukan string `'semua'`:
 * yang dikirim ke Worker memang "tidak ada field `filter`", dan menyimpan ketiadaan itu
 * sebagai `undefined` membuat mustahil mengirimnya sebagai filter yang tidak dikenal.
 */
export interface SearchTabOption {
  key: string;
  label: string;
  filter: SearchFilter | undefined;
}

export const SEARCH_TABS: SearchTabOption[] = [
  { key: 'songs', label: 'Lagu', filter: 'songs' },
  { key: 'videos', label: 'Video', filter: 'videos' },
  { key: 'all', label: 'Semua', filter: undefined },
];

/**
 * Apakah filter ini bisa memuat halaman berikutnya.
 *
 * **Semua filter bisa, termasuk tanpa filter.** Dulu pencarian tanpa filter tidak punya
 * halaman lanjutan — hulu tidak mengirim token lanjutan untuk hasil campuran. Sejak
 * Worker mengirim cursor gabungan (`mergedCursor`) untuk hasil campuran, tab "Semua" pun
 * punya halaman berikutnya, jadi gate ini dibuka. Yang menentukan masih ada lanjutan atau
 * tidak tetap `cursor`-nya: `canLoadMore` hanya benar bila cursor ada.
 */
export const supportsPaging = (_filter: SearchFilter | undefined): boolean => true;

/** Tombol "Muat lagi" ditampilkan hanya bila filternya mendukung DAN masih ada cursor. */
export function canLoadMore(filter: SearchFilter | undefined, cursor: string | undefined): boolean {
  return supportsPaging(filter) && Boolean(cursor);
}

/**
 * Menggabungkan halaman hasil pencarian, membuang yang sudah ada.
 *
 * **Dedupe antar halaman adalah tugas klien.** Worker tidak menyimpan status, jadi ia tidak
 * tahu halaman mana yang sudah diterima — duplikat di dalam satu halaman sudah dibuangnya,
 * duplikat antar halaman tidak. Tanpa ini, menekan "Muat lagi" bisa memunculkan lagu yang
 * sama dua kali di daftar, dan antrean yang dibuat dari daftar itu akan punya `videoId`
 * ganda.
 *
 * Baris tanpa `videoId` juga dibuang: lagunya tidak bisa diputar, jadi menampilkannya hanya
 * menyiapkan klik yang gagal.
 */
export function mergeSongPages(existing: Song[], incoming: Song[]): Song[] {
  const seen = new Set(existing.map((s) => s.videoId));
  const out = [...existing];
  for (const song of incoming) {
    if (!song.videoId || seen.has(song.videoId)) continue;
    seen.add(song.videoId);
    out.push(song);
  }
  return out;
}

/**
 * Gambar album terkecil, atau string kosong.
 *
 * Hulu mengirim ±6 ukuran dengan **yang terkecil lebih dulu**, dan baris daftar hanya
 * selebar 40px — jadi yang pertama memang yang tepat, bukan yang terbesar. Bisa kosong:
 * trek album tidak diberi gambar sendiri, hulu hanya memberi gambar di tingkat album.
 */
export const thumbUrl = (song: Song): string => song.thumbnails[0]?.url ?? '';

/**
 * Gambar album terbesar, untuk layar "Sedang diputar".
 *
 * Dipilih dari `width`, **bukan** dengan mengambil elemen terakhir. Urutan "terkecil dulu"
 * memang yang terpantau, tapi itu kebiasaan hulu dan bukan janji di kontrak API — dan kalau
 * suatu hari urutannya berubah, mengambil elemen terakhir akan memasang gambar 60px di
 * bingkai 320px. Membaca `width` tidak pernah salah, dan ongkosnya nol.
 *
 * Ukuran terbesar yang terpantau 544px, jadi bingkai sampai ±320px masih tajam.
 */
export function coverUrl(song: Song): string {
  let best = '';
  let bestWidth = -1;
  for (const t of song.thumbnails) {
    if (t.url && t.width > bestWidth) {
      best = t.url;
      bestWidth = t.width;
    }
  }
  return best;
}
