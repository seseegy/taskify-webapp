/**
 * Mesin keadaan antrean pemutar YouTube Music — murni, tanpa DOM dan tanpa jaringan,
 * supaya perilakunya bisa diuji tanpa benar-benar memutar audio.
 *
 * Dua hal yang membentuk rancangan ini:
 *
 *   1. Menyiapkan audio satu lagu butuh ~13–20 detik (diukur langsung). Kalau ditunggu
 *      per lagu, mendengarkan sambil kerja jadi menyiksa. Karena itu ada `prefetchTarget`:
 *      selagi lagu sekarang berbunyi, URL lagu BERIKUTNYA sudah disiapkan. Jadi hanya
 *      lagu pertama yang terasa menunggu; pindah lagu setelahnya seketika.
 *
 *   2. URL hasil konversi disimpan di `urls` selama sesi. Memutar ulang lagu yang sudah
 *      pernah diputar jadi tidak perlu konversi lagi sama sekali.
 *
 * Dipindahkan APA ADANYA dari `src/ytmusic/queue-core.ts` di repo `seseegy/music-taskify`,
 * beserta seluruh tesnya di `queue-core.test.ts` — satu-satunya perubahan adalah jalur impor
 * `Song` (`./parse` → `./types`). Perilakunya sudah terkunci oleh tes itu, jadi kalau ada yang
 * perlu diubah di sini, ubah tesnya lebih dulu; jangan menulis ulang mesinnya.
 */

import type { Song } from './types';

export type RepeatMode = 'off' | 'one' | 'all';

export type YtStatus =
  /** Belum ada apa-apa di antrean. */
  | 'idle'
  /** Sedang mengonversi audio lagu sekarang. */
  | 'preparing'
  | 'playing'
  | 'paused'
  | 'error';

export interface YtState {
  queue: Song[];
  /** Urutan putar berisi indeks ke `queue`. Berubah saat acak dinyalakan. */
  order: number[];
  /** Posisi di dalam `order`, bukan di dalam `queue`. */
  position: number;
  status: YtStatus;
  /** Progres konversi lagu sekarang, 0–100. */
  percent: number;
  label: string;
  error: string;
  /** videoId → URL audio yang sudah siap, berlaku selama sesi. */
  urls: Record<string, string>;
  /** videoId yang URL-nya sedang disiapkan di latar belakang. */
  prefetching: string[];
  repeat: RepeatMode;
  shuffle: boolean;
  /**
   * Keterangan tambahan per lagu dari endpoint `next`: id lirik dan antrean lanjutan
   * yang disarankan YouTube. Diambil sekali per lagu, lalu dipakai dua hal sekaligus —
   * menampilkan lirik, dan menyambung antrean saat lagu terakhir habis.
   */
  details: Record<string, TrackDetails>;
  /** videoId yang keterangannya sedang diambil. */
  detailsPending: string[];
  /** videoId yang antrean lanjutannya sudah pernah disambungkan — jangan dua kali. */
  continued: string[];
  /** Menyambung antrean sendiri saat lagu terakhir habis, supaya musik tidak berhenti. */
  autoContinue: boolean;
  /**
   * Lagu terakhir sudah habis dan pemutar sedang menunggu antrean lanjutan.
   *
   * Dibedakan dari "dijeda oleh pengguna" dengan sengaja: kalau keterangan lagunya tiba
   * terlambat, lagu tambahan harus langsung diputar — bukan menunggu pengguna menekan
   * putar lagi, karena dari sisi pengguna musiknya baru saja mati sendiri.
   */
  awaitingMore: boolean;
}

export interface TrackDetails {
  /** Kosong kalau lagu ini tidak punya lirik. */
  lyricsId: string;
  upNext: Song[];
}

export const INITIAL_YT_STATE: YtState = {
  queue: [],
  order: [],
  position: 0,
  status: 'idle',
  percent: 0,
  label: '',
  error: '',
  urls: {},
  prefetching: [],
  repeat: 'off',
  shuffle: false,
  details: {},
  detailsPending: [],
  continued: [],
  autoContinue: true,
  awaitingMore: false,
};

