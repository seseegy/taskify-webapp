import { describe, expect, it } from 'vitest';

import {
  INITIAL_YT_STATE,
  continuationSource,
  currentLyricsId,
  currentSong,
  currentUrl,
  detailsTarget,
  nextPosition,
  prefetchTarget,
  prevPosition,
  reduceYt,
  shuffleOrder,
  type TrackDetails,
  type YtEvent,
  type YtState,
} from './queue-core';
import type { Song } from './types';

const song = (id: string, title = id): Song => ({
  videoId: id,
  title,
  artist: 'Artis',
  duration: '3.00',
  thumbnails: [],
  url: `https://music.youtube.com/watch?v=${id}`,
});

const songs = (...ids: string[]) => ids.map((id) => song(id));

const detail = (lyricsId: string, ...upNextIds: string[]): TrackDetails => ({
  lyricsId,
  upNext: songs(...upNextIds),
});

const run = (events: YtEvent[], start: YtState = INITIAL_YT_STATE): YtState =>
  events.reduce(reduceYt, start);

/** Antrean tiga lagu yang sedang memutar lagu pertama. */
const playingFirst = () =>
  run([
    { type: 'setQueue', songs: songs('a', 'b', 'c') },
    { type: 'ready', videoId: 'a', url: 'u-a' },
    { type: 'playing' },
  ]);

describe('mengisi antrean', () => {
  it('mulai menyiapkan lagu pertama', () => {
    const s = run([{ type: 'setQueue', songs: songs('a', 'b') }]);
    expect(s.status).toBe('preparing');
    expect(currentSong(s)?.videoId).toBe('a');
    expect(s.order).toEqual([0, 1]);
  });

  it('bisa mulai dari lagu tertentu', () => {
    const s = run([{ type: 'setQueue', songs: songs('a', 'b', 'c'), startAt: 2 }]);
    expect(currentSong(s)?.videoId).toBe('c');
  });

  it('startAt di luar jangkauan dijepit, tidak bikin antrean kosong', () => {
    expect(
      currentSong(run([{ type: 'setQueue', songs: songs('a', 'b'), startAt: 99 }]))?.videoId,
    ).toBe('b');
    expect(
      currentSong(run([{ type: 'setQueue', songs: songs('a', 'b'), startAt: -5 }]))?.videoId,
    ).toBe('a');
  });

  it('membuang videoId ganda dari antrean YouTube', () => {
    const s = run([{ type: 'setQueue', songs: songs('a', 'b', 'a', 'c', 'b') }]);
    expect(s.queue.map((x) => x.videoId)).toEqual(['a', 'b', 'c']);
  });

  it('membuang baris tanpa videoId', () => {
    const s = run([{ type: 'setQueue', songs: [song('a'), { ...song(''), title: 'rusak' }] }]);
    expect(s.queue).toHaveLength(1);
  });

  it('antrean kosong mengembalikan keadaan awal tapi URL tetap disimpan', () => {
    const s = run([
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'setQueue', songs: [] },
    ]);
    expect(s.status).toBe('idle');
    expect(s.urls).toEqual({ a: 'u-a' });
  });
});

