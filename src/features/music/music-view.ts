/**
 * Logika tampilan pemutar musik — murni, tanpa React dan tanpa DOM.
 *
 * Yang ada di sini adalah keputusan "apa yang dilihat pengguna" untuk setiap keadaan
 * pemutar: durasi jadi teks, status jadi satu baris kalimat, dan kontrol mana yang masih
 * masuk akal ditekan. Dipisahkan dari komponennya supaya bisa diuji tanpa merender apa pun —
 * dan karena bagian inilah yang paling mudah salah secara halus.
 */

import type { YtStatus } from './queue-core';

/**
 * Durasi dari API jadi detik, atau `null` bila bentuknya tidak dikenali.
 *
 * ⚠️ Pemisahnya bisa **TITIK**: dengan `hl=id`, hulu mengirim `"6.38"` yang berarti
 * **6 menit 38 detik** — bukan 6,38 menit dan bukan 6 detik lebih.
 *
 *   - `parseFloat("6.38")` → 6,38. Salah.
 *   - `/^\d+:\d+$/` → tidak cocok sama sekali, jadi SEMUA durasi terbuang. Salah.
 *
 * Pola yang benar memperlakukan `:` dan `.` sebagai pemisah yang sama, dan bagian setelah
 * pemisah harus tepat dua angka (`3.5` bukan durasi).
 */