export type YtEvent =
  | { type: 'setQueue'; songs: Song[]; startAt?: number }
  | { type: 'preparing' }
  | { type: 'progress'; percent: number; label: string }
  | { type: 'ready'; videoId: string; url: string }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'ended' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'jump'; position: number }
  | { type: 'error'; message: string }
  | { type: 'prefetchStart'; videoId: string }
  | { type: 'prefetchDone'; videoId: string; url: string }
  | { type: 'prefetchFailed'; videoId: string }
  | { type: 'toggleRepeat' }
  | { type: 'toggleShuffle'; rng?: () => number }
  | { type: 'detailsStart'; videoId: string }
  | { type: 'detailsDone'; videoId: string; details: TrackDetails }
  | { type: 'detailsFailed'; videoId: string }
  | { type: 'continueQueue'; from: string; songs: Song[]; rng?: () => number }
  | { type: 'toggleAutoContinue' }
  | { type: 'clear' };

/** Lagu yang sedang (atau akan) diputar. */
export const currentSong = (s: YtState): Song | null => {
  const idx = s.order[s.position];
  return idx === undefined ? null : (s.queue[idx] ?? null);
};

/** URL audio lagu sekarang kalau sudah siap. */
export function currentUrl(s: YtState): string | null {
  const song = currentSong(s);
  return song ? (s.urls[song.videoId] ?? null) : null;
}

/**
 * Posisi berikutnya menurut mode ulang, atau null kalau antrean memang habis.
 * `repeat: 'one'` tidak menggeser posisi — pengulangan ditangani di sini supaya
 * tombol "berikutnya" dan lagu yang selesai sendiri memakai aturan yang sama.
 */
export function nextPosition(s: YtState, manual = false): number | null {
  // `manual` hanya mengubah arti mode ulang-satu; lihat percabangan di bawah.
  if (s.order.length === 0) return null;
  // Menekan tombol berikutnya harus tetap pindah lagu walau mode ulang-satu aktif.
  if (s.repeat === 'one' && !manual) return s.position;
  const candidate = s.position + 1;
  if (candidate < s.order.length) return candidate;
  return s.repeat === 'all' ? 0 : null;
}

export const prevPosition = (s: YtState): number | null => {
  if (s.order.length === 0) return null;
  if (s.position > 0) return s.position - 1;
  return s.repeat === 'all' ? s.order.length - 1 : null;
};

/**
 * videoId yang sebaiknya disiapkan di latar belakang sekarang, atau null.
 *
 * Syaratnya: ada lagu berikutnya, URL-nya belum ada, belum sedang disiapkan, dan
 * lagu sekarang sudah benar-benar berbunyi — supaya prefetch tidak berebut jatah
 * dengan konversi lagu yang sedang ditunggu pengguna.
 */
export function prefetchTarget(s: YtState): string | null {
  if (s.status !== 'playing' && s.status !== 'paused') return null;
  const pos = s.repeat === 'one' ? null : nextPositionIgnoringRepeatOne(s);
  if (pos === null) return null;
  const idx = s.order[pos];
  if (idx === undefined) return null;
  const song = s.queue[idx];
  if (!song) return null;
  if (s.urls[song.videoId]) return null;
  if (s.prefetching.includes(song.videoId)) return null;
  return song.videoId;
}

/**
 * videoId yang keterangannya perlu diambil sekarang, atau null.
 *
 * Diambil begitu lagunya mulai berbunyi, bukan nanti saat dibutuhkan: hasilnya dipakai
 * untuk lirik (pengguna bisa membukanya kapan saja) dan untuk menyambung antrean. Kalau
 * ditunggu sampai lagu terakhir habis, musik akan diam dulu selama permintaannya jalan.
 */
export function detailsTarget(s: YtState): string | null {
  if (s.status !== 'playing' && s.status !== 'paused') return null;
  const song = currentSong(s);
  if (!song) return null;
  if (s.details[song.videoId]) return null;
  if (s.detailsPending.includes(song.videoId)) return null;
  return song.videoId;
}

/**
 * Lagu yang antrean lanjutannya siap disambungkan, atau null.
 *
 * Syaratnya: penyambungan otomatis menyala, mode ulang mati (kalau menyala, antrean
 * memang tidak pernah habis), posisi sudah di lagu terakhir, keterangannya sudah tiba,
 * dan belum pernah disambung dari lagu ini.
 */