describe('perpindahan lagu', () => {
  it('lagu selesai lanjut ke berikutnya', () => {
    const s = reduceYt(playingFirst(), { type: 'ended' });
    expect(currentSong(s)?.videoId).toBe('b');
    expect(s.status).toBe('preparing');
  });

  it('lagu terakhir selesai dan ulang mati: berhenti di tempat', () => {
    const s = run(
      [{ type: 'jump', position: 2 }, { type: 'playing' }, { type: 'ended' }],
      playingFirst(),
    );
    expect(currentSong(s)?.videoId).toBe('c');
    expect(s.status).toBe('paused');
  });

  it('ulang semua: lagu terakhir kembali ke awal', () => {
    const s = run(
      [
        { type: 'toggleRepeat' },
        { type: 'jump', position: 2 },
        { type: 'playing' },
        { type: 'ended' },
      ],
      playingFirst(),
    );
    expect(s.repeat).toBe('all');
    expect(currentSong(s)?.videoId).toBe('a');
  });

  it('ulang satu: lagu selesai memutar lagu yang sama tanpa konversi ulang', () => {
    const s = run(
      [{ type: 'toggleRepeat' }, { type: 'toggleRepeat' }, { type: 'ended' }],
      playingFirst(),
    );
    expect(s.repeat).toBe('one');
    expect(currentSong(s)?.videoId).toBe('a');
    // URL sudah ada, jadi tidak perlu kembali ke status menyiapkan.
    expect(s.status).toBe('playing');
  });

  it('tombol berikutnya tetap pindah lagu walau ulang-satu aktif', () => {
    const s = run(
      [{ type: 'toggleRepeat' }, { type: 'toggleRepeat' }, { type: 'next' }],
      playingFirst(),
    );
    expect(currentSong(s)?.videoId).toBe('b');
  });

  it('tombol sebelumnya di lagu pertama tidak melakukan apa-apa saat ulang mati', () => {
    const before = playingFirst();
    expect(reduceYt(before, { type: 'prev' })).toBe(before);
  });

  it('tombol sebelumnya di lagu pertama melingkar ke akhir saat ulang semua', () => {
    const s = run([{ type: 'toggleRepeat' }, { type: 'prev' }], playingFirst());
    expect(currentSong(s)?.videoId).toBe('c');
  });

  it('jump di luar jangkauan diabaikan', () => {
    const before = playingFirst();
    expect(reduceYt(before, { type: 'jump', position: 9 })).toBe(before);
    expect(reduceYt(before, { type: 'jump', position: -1 })).toBe(before);
  });

  it('antrean kosong: next/prev aman', () => {
    expect(nextPosition(INITIAL_YT_STATE)).toBeNull();
    expect(prevPosition(INITIAL_YT_STATE)).toBeNull();
    expect(reduceYt(INITIAL_YT_STATE, { type: 'next' })).toBe(INITIAL_YT_STATE);
  });
});

describe('status pemutar', () => {
  it('jeda hanya berlaku saat sedang berbunyi', () => {
    const preparing = run([{ type: 'setQueue', songs: songs('a') }]);
    expect(reduceYt(preparing, { type: 'paused' }).status).toBe('preparing');
    expect(reduceYt(playingFirst(), { type: 'paused' }).status).toBe('paused');
  });

  it('progres yang datang terlambat tidak menimpa status lain', () => {
    const s = reduceYt(playingFirst(), { type: 'progress', percent: 40, label: 'x' });
    expect(s.percent).toBe(100);
    expect(s.label).toBe('');
  });

  it('progres tercatat saat sedang menyiapkan', () => {
    const s = run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'progress', percent: 40, label: 'Menyiapkan audio… 40%' },
    ]);
    expect(s.percent).toBe(40);
    expect(s.label).toBe('Menyiapkan audio… 40%');
  });

  it('error menyimpan pesan, dan mulai memutar menghapusnya', () => {
    const bad = reduceYt(playingFirst(), { type: 'error', message: 'Gagal' });
    expect(bad.status).toBe('error');
    expect(bad.error).toBe('Gagal');
    expect(reduceYt(bad, { type: 'playing' }).error).toBe('');
  });

  it('URL yang sudah siap bisa dibaca kembali', () => {
    expect(currentUrl(playingFirst())).toBe('u-a');
    expect(currentUrl(INITIAL_YT_STATE)).toBeNull();
  });
});

