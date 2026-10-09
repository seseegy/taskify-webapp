import { Disc3, FileText, ListMusic, Pause, Play, Search, type LucideIcon } from 'lucide-react';
import {
  openMusicSheet,
  openNowPlaying,
  toggleMusicPlayback,
  type MusicRemoteState,
} from './music-store';

/**
 * Item musik untuk CommandPalette.
 *
 * CommandPalette adalah **satu-satunya** pintu masuk musik yang ongkos ruangnya nol — sidebar
 * sudah penuh (9 menu sudah pernah terpotong di laptop 1366×768), header mobile sudah
 * kehabisan lebar, dan BottomNav sudah 5 item. Jadi tidak ada item baru di `NAV_ITEMS`, dan
 * di mobile musik otomatis dapat pintu masuk karena tombol pencarian di header membuka
 * palette yang sama.
 */
export interface MusicCommand {
  key: string;
  title: string;
  /** Kata kunci pencocokan di palette. Bahasa Indonesia dan Inggris, keduanya. */
  keywords: string;
  icon: LucideIcon;
  run: () => void;
}

/**
 * Item yang masuk akal ditampilkan untuk keadaan pemutar sekarang.
 *
 * Daftarnya **menyusut saat tidak ada yang diputar**, dan itu disengaja: "Jeda", "Antrean",
 * dan "Lirik lagu ini" semuanya berujung di tempat yang kosong kalau belum ada lagu. Palette
 * yang menawarkan empat pilihan dengan tiga di antaranya jalan buntu lebih buruk daripada
 * satu pilihan yang jelas.
 *
 * Urutannya urutan kemungkinan dipakai: yang sedang berbunyi lebih sering dijeda daripada
 * dicarikan lagu baru.
 */
export function musicCommands(state: MusicRemoteState): MusicCommand[] {
  const items: MusicCommand[] = [];

  if (state.active) {
    items.push({
      key: 'music-toggle',
      title: state.playing ? 'Jeda musik' : 'Lanjutkan musik',
      keywords: 'musik putar jeda pause play stop hentikan lagu music',
      icon: state.playing ? Pause : Play,
      // Satu-satunya item yang TIDAK membuka panel: menjeda musik tidak perlu melihat
      // apa pun, dan membuka panel untuk itu justru menutupi pekerjaan pengguna.
      run: toggleMusicPlayback,
    });
    items.push({
      key: 'music-now',
      title: 'Sedang diputar',
      keywords: 'musik sedang diputar lagu sekarang now playing music',
      icon: Disc3,
      run: openNowPlaying,
    });
    items.push({
      key: 'music-queue',
      title: 'Antrean musik',
      keywords: 'musik antrean queue daftar lagu berikutnya music',
      icon: ListMusic,
      run: () => openMusicSheet('antrean'),
    });
  }

  if (state.hasLyrics) {
    items.push({
      key: 'music-lyrics',
      title: 'Lirik lagu ini',
      keywords: 'musik lirik lyrics teks lagu music',
      icon: FileText,
      run: () => openMusicSheet('lirik'),
    });
  }

  items.push({
    key: 'music-search',
    title: 'Cari lagu',
    keywords: 'musik lagu putar play music cari song pemutar',
    icon: Search,
    run: () => openMusicSheet('cari'),
  });

  return items;
}