export function continuationSource(s: YtState): { from: string; songs: Song[] } | null {
  if (!s.autoContinue || s.repeat !== 'off') return null;
  if (s.order.length === 0 || s.position !== s.order.length - 1) return null;
  const song = currentSong(s);
  if (!song || s.continued.includes(song.videoId)) return null;
  const detail = s.details[song.videoId];
  if (!detail || detail.upNext.length === 0) return null;
  const known = new Set(s.queue.map((q) => q.videoId));
  const songs = detail.upNext.filter((x) => x.videoId && !known.has(x.videoId));
  return songs.length === 0 ? null : { from: song.videoId, songs };
}

/** Id lirik lagu yang sedang diputar; kosong kalau tidak ada atau belum tiba. */
export function currentLyricsId(s: YtState): string {
  const song = currentSong(s);
  return song ? (s.details[song.videoId]?.lyricsId ?? '') : '';
}

function nextPositionIgnoringRepeatOne(s: YtState): number | null {
  const candidate = s.position + 1;
  if (candidate < s.order.length) return candidate;
  return s.repeat === 'all' ? 0 : null;
}

/** Fisher–Yates dengan lagu sekarang dipindahkan ke depan agar tidak terputus. */
export function shuffleOrder(
  indices: number[],
  keepFirst: number | undefined,
  rng: () => number,
): number[] {
  const rest = indices.filter((i) => i !== keepFirst);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = rest[i]!;
    const b = rest[j]!;
    rest[i] = b;
    rest[j] = a;
  }
  return keepFirst === undefined ? rest : [keepFirst, ...rest];
}

const sequential = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

