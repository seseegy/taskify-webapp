/**
 * Klien REST untuk Worker music-taskify.
 *
 * Kontrak API-nya ada di [`music-taskify/docs/API.md`](https://github.com/seseegy/music-taskify/blob/main/docs/API.md).
 * Parsing JSON InnerTube dikerjakan Worker, jadi berkas ini tinggal memanggil dan menyalin
 * hasilnya — respons `/v1/track` 541 KB → 18 KB, pada endpoint yang dipanggil setiap lagu
 * berganti.
 *
 * Tiga hal di sini yang mudah salah kalau ditulis ulang tanpa membaca kontraknya:
 *
 *  1. **Token diambil SEGAR setiap permintaan**, tidak disimpan di variabel modul.
 *  2. **Penanda audio siap adalah ADANYA `url`**, bukan `progress == 100`.
 *  3. **Progres bisa mundur.** Yang dilaporkan ke pemanggil hanya angka tertinggi yang
 *     pernah dilihat, supaya bilah progres di UI tidak pernah berjalan ke belakang.
 */

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { Song, Track } from './types';

/**
 * Filter pencarian. Daftar tertutup — Worker menolak nilai lain dengan 400.
 *
 * `undefined` (tanpa filter) berarti hasil campuran, dan hasil campuran **tidak punya
 * halaman lanjutan**: responsnya tidak pernah memuat `cursor`.
 */
export type SearchFilter = 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

/** Format audio. `m4a` (bawaan Worker) paling hemat di antara yang didukung Safari/iOS. */
export type AudioFormat = 'm4a' | 'mp3' | 'opus' | 'webm';

/**
 * Sepotong hasil pencarian.
 *
 * Responsnya sebenarnya juga memuat `topResult`, `albums`, `artists`, dan `playlists`.
 * Field-field itu sengaja tidak dibaca: lingkup pemutar di sini "cari lagu lalu putar",
 * dan membaca sesuatu yang tidak ditampilkan hanya menambah tipe yang harus dirawat.
 */
export interface SearchPage {
  songs: Song[];
  /**
   * Penanda halaman berikutnya. **Tidak ada = halaman terakhir** — itu satu-satunya
   * penanda habis, jadi jangan menebak dari jumlah hasil.
   *
   * Nilainya buram: jangan diurai, disusun sendiri, atau disimpan lama.
   */
  cursor?: string;
}

export interface StreamProgress {
  /** 0–100, tidak pernah mundur. */
  percent: number;
  /** Kalimat singkat berbahasa Indonesia, siap ditampilkan. */
  label: string;
}

export interface ResolveOptions {
  format?: AudioFormat;
  onProgress?: (p: StreamProgress) => void;
  signal?: AbortSignal;
}

/** Jarak antar polling. Konversi butuh belasan detik, jadi tidak perlu rapat-rapat. */
export const POLL_INTERVAL_MS = 1200;

/** Batas menyerah. Di atas ini hampir pasti konverternya yang bermasalah. */
export const CONVERT_TIMEOUT_MS = 90_000;

/**
 * Error dari pemutar musik. `message`-nya **sudah siap ditampilkan ke pengguna** — pesan
 * dari Worker memang berbahasa Indonesia dan dirancang untuk itu, jadi jangan diterjemahkan
 * ulang di UI.
 */
export class MusicError extends Error {
  /** Status HTTP, atau 0 bila permintaannya tidak pernah sampai (jaringan mati). */
  readonly status: number;

  // Field ditulis eksplisit, bukan sebagai parameter property seperti di repo asal:
  // tsconfig di sini memakai `erasableSyntaxOnly`, yang melarang sintaks itu.
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'MusicError';
    this.status = status;
  }
}

export interface MusicClient {
  /** Halaman pertama. Tanpa `filter`, hasilnya campuran dan tanpa `cursor`. */
  search(query: string, filter?: SearchFilter, signal?: AbortSignal): Promise<SearchPage>;
  /** Halaman berikutnya hasil pencarian. */
  searchMore(cursor: string, signal?: AbortSignal): Promise<SearchPage>;
  /** Keterangan satu lagu: `lyricsId` + antrean lanjutan. Satu panggilan untuk dua keperluan. */
  track(videoId: string): Promise<Track>;
  /** Teks lirik. String kosong bukan error — lagu instrumental memang tidak punya lirik. */
  lyrics(lyricsId: string): Promise<string>;
  /** URL audio yang siap dipasang ke `<audio>`. Butuh 12–28 detik untuk lagu yang belum pernah dikonversi. */
  resolveStream(videoId: string, options?: ResolveOptions): Promise<string>;
}

export interface MusicClientConfig {
  /** Asal Worker, mis. `https://music-taskify.rosdiyttaa.workers.dev`. */
  baseUrl: string;
  /**
   * Mengembalikan access_token Supabase yang masih berlaku. **Dipanggil sebelum setiap
   * permintaan** — jangan mengembalikan nilai yang disimpan lama.
   */
  getToken: () => Promise<string>;
}

