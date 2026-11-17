/**
 * Hook pemutar musik: menyambungkan mesin antrean (`queue-core`), klien Worker
 * (`api-client`), dan satu elemen `<audio>`.
 *
 * Diturunkan dari `src/useYtPlayer.ts` di `seseegy/music-taskify`. Yang ditambahkan di sini:
 * **action handler `mediaSession`**, supaya musiknya bisa dikontrol dari layar kunci dan
 * notifikasi media Android. Versi asal hanya mengisi metadata, jadi judulnya tampil di layar
 * kunci tapi tombolnya tidak melakukan apa-apa.
 *
 * Satu batas yang membentuk seluruh rancangan: **audionya tidak bisa digeser posisinya.** URL
 * dari konverter tidak mengirim `Accept-Ranges` (`Range: bytes=…` dijawab 200 dengan seluruh
 * berkas), jadi yang ada hanya putar, jeda, dan pindah lagu. Itu batas layanan hulunya, bukan
 * sesuatu yang bisa diakali di sini — karena itu tidak ada `seek()` di API ini, dan `elapsed`
 * hanya untuk ditampilkan.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MusicClient } from './api-client';
import {
  INITIAL_YT_STATE,
  currentLyricsId,
  currentSong,
  currentUrl,
  detailsTarget,
  nextPosition,
  prefetchTarget,
  prevPosition,
  reduceYt,
  type RepeatMode,
  type YtEvent,
  type YtState,
  type YtStatus,
} from './queue-core';
import { parseDuration } from './music-view';
import { settleQueue } from './queue-settle';
import type { Song } from './types';

export interface MusicPlayerApi {
  status: YtStatus;
  /** Lagu yang sedang diputar, atau null kalau antrean kosong. */
  song: Song | null;
  queue: Song[];
  /** Posisi lagu sekarang di dalam `queue` (bukan di urutan acak). -1 bila antrean kosong. */
  queueIndex: number;
  /** Progres penyiapan audio 0–100, hanya berarti saat status `preparing`. */
  percent: number;
  label: string;
  error: string;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Menyambung antrean sendiri saat lagu terakhir habis. */
  autoContinue: boolean;
  /** Lagu terakhir habis dan sedang menunggu lagu lanjutan tiba. */
  awaitingMore: boolean;
  /** Id lirik lagu sekarang; kosong kalau lagu ini tidak punya lirik atau belum tiba. */
  lyricsId: string;
  /** Detik yang sudah berjalan. **Hanya untuk ditampilkan** — audionya tidak bisa di-seek. */
  elapsed: number;
  /** Durasi lagu sekarang dalam detik, atau 0 bila hulu tidak memberinya. */
  totalSeconds: number;
  /** Nama album lagu sekarang; kosong bila belum tiba atau hulu tidak memberinya. */
  album: string;
  /** URL audio lagu sekarang sudah siap (jadi putar/jeda tetap bisa saat offline). */
  hasUrl: boolean;
  hasNext: boolean;
  hasPrev: boolean;
  play(songs: Song[], startAt?: number): void;
  toggle(): void;
  pause(): void;
  /** Melanjutkan lagu yang dijeda. Tidak melakukan apa-apa kalau antrean kosong. */
  resume(): void;
  next(): void;
  prev(): void;
  jumpTo(songIndex: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  toggleRepeat(): void;
  toggleShuffle(): void;
  toggleAutoContinue(): void;
  stop(): void;
}

/**
 * `audioRef` datang dari komponen, bukan dibuat di sini: yang memiliki simpul DOM adalah
 * yang merendernya (`MusicBar`), dan hook ini hanya menggerakkannya. Mengembalikan ref dari
 * dalam objek API juga membuat seluruh objek itu dianggap "ref-like" oleh
 * `react-hooks/refs`, sehingga setiap pembacaan `player.x` di JSX jadi pelanggaran.
 */