describe('prefetch lagu berikutnya', () => {
  it('menyiapkan lagu berikutnya selagi lagu sekarang berbunyi', () => {
    expect(prefetchTarget(playingFirst())).toBe('b');
  });

  it('tidak prefetch saat lagu sekarang masih dikonversi', () => {
    // Kalau tidak, konversi lagu yang ditunggu pengguna jadi berebut jatah.
    const s = run([{ type: 'setQueue', songs: songs('a', 'b') }]);
    expect(prefetchTarget(s)).toBeNull();
  });

  it('tetap prefetch saat dijeda, supaya lanjut terasa instan', () => {
    const s = reduceYt(playingFirst(), { type: 'paused' });
    expect(prefetchTarget(s)).toBe('b');
  });

  it('tidak prefetch lagu yang URL-nya sudah ada', () => {
    const s = reduceYt(playingFirst(), { type: 'prefetchDone', videoId: 'b', url: 'u-b' });
    expect(prefetchTarget(s)).toBeNull();
  });

  it('tidak prefetch dua kali untuk lagu yang sama', () => {
    const s = reduceYt(playingFirst(), { type: 'prefetchStart', videoId: 'b' });
    expect(prefetchTarget(s)).toBeNull();
    // Permintaan start kedua tidak menggandakan daftar.
    expect(reduceYt(s, { type: 'prefetchStart', videoId: 'b' }).prefetching).toEqual(['b']);
  });

  it('prefetch gagal tidak memunculkan error ke pengguna', () => {
    const s = run(
      [
        { type: 'prefetchStart', videoId: 'b' },
        { type: 'prefetchFailed', videoId: 'b' },
      ],
      playingFirst(),
    );
    expect(s.status).toBe('playing');
    expect(s.error).toBe('');
    // Dan boleh dicoba lagi.
    expect(prefetchTarget(s)).toBe('b');
  });

  it('tidak prefetch di lagu terakhir saat ulang mati', () => {
    const s = run([{ type: 'jump', position: 2 }, { type: 'playing' }], playingFirst());
    expect(prefetchTarget(s)).toBeNull();
  });

  it('di lagu terakhir dengan ulang semua, menyiapkan lagu pertama', () => {
    const s = run(
      [{ type: 'toggleRepeat' }, { type: 'jump', position: 2 }, { type: 'playing' }],
      playingFirst(),
    );
    // Lagu pertama URL-nya sudah ada dari pemutaran sebelumnya.
    expect(prefetchTarget(s)).toBeNull();
    const fresh = run([
      { type: 'setQueue', songs: songs('a', 'b') },
      { type: 'toggleRepeat' },
      { type: 'jump', position: 1 },
      { type: 'ready', videoId: 'b', url: 'u-b' },
      { type: 'playing' },
    ]);
    expect(prefetchTarget(fresh)).toBe('a');
  });

  it('ulang satu tidak perlu prefetch apa pun', () => {
    const s = run([{ type: 'toggleRepeat' }, { type: 'toggleRepeat' }], playingFirst());
    expect(prefetchTarget(s)).toBeNull();
  });

  it('URL hasil prefetch langsung dipakai saat lagu itu tiba', () => {
    const s = run(
      [{ type: 'prefetchDone', videoId: 'b', url: 'u-b' }, { type: 'next' }],
      playingFirst(),
    );
    expect(currentUrl(s)).toBe('u-b');
  });
});

describe('mode acak', () => {
  const rng = () => 0; // selalu menukar ke indeks 0, hasilnya pasti

  it('menjaga lagu sekarang tetap di depan', () => {
    const s = reduceYt(playingFirst(), { type: 'toggleShuffle', rng });
    expect(s.shuffle).toBe(true);
    expect(currentSong(s)?.videoId).toBe('a');
    expect(s.position).toBe(0);
  });

  it('mematikan acak mengembalikan urutan asli dan posisi lagu sekarang', () => {
    const s = run(
      [
        { type: 'jump', position: 1 },
        { type: 'toggleShuffle', rng },
        { type: 'toggleShuffle', rng },
      ],
      playingFirst(),
    );
    expect(s.order).toEqual([0, 1, 2]);
    expect(currentSong(s)?.videoId).toBe('b');
  });

  it('urutan acak memuat semua lagu tanpa kehilangan atau menggandakan', () => {
    const s = reduceYt(playingFirst(), { type: 'toggleShuffle', rng: Math.random });
    expect([...s.order].sort()).toEqual([0, 1, 2]);
  });

  it('acak pada antrean kosong tidak error', () => {
    expect(reduceYt(INITIAL_YT_STATE, { type: 'toggleShuffle', rng }).shuffle).toBe(true);
  });

  it('shuffleOrder menempatkan keepFirst di depan', () => {
    const out = shuffleOrder([0, 1, 2, 3], 2, rng);
    expect(out[0]).toBe(2);
    expect([...out].sort()).toEqual([0, 1, 2, 3]);
  });

  it('shuffleOrder tanpa keepFirst tetap memuat semuanya', () => {
    expect([...shuffleOrder([0, 1, 2], undefined, Math.random)].sort()).toEqual([0, 1, 2]);
  });
});