export function parseDuration(text: string): number | null {
  const m = /^(\d+)[:.](\d{2})(?:[:.](\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  // Tiga bagian = jam:menit:detik (video panjang). Dua bagian = menit:detik, yang jauh
  // lebih umum — itulah bentuk yang disebut kontrak API.
  const parts = m[3] === undefined ? [m[1], m[2]] : [m[1], m[2], m[3]];
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** Detik jadi `m:ss` (atau `j:mm:ss` kalau lewat sejam). Negatif dan NaN dianggap nol. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Durasi dari API jadi teks yang ditampilkan, selalu dengan titik dua.
 *
 * Satu bentuk untuk seluruh UI: hasil pencarian, antrean, dan bilah pemutar sama-sama lewat
 * sini. Kalau yang dari API ditampilkan apa adanya, daftar hasil akan menulis `3.38`
 * sementara bilah pemutar menulis `3:38` — dua gaya untuk angka yang sama.
 *
 * String kosong bila hulu tidak memberi durasi, atau bentuknya tidak dikenali. Tidak
 * menebak-nebak: lebih baik tidak menampilkan apa pun daripada menampilkan angka salah.
 */
export function formatDuration(text: string): string {
  const s = parseDuration(text);
  return s === null ? '' : formatClock(s);
}

export interface BarStatusInput {
  status: YtStatus;
  /** Kalimat progres dari klien, mis. `"Menyiapkan audio… 45%"`. */
  label: string;
  error: string;
  /** Lagu terakhir habis dan pemutar sedang menunggu lagu lanjutan. */
  awaitingMore: boolean;
  online: boolean;
  artist: string;
  /** Posisi lagu sekarang di antrean, berbasis 1. */
  position: number;
  total: number;
}

/**
 * Satu baris kalimat di bawah judul lagu.
 *
 * Urutannya adalah urutan "mana yang paling menjelaskan keadaan sekarang":
 *
 *  1. **Error dulu.** Pesan dari Worker lebih spesifik daripada tebakan apa pun di sini —
 *     termasuk lebih spesifik daripada "Tidak ada koneksi", karena pesannya sendiri sudah
 *     menyebut koneksi bila itu penyebabnya.
 *  2. **Lalu yang butuh jaringan.** Menunggu, menyiapkan, dan keadaan kosong semuanya
 *     mustahil maju tanpa jaringan, jadi di situ "Tidak ada koneksi" yang benar.
 *  3. **Terakhir yang tidak butuh jaringan.** Saat sudah berbunyi, audionya sudah ada di
 *     peramban — memberitahu pengguna bahwa koneksi mati hanya kebisingan, karena yang
 *     sedang didengarkan tetap berjalan. Yang ditampilkan artisnya.
 */
export function barStatus(i: BarStatusInput): string {
  if (i.status === 'error') return i.error || 'Gagal memuat audio.';
  if (i.awaitingMore) return i.online ? 'Mencari lagu lanjutan…' : 'Tidak ada koneksi';
  if (i.status === 'preparing')
    return i.online ? i.label || 'Menyiapkan audio…' : 'Tidak ada koneksi';
  // Judulnya sudah menulis "Musik" saat kosong, jadi baris ini dipakai untuk mengatakan apa
  // yang bisa dilakukan — bukan mengulangi kata yang sama dua kali.
  if (i.status === 'idle') return i.online ? 'Cari lagu untuk diputar' : 'Tidak ada koneksi';
  // `1/1` tidak memberi tahu apa pun, jadi posisinya disembunyikan untuk antrean satu lagu.
  return [i.artist, i.total > 1 ? `${i.position}/${i.total}` : ''].filter(Boolean).join(' · ');
}

/**
 * Teks untuk `role="status"`, atau string kosong bila tidak ada yang perlu diumumkan.
 *
 * Dua hal yang membentuk ini:
 *
 *  - **Tidak diumumkan setiap pergantian lagu.** Kalau live region selalu terisi, pembaca
 *    layar membacakan tiap lagu baru di tengah pekerjaan pengguna. Yang diumumkan hanya
 *    keadaan yang perlu ditunggu atau ditindaklanjuti.
 *  - **Tanpa angka.** Kalimat progres berubah tiap polling (`45%`, `46%`, …); kalau itu yang
 *    masuk live region, pembaca layar mengoceh terus selama belasan detik. Jadi yang
 *    diumumkan kalimat yang TETAP, sementara angkanya tetap terlihat di bilah progres.
 */
export function barAnnouncement(i: {
  status: YtStatus;
  error: string;
  awaitingMore: boolean;
  title: string;
}): string {
  if (i.status === 'error') return i.error || 'Gagal memuat audio.';
  if (i.awaitingMore) return 'Mencari lagu lanjutan.';
  if (i.status === 'preparing') {
    return i.title ? `Menyiapkan audio untuk ${i.title}.` : 'Menyiapkan audio.';
  }
  return '';
}

export interface BarControls {
  /** Tombol putar/jeda masih masuk akal ditekan. */
  canPlay: boolean;
  canNext: boolean;
  canPrev: boolean;
}

/**
 * Kontrol mana yang aktif.
 *
 * Pindah lagu **selalu** butuh jaringan (konversi lagu berikutnya), jadi saat offline
 * tombolnya dinonaktifkan — lebih jujur daripada tombol yang bisa ditekan lalu gagal.
 * Putar/jeda tetap aktif asal audionya sudah ada di peramban: musik yang sedang berbunyi
 * tidak ada hubungannya dengan koneksi.
 */
export function barControls(i: {
  status: YtStatus;
  online: boolean;
  /** URL audio lagu sekarang sudah siap. */
  hasUrl: boolean;
  hasNext: boolean;
  hasPrev: boolean;
}): BarControls {
  return {
    canPlay: i.status !== 'idle' && (i.hasUrl || i.online),
    canNext: i.hasNext && i.online,
    canPrev: i.hasPrev && i.online,
  };
}

/**
 * Lebar garis posisi lagu, 0–100.
 *
 * Garis ini **tidak bisa diklik**, dan itu bukan kelalaian: CDN konverter tidak melayani
 * `Range` (permintaan `Range: bytes=…` dijawab 200 dengan seluruh berkas), jadi audionya
 * memang tidak bisa digeser posisinya. Lihat `MusicBar.tsx`.
 */
export function elapsedPercent(elapsed: number, totalSeconds: number): number {
  if (!Number.isFinite(elapsed) || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsed / totalSeconds) * 100));
}