export function useMusicPlayer(
  client: MusicClient | null,
  audioRef: RefObject<HTMLAudioElement | null>,
): MusicPlayerApi {
  const [state, setState] = useState<YtState>(INITIAL_YT_STATE);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /**
   * Nama album per videoId, dari `/v1/track`.
   *
   * Disimpan di sini dan **bukan** di dalam `TrackDetails` milik `queue-core`: album murni
   * metadata tampilan — tidak ada satu pun keputusan mesin antrean yang bergantung padanya.
   * Menambahkannya ke sana berarti mengubah berkas yang dipindahkan apa adanya beserta 60
   * tesnya, demi satu baris teks di layar.
   */
  const [albums, setAlbums] = useState<Record<string, string>>({});

  /**
   * Setiap peristiwa langsung dirapikan oleh `settleQueue` — menyambung antrean dan melewati
   * status `preparing` untuk audio yang sudah ada. Keduanya transisi murni, jadi tempatnya
   * di dalam perhitungan keadaan, bukan di `useEffect` yang memanggil `setState` lagi.
   */
  const send = useCallback(
    (event: YtEvent) => setState((s) => settleQueue(reduceYt(s, event))),
    [],
  );

  /**
   * Menandai konversi mana yang masih relevan. Kalau pengguna pindah lagu saat konversi
   * berjalan, hasil konversi lama harus diabaikan — tanpa ini audio bisa tiba-tiba berganti
   * ke lagu yang sudah dilewati.
   */
  const jobRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const song = currentSong(state);
  const readyUrl = currentUrl(state);
  const songId = song?.videoId ?? '';

  // ----------------------------------------------------------------- menyiapkan audio
  const hasUrl = Boolean(state.urls[songId]);
  const alreadyPrefetching = state.prefetching.includes(songId);

  useEffect(() => {
    if (!client || !songId || state.status !== 'preparing') return;
    /**
     * Status `preparing` dengan URL yang sudah ada tidak mungkin sampai ke sini —
     * `settleQueue` sudah mengubahnya jadi `playing` di dalam reducer. Jadi mulai dari titik
     * ini, "preparing" selalu berarti audionya memang belum ada.
     *
     * Satu kekecualian yang perlu diperiksa: lagu ini sedang disiapkan di latar belakang
     * (pengguna menekan "berikutnya" sebelum prefetch-nya selesai). Yang benar adalah
     * MENUNGGU hasil itu, bukan memulai konversi kedua untuk lagu yang sama — selain
     * membuang kuota, konverternya juga jadi mengerjakan pekerjaan yang sama dua kali.
     * Begitu URL-nya tiba, `settleQueue` yang memindahkan statusnya.
     */
    if (alreadyPrefetching) return;

    const token = (jobRef.current += 1);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    client
      .resolveStream(songId, {
        signal: controller.signal,
        onProgress: ({ percent, label }) => {
          if (jobRef.current === token) send({ type: 'progress', percent, label });
        },
      })
      .then((url) => {
        if (jobRef.current !== token) return;
        send({ type: 'ready', videoId: songId, url });
        send({ type: 'playing' });
      })
      .catch((err: unknown) => {
        if (jobRef.current !== token) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Gagal memuat audio.',
        });
      });

    return () => controller.abort();
  }, [client, songId, state.status, hasUrl, alreadyPrefetching, send]);

  // ------------------------------------------- menyiapkan lagu berikutnya diam-diam
  const prefetchId = prefetchTarget(state);
  /** Penjaga agar satu lagu tidak diprefetch dua kali oleh render yang berbeda. */
  const inFlightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => () => void (mountedRef.current = false), []);

  useEffect(() => {
    if (!client || !prefetchId) return;
    if (inFlightRef.current.has(prefetchId)) return;
    inFlightRef.current.add(prefetchId);
    send({ type: 'prefetchStart', videoId: prefetchId });

    /**
     * Dibatalkan saat lagu berubah. Efek ini hanya berjalan ulang bila `prefetchId`
     * berubah (`client` singleton modul, `send` stabil) — jadi pembersihan di sini
     * berarti "lagu berikutnya sudah bukan lagu ini lagi", bukan "render ulang biasa".
     * Tanpa ini, loop poll prefetch lagu lama terus berjalan berdampingan dengan loop
     * lagu aktif sampai konversinya selesai, dan keduanya bersama-sama menembus bucket
     * poll Worker (60/menit) sampai kena 429.
     *
     * Pembatalan juga membersihkan penanda `prefetching` di state (lewat
     * `prefetchFailed`, yang di sini hanya berarti "tidak jadi disiapkan") supaya lagu
     * itu bisa diprefetch lagi nanti bila kembali jadi lagu berikutnya.
     */
    const controller = new AbortController();
    client
      .resolveStream(prefetchId, { signal: controller.signal })
      .then((url) => {
        if (mountedRef.current) send({ type: 'prefetchDone', videoId: prefetchId, url });
      })
      .catch(() => {
        inFlightRef.current.delete(prefetchId);
        if (mountedRef.current) send({ type: 'prefetchFailed', videoId: prefetchId });
      });

    return () => controller.abort();
  }, [client, prefetchId, send]);

  // ----------------------------------------- mengambil keterangan lagu sekarang
  /**
   * Satu permintaan `/v1/track` memberi dua hal sekaligus: id lirik dan antrean lanjutan.
   * Karena itu diambil sekali per lagu, bukan dua kali untuk dua keperluan.
   *
   * Sama seperti prefetch, ini "tembak dan lupakan" — efeknya ikut berjalan ulang setiap
   * keadaan berubah, jadi membatalkannya di pembersihan akan membuat hasilnya tidak pernah
   * tiba.
   */
  const detailsId = detailsTarget(state);
  const detailsInFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!client || !detailsId) return;
    if (detailsInFlight.current.has(detailsId)) return;
    detailsInFlight.current.add(detailsId);
    send({ type: 'detailsStart', videoId: detailsId });

    client
      .track(detailsId)
      .then((track) => {
        if (!mountedRef.current) return;
        if (track.album) setAlbums((prev) => ({ ...prev, [detailsId]: track.album }));
        send({
          type: 'detailsDone',
          videoId: detailsId,
          details: { lyricsId: track.lyricsId, upNext: track.upNext },
        });
      })
      .catch(() => {
        detailsInFlight.current.delete(detailsId);
        if (mountedRef.current) send({ type: 'detailsFailed', videoId: detailsId });
      });
  }, [client, detailsId, send]);

  // Penyambungan antrean otomatis tidak butuh efek: ia transisi murni dan dikerjakan
  // `settleQueue` tiap peristiwa. Lihat `queue-settle.ts`.

  // ----------------------------------------------------------- menyetel elemen audio
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !readyUrl) return;
    if (el.src !== readyUrl) {
      el.src = readyUrl;
      setElapsed(0);
    }
    if (state.status === 'playing') {
      void el.play().catch(() => {
        // Peramban menolak memutar tanpa interaksi pengguna. Ditampilkan sebagai jeda, bukan
        // error, supaya pengguna tinggal menekan tombol putar.
        send({ type: 'paused' });
      });
    } else {
      el.pause();
    }
  }, [readyUrl, state.status, send, audioRef]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.volume = volume;
      el.muted = muted;
    }
  }, [volume, muted, audioRef]);

  // -------------------------------------------------------------- peristiwa audio
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => send({ type: 'ended' });
    const onTime = () => setElapsed(el.currentTime);
    const onError = () => {
      // URL konverter bisa kedaluwarsa. Minta konversi ulang, jangan menyerah.
      send({ type: 'error', message: 'Audio gagal diputar. Coba putar ulang lagunya.' });
    };
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('error', onError);
    };
  }, [send, audioRef]);

  const queueIndex = state.order[state.position] ?? -1;
  const hasNext = nextPosition(state, true) !== null;
  const hasPrev = prevPosition(state) !== null;
  const totalSeconds = parseDuration(song?.duration ?? '') ?? 0;
  const album = albums[songId] ?? '';

  const api = useMemo<MusicPlayerApi>(
    () => ({
      status: state.status,
      song,
      queue: state.queue,
      queueIndex,
      percent: state.percent,
      label: state.label,
      error: state.error,
      volume,
      muted,
      repeat: state.repeat,
      shuffle: state.shuffle,
      autoContinue: state.autoContinue,
      awaitingMore: state.awaitingMore,
      lyricsId: currentLyricsId(state),
      elapsed,
      totalSeconds,
      album,
      hasUrl,
      hasNext,
      hasPrev,
      play: (songs, startAt) => send({ type: 'setQueue', songs, startAt }),
      toggle: () => {
        if (state.status === 'playing') send({ type: 'paused' });
        else if (state.status === 'paused') send({ type: 'playing' });
        else if (state.status === 'error') send({ type: 'preparing' });
      },
      pause: () => send({ type: 'paused' }),
      resume: () => {
        if (state.status === 'paused') send({ type: 'playing' });
        else if (state.status === 'error') send({ type: 'preparing' });
      },
      next: () => send({ type: 'next' }),
      prev: () => send({ type: 'prev' }),
      jumpTo: (songIndex) => {
        const pos = state.order.indexOf(songIndex);
        if (pos >= 0) send({ type: 'jump', position: pos });
      },
      setVolume: (v) => setVolumeState(Math.min(1, Math.max(0, v))),
      toggleMute: () => setMuted((m) => !m),
      toggleRepeat: () => send({ type: 'toggleRepeat' }),
      toggleShuffle: () => send({ type: 'toggleShuffle' }),
      toggleAutoContinue: () => send({ type: 'toggleAutoContinue' }),
      stop: () => {
        jobRef.current += 1;
        abortRef.current?.abort();
        audioRef.current?.pause();
        send({ type: 'clear' });
      },
    }),
    [
      state,
      song,
      queueIndex,
      volume,
      muted,
      elapsed,
      totalSeconds,
      album,
      hasUrl,
      hasNext,
      hasPrev,
      send,
      audioRef,
    ],
  );

  useMediaSession(api);

  return api;
}

