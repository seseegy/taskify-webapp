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
 * `undefined` (tanpa filter) berarti hasil campuran. Dulu hasil campuran tidak punya
 * halaman lanjutan; sekarang Worker mengirim cursor gabungan untuknya, jadi tab "Semua"
 * bisa memuat halaman berikutnya seperti tab lain (lihat `supportsPaging`).
 */
export type SearchFilter = 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

/** Format audio yang didukung Worker. */
export type AudioFormat = 'm4a' | 'mp3' | 'opus' | 'webm';

/**
 * Format yang diminta kalau pemanggil tidak menyebutkan apa pun.
 *
 * **`mp3`, bukan `m4a`** — dan ini mengoreksi keputusan di rancangan. `m4a` dipilih di sana
 * karena ukurannya 3,31 MB lawan 8,22 MB, tapi angka itu pengukuran **ukuran berkas**, bukan
 * uji pemutaran. Ternyata `m4a` dari konverter **tidak bisa diputar sama sekali** di Chrome.
 *
 * Diperiksa pada berkas sungguhan dari konverter:
 *
 * ```
 * ftyp(32) → moov(833) → moof(size=0)
 * moov berisi mvex/trex           → fragmented MP4
 * stts/stsc/stsz/stco semuanya 0  → moov tidak memuat satu pun lokasi sampel
 * ```
 *
 * Jadi seluruh audionya ada di fragmen `moof`+`mdat`, tapi `moof` pertama mendeklarasikan
 * `size = 0` ("sampai akhir berkas") — yang hanya sah untuk atom terakhir, dan `moof` wajib
 * diikuti `mdat`. Indeks fragmennya tidak bisa diurai, jadi Chrome menolaknya dengan
 * `MEDIA_ERR_SRC_NOT_SUPPORTED`. Gejalanya di UI: berkas terunduh penuh dengan **200 OK**,
 * lalu "Audio gagal diputar" — kegagalan yang tidak terlihat di log Worker maupun di CSP.
 *
 * `mp3` tidak punya kontainer sama sekali (hanya rangkaian frame), jadi tidak ada metadata
 * yang bisa salah urai. Ongkosnya jujur: **±8,2 MB per lagu, bukan 3,3 MB** — sekit
 * 165 MB/jam. `webm` (3,69 MB) dan `opus` (2,74 MB) jauh lebih hemat dan hampir pasti jalan
 * di Chrome, tapi keduanya belum diuji di sini dan `opus` berisiko bisu di iPhone. Jangan
 * menggantinya tanpa benar-benar mendengarkan hasilnya.
 */
export const DEFAULT_AUDIO_FORMAT: AudioFormat = 'mp3';

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

/** Percobaan ulang maksimal saat kena 429 `retryable` di `resolveStream`. */
export const MAX_RATE_LIMIT_RETRIES = 3;

/** Batas atas satu kali tunggu dari `Retry-After`: 60 detik — lebih lama dari itu lagu sudah ditinggal pengguna. */
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Jeda sebelum mengulang 429: selama yang diminta server (`retryAfterSeconds`), atau
 * backoff eksponensial 1s → 2s → 4s bila server tidak memberi angka.
 */