export function reduceYt(state: YtState, event: YtEvent): YtState {
  switch (event.type) {
    case 'setQueue': {
      const songs = dedupe(event.songs);
      if (songs.length === 0) {
        return { ...INITIAL_YT_STATE, urls: state.urls, details: state.details };
      }
      const startAt = clamp(event.startAt ?? 0, 0, songs.length - 1);
      const order = state.shuffle
        ? shuffleOrder(sequential(songs.length), startAt, Math.random)
        : sequential(songs.length);
      const position = state.shuffle ? 0 : startAt;
      return {
        ...state,
        queue: songs,
        order,
        position,
        status: 'preparing',
        percent: 0,
        label: '',
        error: '',
        prefetching: [],
        // Antrean baru: riwayat penyambungan tidak berlaku lagi.
        continued: [],
      };
    }

    case 'preparing':
      return { ...state, status: 'preparing', percent: 0, label: '', error: '' };

    case 'progress':
      // Abaikan progres yang datang setelah pengguna menjeda/menghentikan.
      if (state.status !== 'preparing') return state;
      return { ...state, percent: event.percent, label: event.label };

    case 'ready':
      return {
        ...state,
        urls: { ...state.urls, [event.videoId]: event.url },
        percent: 100,
        label: '',
      };

    case 'playing':
      return {
        ...state,
        status: 'playing',
        error: '',
        percent: 100,
        label: '',
        awaitingMore: false,
      };

    case 'paused':
      // Hanya masuk akal kalau memang sedang berbunyi.
      return state.status === 'playing' ? { ...state, status: 'paused' } : state;

    case 'ended': {
      const pos = nextPosition(state);
      if (pos === null) {
        // Antrean habis. Kalau penyambungan otomatis menyala, ini bukan "berhenti"
        // melainkan "menunggu" — lihat `awaitingMore`.
        return {
          ...state,
          status: 'paused',
          awaitingMore: state.autoContinue && state.repeat === 'off',
        };
      }
      // Ulang-satu: posisi sama, tapi status dikembalikan agar efek pemutar jalan lagi.
      const sameSong = pos === state.position;
      return {
        ...state,
        position: pos,
        status: sameSong && currentUrl(state) ? 'playing' : 'preparing',
        percent: 0,
        label: '',
      };
    }

    case 'next':
    case 'prev': {
      const pos = event.type === 'next' ? nextPosition(state, true) : prevPosition(state);
      if (pos === null) return state;
      return {
        ...state,
        position: pos,
        status: 'preparing',
        percent: 0,
        label: '',
        error: '',
        awaitingMore: false,
      };
    }

    case 'jump': {
      if (event.position < 0 || event.position >= state.order.length) return state;
      return {
        ...state,
        position: event.position,
        status: 'preparing',
        percent: 0,
        label: '',
        error: '',
      };
    }

    case 'error':
      return { ...state, status: 'error', error: event.message, percent: 0, label: '' };

    case 'prefetchStart':
      if (state.prefetching.includes(event.videoId)) return state;
      return { ...state, prefetching: [...state.prefetching, event.videoId] };

    case 'prefetchDone':
      return {
        ...state,
        urls: { ...state.urls, [event.videoId]: event.url },
        prefetching: state.prefetching.filter((v) => v !== event.videoId),
      };

    case 'prefetchFailed':
      // Prefetch gagal bukan kesalahan yang perlu ditampilkan: lagu itu akan dicoba
      // ulang secara normal saat benar-benar tiba waktunya diputar.
      return { ...state, prefetching: state.prefetching.filter((v) => v !== event.videoId) };

    case 'detailsStart':
      if (state.detailsPending.includes(event.videoId)) return state;
      return { ...state, detailsPending: [...state.detailsPending, event.videoId] };

    case 'detailsDone':
      return {
        ...state,
        details: { ...state.details, [event.videoId]: event.details },
        detailsPending: state.detailsPending.filter((v) => v !== event.videoId),
      };

    case 'detailsFailed':
      /**
       * Disimpan sebagai keterangan kosong, bukan dihapus dari daftar. Kalau dihapus,
       * efek pengambilnya akan mencoba lagi tanpa henti setiap render. Konsekuensinya
       * lagu ini tidak dapat lirik dan tidak menyambung antrean — tapi musiknya tetap
       * berjalan, dan itu yang lebih penting.
       */
      return {
        ...state,
        details: { ...state.details, [event.videoId]: { lyricsId: '', upNext: [] } },
        detailsPending: state.detailsPending.filter((v) => v !== event.videoId),
        // Tidak ada tambahan yang akan datang, jadi berhenti menunggu.
        awaitingMore: false,
      };

    case 'continueQueue': {
      const known = new Set(state.queue.map((q) => q.videoId));
      const fresh = event.songs.filter((s) => s.videoId && !known.has(s.videoId));
      // Tetap tandai sudah disambung walau tidak ada lagu baru, agar tidak dicoba terus.
      const continued = state.continued.includes(event.from)
        ? state.continued
        : [...state.continued, event.from];
      if (fresh.length === 0) return { ...state, continued };

      const queue = [...state.queue, ...fresh];
      const added = fresh.map((_, i) => state.queue.length + i);
      // Lagu tambahan ikut diacak kalau mode acak menyala, tapi hanya di antara
      // dirinya sendiri — urutan yang sudah diputar tidak boleh berubah.
      const appended = state.shuffle
        ? shuffleOrder(added, undefined, event.rng ?? Math.random)
        : added;
      const order = [...state.order, ...appended];

      // Lagu terakhir sudah habis sambil menunggu tambahan ini: langsung lanjut.
      if (state.awaitingMore) {
        return {
          ...state,
          queue,
          order,
          continued,
          position: state.position + 1,
          status: 'preparing',
          percent: 0,
          label: '',
          awaitingMore: false,
        };
      }
      return { ...state, queue, order, continued };
    }

    case 'toggleAutoContinue':
      return { ...state, autoContinue: !state.autoContinue };

    case 'toggleRepeat': {
      const cycle: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
      return { ...state, repeat: cycle[state.repeat] };
    }

    case 'toggleShuffle': {
      const shuffle = !state.shuffle;
      const currentIdx = state.order[state.position];
      if (state.order.length === 0) return { ...state, shuffle };
      if (shuffle) {
        const order = shuffleOrder(
          sequential(state.queue.length),
          currentIdx,
          event.rng ?? Math.random,
        );
        return { ...state, shuffle, order, position: 0 };
      }
      const order = sequential(state.queue.length);
      return { ...state, shuffle, order, position: currentIdx ?? 0 };
    }

    case 'clear':
      // URL yang sudah dikonversi tetap disimpan — mahal didapat, sayang dibuang.
      // Keterangan lagu juga: sudah terbayar, dan masih benar kalau lagunya diputar lagi.
      return {
        ...INITIAL_YT_STATE,
        urls: state.urls,
        details: state.details,
        repeat: state.repeat,
        shuffle: state.shuffle,
        autoContinue: state.autoContinue,
      };

    default:
      return state;
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Antrean dari YouTube kadang memuat videoId yang sama dua kali. */
function dedupe(songs: Song[]): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of songs) {
    if (!s.videoId || seen.has(s.videoId)) continue;
    seen.add(s.videoId);
    out.push(s);
  }
  return out;
}

export const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: 'Ulang: mati',
  all: 'Ulang semua',
  one: 'Ulang satu lagu',
};