/**
 * Kontrol dari sistem operasi: layar kunci Android, notifikasi media, dan tombol media di
 * papan tunjuk.
 *
 * Metadata saja tidak cukup — tanpa action handler, judul lagunya tampil di layar kunci tapi
 * tombol putar/jeda/berikutnya di sana **tidak melakukan apa-apa**. Itu lebih buruk daripada
 * tidak menampilkan apa pun, karena tombolnya terlihat seperti bisa dipakai.
 */
function useMediaSession(api: MusicPlayerApi) {
  /**
   * Handler dipasang SEKALI, lalu membaca API terbaru lewat ref.
   *
   * Kalau `api` jadi dependensi efeknya, handler-nya dipasang ulang setiap kali keadaan
   * berubah — termasuk setiap laporan progres dan setiap `timeupdate` (empat kali sedetik).
   * `setActionHandler` memang murah, tapi memanggilnya terus-menerus selama lagu berjalan
   * tidak ada gunanya.
   */
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, (() => void) | null][] = [
      ['play', () => apiRef.current.resume()],
      ['pause', () => apiRef.current.pause()],
      ['nexttrack', () => apiRef.current.next()],
      ['previoustrack', () => apiRef.current.prev()],
    ];
    const set = (action: MediaSessionAction, handler: (() => void) | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Aksi yang tidak didukung peramban ini melempar TypeError. Bukan alasan untuk
        // menggagalkan tiga aksi lainnya.
      }
    };
    for (const [action, handler] of handlers) set(action, handler);
    return () => {
      for (const [action] of handlers) set(action, null);
      ms.playbackState = 'none';
    };
  }, []);

  // `seekto`, `seekforward`, dan `seekbackward` SENGAJA tidak dipasang: audionya tidak bisa
  // di-seek. Memasangnya akan membuat layar kunci menampilkan bilah geser yang diam.
  const { song, status } = api;
  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const ms = navigator.mediaSession;
    if (!song) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    ms.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      artwork: song.thumbnails.map((t) => ({
        src: t.url,
        sizes: `${t.width}x${t.height}`,
        type: 'image/jpeg',
      })),
    });
    ms.playbackState = status === 'playing' ? 'playing' : 'paused';
  }, [song, status]);
}