describe('mode ulang berputar tiga tahap', () => {
  it('mati → semua → satu → mati', () => {
    let s = INITIAL_YT_STATE;
    expect(s.repeat).toBe('off');
    s = reduceYt(s, { type: 'toggleRepeat' });
    expect(s.repeat).toBe('all');
    s = reduceYt(s, { type: 'toggleRepeat' });
    expect(s.repeat).toBe('one');
    s = reduceYt(s, { type: 'toggleRepeat' });
    expect(s.repeat).toBe('off');
  });
});

describe('membersihkan antrean', () => {
  it('menyimpan URL, mode ulang, dan mode acak', () => {
    const s = run(
      [{ type: 'toggleRepeat' }, { type: 'toggleShuffle' }, { type: 'clear' }],
      playingFirst(),
    );
    expect(s.queue).toEqual([]);
    expect(s.status).toBe('idle');
    expect(s.urls).toEqual({ a: 'u-a' });
    expect(s.repeat).toBe('all');
    expect(s.shuffle).toBe(true);
  });
});

// ------------------------------------------------------------------ antrean lanjutan
describe('keterangan lagu', () => {
  it('diambil begitu lagu berbunyi, bukan nanti saat dibutuhkan', () => {
    expect(detailsTarget(playingFirst())).toBe('a');
  });

  it('tidak diambil saat masih dikonversi', () => {
    expect(detailsTarget(run([{ type: 'setQueue', songs: songs('a') }]))).toBeNull();
  });

  it('tidak diambil dua kali', () => {
    const started = reduceYt(playingFirst(), { type: 'detailsStart', videoId: 'a' });
    expect(detailsTarget(started)).toBeNull();
    expect(reduceYt(started, { type: 'detailsStart', videoId: 'a' }).detailsPending).toEqual(['a']);
  });

  it('tidak diambil lagi setelah tiba', () => {
    const s = run(
      [{ type: 'detailsDone', videoId: 'a', details: detail('L1', 'd') }],
      playingFirst(),
    );
    expect(detailsTarget(s)).toBeNull();
    expect(currentLyricsId(s)).toBe('L1');
  });

  it('gagal diambil dicatat sebagai kosong supaya tidak dicoba tanpa henti', () => {
    const s = run(
      [
        { type: 'detailsStart', videoId: 'a' },
        { type: 'detailsFailed', videoId: 'a' },
      ],
      playingFirst(),
    );
    expect(detailsTarget(s)).toBeNull();
    expect(s.detailsPending).toEqual([]);
    expect(currentLyricsId(s)).toBe('');
    // Dan musiknya tetap berjalan.
    expect(s.status).toBe('playing');
  });

  it('keterangan tetap tersimpan setelah antrean dikosongkan', () => {
    const s = run(
      [{ type: 'detailsDone', videoId: 'a', details: detail('L1', 'd') }, { type: 'clear' }],
      playingFirst(),
    );
    expect(s.details.a?.lyricsId).toBe('L1');
  });
});