export function retryDelayMs(err: MusicError, attempt: number): number {
  if (
    typeof err.retryAfterSeconds === 'number' &&
    Number.isFinite(err.retryAfterSeconds) &&
    err.retryAfterSeconds > 0
  ) {
    return Math.min(err.retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

/**
 * Error dari pemutar musik. `message`-nya **sudah siap ditampilkan ke pengguna** — pesan
 * dari Worker memang berbahasa Indonesia dan dirancang untuk itu, jadi jangan diterjemahkan
 * ulang di UI.
 */
export class MusicError extends Error {
  /** Status HTTP, atau 0 bila permintaannya tidak pernah sampai (jaringan mati). */
  readonly status: number;
  /**
   * Kode error Worker (`RATE_LIMITED`, `NOT_FOUND`, …) bila responsnya memakai bentuk
   * objek `{error:{message, code, retryable, retryAfterSeconds?}}`.
   */
  readonly code?: string;
  /** `false` berarti mengulang tidak akan membantu; `undefined` = server tidak menyebutkannya. */
  readonly retryable?: boolean;
  /** Detik yang disarankan server sebelum mengulang, dari bodi atau header `Retry-After`. */
  readonly retryAfterSeconds?: number;

  // Field ditulis eksplisit, bukan sebagai parameter property seperti di repo asal:
  // tsconfig di sini memakai `erasableSyntaxOnly`, yang melarang sintaks itu.
  constructor(
    message: string,
    status = 0,
    info: { code?: string; retryable?: boolean; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'MusicError';
    this.status = status;
    this.code = info.code;
    this.retryable = info.retryable;
    this.retryAfterSeconds = info.retryAfterSeconds;
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

/** Hasil uraian bodi error Worker — `message` kosong bila bodinya bukan bentuk yang dikenal. */
interface ParsedApiError {
  message?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
}

/**
 * Membaca header `Retry-After` (detik) menjadi angka yang aman dipakai.
 * `undefined` bila header tidak ada, bukan angka, atau di luar 1–3600 — nilai absurd
 * dari hulu tidak diteruskan mentah ke klien. Cerminan `parseRetryAfterHeader` Worker.
 */
function parseRetryAfterHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n)) return undefined;
  const s = Math.floor(n);
  if (s < 1 || s > 3600) return undefined;
  return s;
}

/**
 * Mengurai bodi error Worker, dua bentuk sekaligus:
 *
 * - LAMA: `{error: "teks"}` — hanya pesan, tanpa kode.
 * - BARU: `{error:{message, code, retryable, retryAfterSeconds?}}`.
 *
 * `retryAfterSeconds` diambil dari bodi dulu, lalu dari header `Retry-After` bila bodi
 * tidak menyebutkannya — Worker mengirim keduanya dengan nilai yang sama, tapi salah
 * satunya bisa hilang di tengah jalan (mis. proksi yang membuang header).
 */
async function parseApiError(res: Response): Promise<ParsedApiError> {
  const fromHeader = parseRetryAfterHeader(res.headers.get('Retry-After'));
  try {
    const data = (await res.json()) as { error?: unknown };
    const e = data.error;
    if (typeof e === 'string' && e) return { message: e, retryAfterSeconds: fromHeader };
    if (e && typeof e === 'object') {
      const o = e as {
        message?: unknown;
        code?: unknown;
        retryable?: unknown;
        retryAfterSeconds?: unknown;
      };
      if (typeof o.message === 'string' && o.message) {
        const fromBody =
          typeof o.retryAfterSeconds === 'number' && Number.isFinite(o.retryAfterSeconds)
            ? Math.max(0, Math.floor(o.retryAfterSeconds))
            : undefined;
        return {
          message: o.message,
          code: typeof o.code === 'string' ? o.code : undefined,
          retryable: typeof o.retryable === 'boolean' ? o.retryable : undefined,
          retryAfterSeconds: fromBody ?? fromHeader,
        };
      }
    }
  } catch {
    /* respons bukan JSON — pesan umum yang dipakai */
  }
  return { retryAfterSeconds: fromHeader };
}

export function createMusicClient(
  config: MusicClientConfig,
  deps: MusicClientDeps = {},
): MusicClient {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = deps.sleep ?? sleepReal;
  const now = deps.now ?? (() => Date.now());
  const base = config.baseUrl.replace(/\/+$/, '');

  /**
   * Mengulang permintaan yang kena 429 `retryable`, menunggu selama yang diminta server.
   *
   * Tanpa ini, 429 bersifat fatal: `post()` melempar dan `resolveStream` langsung gagal,
   * padahal server hanya meminta menunggu sebentar. Jeda diambil dari `retryAfterSeconds`
   * (bodi atau header `Retry-After`); tanpa angka dari server dipakai backoff eksponensial
   * 1s → 2s → 4s. Maksimal 3 kali ulang — lebih dari itu berarti kuotanya memang habis,
   * dan menunggu lebih lama hanya menahan UI.
   *
   * Hanya 429 yang diulang, dan hanya bila server tidak secara eksplisit melarangnya
   * (`retryable: false`, mis. kuota harian habis). Status lain (5xx, 401, 403) tetap
   * dilempar langsung.
   */
  async function withRateLimitRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        const rateLimited =
          err instanceof MusicError && err.status === 429 && err.retryable !== false;
        if (!rateLimited) throw err;
        attempt += 1;
        if (attempt > MAX_RATE_LIMIT_RETRIES) throw err;
        if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError');
        await sleep(retryDelayMs(err, attempt));
        if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError');
      }
    }
  }

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
    if (!res.ok) throw await apiError(res);
    return (await res.json()) as T;
  }

  /**
   * Pesan error dari Worker dipakai **apa adanya** — sudah berbahasa Indonesia dan dirancang
   * untuk ditampilkan langsung. Yang ditambahkan di sini hanya penjelasan untuk status yang
   * pesannya tidak akan membantu pengguna.
   *
   * Dua bentuk bodi error diterima: bentuk LAMA `{error: "teks"}` dan bentuk BARU
   * `{error:{message, code, retryable, retryAfterSeconds?}}` (Worker mengirim yang baru
   * sejak fitur 23). `code`/`retryable`/`retryAfterSeconds` diteruskan ke `MusicError`
   * supaya pemanggil bisa memutuskan sendiri — mis. `resolveStream` mengulang 429 yang
   * `retryable` setelah menunggu `retryAfterSeconds`.
   */
  async function apiError(res: Response): Promise<MusicError> {
    const parsed = await parseApiError(res);
    return new MusicError(parsed.message ?? fallbackMessage(res.status), res.status, {
      code: parsed.code,
      retryable: parsed.retryable,
      retryAfterSeconds: parsed.retryAfterSeconds,
    });
  }

  function fallbackMessage(status: number): string {
    if (status === 401) return 'Sesi berakhir. Masuk ulang.';
    if (status === 403) return 'Akun ini tidak diizinkan memakai pemutar musik.';
    if (status >= 500) return 'Server musik sedang bermasalah. Coba lagi sebentar.';
    return `Server musik balas HTTP ${status}.`;
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
      /*
        `format` SELALU dikirim, tidak pernah dibiarkan kosong. Bawaan Worker adalah `m4a`,
        dan `m4a` dari konverter tidak bisa diputar — jadi mengandalkan bawaan sisi server
        berarti diam-diam memilih format yang rusak. Lihat `DEFAULT_AUDIO_FORMAT`.
      */
      const init = await withRateLimitRetry(
        () =>
          post<{ job?: string; url?: string }>(
            '/v1/stream/init',
            { videoId, format: format ?? DEFAULT_AUDIO_FORMAT },
            signal,
          ),
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
        const step = await withRateLimitRetry(
          () =>
            post<{ progress?: number; url?: string }>('/v1/stream/poll', { job: init.job }, signal),
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
