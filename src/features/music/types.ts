/**
 * Bentuk data yang dikirim REST API music-taskify.
 *
 * Kontraknya ada di [`music-taskify/docs/API.md`](https://github.com/seseegy/music-taskify/blob/main/docs/API.md);
 * berkas ini hanya menyalin bentuk yang benar-benar dipakai pemutar di sini. Aslinya tinggal di
 * `src/ytmusic/parse.ts` repo itu — di sana ia menjadi keluaran parser, di sini ia menjadi
 * bentuk masukan. Tipe untuk album, playlist, dan artis TIDAK ikut dibawa: lingkup pemutar di
 * Taskify adalah "cari lagu lalu putar", jadi tipe itu akan jadi kode mati.
 *
 * Musik tidak menyentuh basis data sama sekali — tidak ada tabel, migrasi, maupun entri di
 * `powersync/sync-config.yaml`. Semua keadaan di sini hidup di memori selama satu sesi, jadi
 * tipe-tipe ini juga tidak memakai `withMeta`/`deleted_at` seperti data Taskify lainnya.
 */

export interface Thumb {
  url: string;
  width: number;
  height: number;
}

export interface Song {
  /** Tepat 11 karakter `[A-Za-z0-9_-]`. */
  videoId: string;
  title: string;
  artist: string;
  /**
   * Durasi sebagai TEKS, dan pemisahnya bisa titik: `"6.38"` berarti 6 menit 38 detik.
   *
   * Ini bukan angka. `parseFloat("6.38")` akan menghasilkan 6,38 — salah. Dan pola
   * `/^\d+:\d+$/` akan membuang semua durasi, karena hulu memakai `hl=id`. Pakai
   * `parseDuration()` dari `./music-view`, jangan menguraikannya sendiri.
   *
   * Bisa string kosong bila hulu tidak memberinya.
   */
  duration: string;
  /** Biasanya 6 ukuran, terkecil dulu. Bisa kosong (trek album tidak diberi gambar sendiri). */
  thumbnails: Thumb[];
  url: string;
}

/**
 * Keterangan satu lagu dari `/v1/track`: id lirik + antrean lanjutan yang disarankan hulu.
 * Satu panggilan untuk dua keperluan — menampilkan lirik, dan menyambung antrean saat lagu
 * terakhir habis.
 */
export interface Track {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  thumbnails: Thumb[];
  canonicalUrl: string;
  /**
   * Id untuk mengambil teks lirik lewat `/v1/lyrics`; **string kosong** bila lagu ini tidak
   * punya lirik (bukan `null`).
   */
  lyricsId: string;
  /** Maksimal 49 lagu, tidak termasuk lagu yang diminta. */
  upNext: Song[];
}

/*
 * Catatan: `Track` di repo asal punya field `lyrics` berisi teks lirik. Field itu sengaja
 * TIDAK ada di sini — `/v1/track` tidak pernah mengirimnya. Teks liriknya diambil terpisah
 * lewat `/v1/lyrics` memakai `lyricsId`. Menyalin field itu apa adanya akan membuat tab Lirik
 * tampak bisa langsung membaca `track.lyrics`, yang selalu `undefined` saat dijalankan.
 */