describe('penyambungan antrean otomatis', () => {
  /** Antrean satu lagu yang sedang berbunyi, keterangannya sudah tiba. */
  const atTail = () =>
    run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'playing' },
      { type: 'detailsDone', videoId: 'a', details: detail('L1', 'd', 'e') },
    ]);

  it('menyala secara bawaan', () => {
    expect(INITIAL_YT_STATE.autoContinue).toBe(true);
  });

  it('menawarkan lagu lanjutan saat posisi di lagu terakhir', () => {
    const src = continuationSource(atTail());
    expect(src?.from).toBe('a');
    expect(src?.songs.map((s) => s.videoId)).toEqual(['d', 'e']);
  });

  it('tidak menawarkan apa pun kalau masih ada lagu berikutnya', () => {
    const s = run(
      [{ type: 'detailsDone', videoId: 'a', details: detail('', 'd') }],
      playingFirst(),
    );
    expect(continuationSource(s)).toBeNull();
  });

  it('tidak menawarkan apa pun saat mode ulang menyala — antrean tidak pernah habis', () => {
    const s = reduceYt(atTail(), { type: 'toggleRepeat' });
    expect(s.repeat).toBe('all');
    expect(continuationSource(s)).toBeNull();
  });

  it('tidak menawarkan apa pun kalau penyambungan dimatikan', () => {
    const s = reduceYt(atTail(), { type: 'toggleAutoContinue' });
    expect(s.autoContinue).toBe(false);
    expect(continuationSource(s)).toBeNull();
  });

  it('menyambung antrean dan tidak pernah menyambung dari lagu yang sama dua kali', () => {
    const s = reduceYt(atTail(), { type: 'continueQueue', from: 'a', songs: songs('d', 'e') });
    expect(s.queue.map((x) => x.videoId)).toEqual(['a', 'd', 'e']);
    expect(s.order).toEqual([0, 1, 2]);
    expect(continuationSource(s)).toBeNull();
  });

  it('membuang lagu yang sudah ada di antrean', () => {
    const s = reduceYt(atTail(), { type: 'continueQueue', from: 'a', songs: songs('a', 'd', 'a') });
    expect(s.queue.map((x) => x.videoId)).toEqual(['a', 'd']);
  });

  it('tetap menandai sudah disambung walau semua lagunya ternyata duplikat', () => {
    const s = reduceYt(atTail(), { type: 'continueQueue', from: 'a', songs: songs('a') });
    expect(s.continued).toContain('a');
    expect(s.queue).toHaveLength(1);
  });

  it('lagu yang sudah lewat tidak berubah urutannya saat mode acak menyala', () => {
    const shuffled = reduceYt(atTail(), { type: 'toggleShuffle', rng: () => 0 });
    const before = shuffled.order;
    const s = reduceYt(shuffled, {
      type: 'continueQueue',
      from: 'a',
      songs: songs('d', 'e', 'f'),
      rng: () => 0,
    });
    expect(s.order.slice(0, before.length)).toEqual(before);
    expect([...s.order].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });

  it('antrean baru menghapus riwayat penyambungan', () => {
    const s = run(
      [{ type: 'setQueue', songs: songs('x', 'y') }],
      reduceYt(atTail(), {
        type: 'continueQueue',
        from: 'a',
        songs: songs('d'),
      }),
    );
    expect(s.continued).toEqual([]);
  });
});

describe('lagu terakhir habis sebelum lanjutan tiba', () => {
  const tailNoDetails = () =>
    run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'playing' },
    ]);

  it('ditandai menunggu, bukan sekadar dijeda', () => {
    const s = reduceYt(tailNoDetails(), { type: 'ended' });
    expect(s.status).toBe('paused');
    expect(s.awaitingMore).toBe(true);
  });

  it('lanjutan yang tiba terlambat langsung diputar, tanpa menunggu pengguna', () => {
    const s = run(
      [
        { type: 'ended' },
        { type: 'detailsDone', videoId: 'a', details: detail('', 'd') },
        { type: 'continueQueue', from: 'a', songs: songs('d') },
      ],
      tailNoDetails(),
    );
    expect(currentSong(s)?.videoId).toBe('d');
    expect(s.status).toBe('preparing');
    expect(s.awaitingMore).toBe(false);
  });

  it('tidak menunggu kalau penyambungan dimatikan', () => {
    const s = run([{ type: 'toggleAutoContinue' }, { type: 'ended' }], tailNoDetails());
    expect(s.awaitingMore).toBe(false);
  });

  it('keterangan yang gagal diambil menghentikan penungguan', () => {
    const s = run([{ type: 'ended' }, { type: 'detailsFailed', videoId: 'a' }], tailNoDetails());
    expect(s.awaitingMore).toBe(false);
    expect(s.status).toBe('paused');
  });

  it('pengguna menekan putar sendiri membatalkan penungguan', () => {
    const s = run([{ type: 'ended' }, { type: 'playing' }], tailNoDetails());
    expect(s.awaitingMore).toBe(false);
  });

  it('lanjutan yang tiba saat masih berbunyi tidak memindahkan lagu', () => {
    const s = run([{ type: 'continueQueue', from: 'a', songs: songs('d') }], tailNoDetails());
    expect(currentSong(s)?.videoId).toBe('a');
    expect(s.status).toBe('playing');
  });
});