export interface MusicClientDeps {
  fetch?: typeof fetch;
  /** Disuntik pada pengujian supaya polling tidak benar-benar menunggu. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Menerjemahkan progres jadi kalimat yang jujur.
 *
 * Penting karena menunggu belasan detik tanpa keterangan terasa seperti aplikasi macet.
 */
export function progressLabel(percent: number): string {
  if (percent <= 0) return 'Menghubungi server…';
  if (percent < 90) return `Menyiapkan audio… ${percent}%`;
  return 'Hampir siap…';
}

/**
 * Access token sesi Supabase, diambil **segar** dari supabase-js.
 *
 * Mengikuti pola `db/connector.ts`: `autoRefreshToken: true` sudah aktif di
 * `lib/supabase.ts`, jadi `getSession()` selalu memberi token yang masih berlaku. Token yang
 * disimpan sendiri di variabel modul akan kedaluwarsa di tengah sesi mendengarkan (umurnya
 * ~1 jam) dan menghasilkan 401 yang membingungkan — gejalanya musik berhenti setelah satu
 * jam, bukan error yang menunjuk ke penyebabnya.
 *
 * String kosong = belum login. Seluruh router ada di belakang `AuthGate` (`App.tsx`), jadi
 * ini seharusnya hanya terjadi kalau sesinya dicabut di tengah jalan.
 */
export async function supabaseAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? '';
}

const sleepReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createMusicClient(
  config: MusicClientConfig,
  deps: MusicClientDeps = {},
): MusicClient {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = deps.sleep ?? sleepReal;
  const now = deps.now ?? (() => Date.now());
  const base = config.baseUrl.replace(/\/+$/, '');

  async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let token: string;
    try {
      token = await config.getToken();
    } catch {
      throw new MusicError('Sesi berakhir. Masuk ulang.', 401);
    }
    if (!token) throw new MusicError('Sesi berakhir. Masuk ulang.', 401);

    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // Pembatalan bukan kegagalan jaringan; biarkan pemanggil yang mengabaikannya.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new MusicError('Tidak bisa menghubungi server musik. Periksa koneksi.');
    }
    if (!res.ok) throw new MusicError(await errorMessage(res), res.status);
    return (await res.json()) as T;
  }

  /**
   * Pesan error dari Worker dipakai **apa adanya** — sudah berbahasa Indonesia dan dirancang
   * untuk ditampilkan langsung. Yang ditambahkan di sini hanya penjelasan untuk status yang
   * pesannya tidak akan membantu pengguna.
   */
  async function errorMessage(res: Response): Promise<string> {
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string' && data.error) return data.error;
    } catch {
      /* respons bukan JSON — lanjut ke pesan umum di bawah */
    }
    if (res.status === 401) return 'Sesi berakhir. Masuk ulang.';
    if (res.status === 403) return 'Akun ini tidak diizinkan memakai pemutar musik.';
    if (res.status >= 500) return 'Server musik sedang bermasalah. Coba lagi sebentar.';
    return `Server musik balas HTTP ${res.status}.`;
  }

  return {
    search: (query, filter, signal) =>
      post<SearchPage>('/v1/search', { q: query, ...(filter ? { filter } : {}) }, signal),

    // Halaman lanjutan dikirim HANYA dengan cursor — menyertakan `q` sekaligus ditolak 400.
    searchMore: (cursor, signal) => post<SearchPage>('/v1/search', { cursor }, signal),

    track: (videoId) => post<Track>('/v1/track', { videoId }),

    async lyrics(lyricsId) {
      const { text } = await post<{ text: string }>('/v1/lyrics', { lyricsId });
      return text;
    },

    async resolveStream(videoId, options = {}) {
      const { format, onProgress, signal } = options;
      const report = (percent: number) => onProgress?.({ percent, label: progressLabel(percent) });

      report(0);
      /**
       * Dua bentuk balasan yang sama-sama sah, dan keduanya WAJIB ditangani: konverter kadang
       * sudah punya hasilnya di cache dan langsung memberi `url` tanpa tugas apa pun.
       * Periksa `url` dulu, baru `job`.
       */
      const init = await post<{ job?: string; url?: string }>(
        '/v1/stream/init',
        { videoId, ...(format ? { format } : {}) },
        signal,
      );
      if (init.url) {
        report(100);
        return init.url;
      }
      if (!init.job) throw new MusicError('Server musik tidak memberi tugas konversi.');

      const deadline = now() + CONVERT_TIMEOUT_MS;
      let highest = 0;
      while (now() < deadline) {
        if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError');
        await sleep(POLL_INTERVAL_MS);
        const step = await post<{ progress?: number; url?: string }>(
          '/v1/stream/poll',
          { job: init.job },
          signal,
        );
        // ADANYA `url` adalah penanda selesai — `progress: 100` tanpa `url` belum berarti siap.
        if (step.url) {
          report(100);
          return step.url;
        }
        // Hulu kadang melaporkan progres yang turun; bilahnya tidak boleh mundur.
        const percent = typeof step.progress === 'number' ? step.progress : 0;
        if (percent > highest) {
          highest = percent;
          report(percent);
        }
      }
      throw new MusicError('Menyiapkan audio terlalu lama. Coba lagu lain.');
    },
  };
}

/**
 * Apakah pemutar musik dikonfigurasi di perangkat/build ini.
 *
 * `VITE_MUSIC_API_URL` **opsional**, seperti `VITE_VAPID_PUBLIC_KEY`: aplikasi tetap boot
 * tanpa itu (lihat `lib/env.ts`), dan yang terjadi hanyalah seluruh pintu masuk musik
 * disembunyikan. Jadi jangan memakai `musicClient!` di komponen — periksa ini lebih dulu.
 */
export const isMusicConfigured = Boolean(env.musicApiUrl);

/**
 * Klien tunggal untuk seluruh aplikasi, atau `null` bila `VITE_MUSIC_API_URL` kosong.
 *
 * Satu instance saja supaya tidak ada dua pemutar yang berbunyi bersamaan.
 */
export const musicClient: MusicClient | null = isMusicConfigured
  ? createMusicClient({ baseUrl: env.musicApiUrl, getToken: supabaseAccessToken })
  : null;
