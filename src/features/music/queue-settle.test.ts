import { describe, expect, it } from 'vitest';

import {
  INITIAL_YT_STATE,
  currentSong,
  reduceYt,
  type TrackDetails,
  type YtEvent,
  type YtState,
} from './queue-core';
import { settleQueue } from './queue-settle';
import type { Song } from './types';

const song = (id: string): Song => ({
  videoId: id,
  title: id,
  artist: 'Artis',
  duration: '3.00',
  thumbnails: [],
  url: `https://music.youtube.com/watch?v=${id}`,
});

const songs = (...ids: string[]) => ids.map(song);

const detail = (...upNextIds: string[]): TrackDetails => ({
  lyricsId: '',
  upNext: songs(...upNextIds),
});

/** Seperti pemutar sungguhan: tiap peristiwa langsung dirapikan. */
const send = (state: YtState, event: YtEvent): YtState => settleQueue(reduceYt(state, event));
const run = (events: YtEvent[], start: YtState = INITIAL_YT_STATE): YtState =>
  events.reduce(send, start);

describe('melewati status menyiapkan untuk audio yang sudah ada', () => {
  it('lagu yang URL-nya hasil prefetch langsung berbunyi', () => {
    const s = run([
      { type: 'setQueue', songs: songs('a', 'b') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'prefetchDone', videoId: 'b', url: 'u-b' },
      { type: 'next' },
    ]);
    expect(currentSong(s)?.videoId).toBe('b');
    // Tanpa perapian ini, statusnya 'preparing' dulu sekejap walau audionya sudah siap.
    expect(s.status).toBe('playing');
  });

  it('antrean baru yang lagunya pernah diputar tidak menampilkan "menyiapkan" lagi', () => {
    const played = run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
    ]);
    const again = send(played, { type: 'setQueue', songs: songs('a', 'z') });
    expect(again.status).toBe('playing');
  });

  it('lagu yang audionya belum ada tetap menunggu, bukan dipaksa berbunyi', () => {
    const s = run([{ type: 'setQueue', songs: songs('a') }]);
    expect(s.status).toBe('preparing');
  });

  it('mencoba lagi setelah error langsung berbunyi kalau audionya sudah ada', () => {
    const s = run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'error', message: 'Audio gagal diputar.' },
      { type: 'preparing' },
    ]);
    expect(s.status).toBe('playing');
    expect(s.error).toBe('');
  });

  it('keadaan kosong tidak diubah apa-apa', () => {
    expect(settleQueue(INITIAL_YT_STATE)).toBe(INITIAL_YT_STATE);
  });
});

describe('menyambung antrean begitu keterangannya tiba', () => {
  /** Antrean satu lagu yang sedang berbunyi. */
  const playingTail = () =>
    run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'playing' },
    ]);

  it('disambung saat keterangan tiba, bukan saat lagunya habis', () => {
    // Kalau ditunggu sampai habis, ada jeda sunyi selama permintaannya jalan.
    const s = send(playingTail(), {
      type: 'detailsDone',
      videoId: 'a',
      details: detail('d', 'e'),
    });
    expect(s.queue.map((x) => x.videoId)).toEqual(['a', 'd', 'e']);
    // Dan lagu sekarang tidak terganggu.
    expect(currentSong(s)?.videoId).toBe('a');
    expect(s.status).toBe('playing');
  });

  it('tidak menyambung dari lagu yang sama dua kali', () => {
    const s = send(playingTail(), {
      type: 'detailsDone',
      videoId: 'a',
      details: detail('d'),
    });
    const lagi = settleQueue(s);
    expect(lagi.queue).toHaveLength(2);
    expect(lagi).toBe(s);
  });

  it('lagu terakhir yang sudah habis langsung lanjut saat lanjutannya tiba', () => {
    const s = run(
      [{ type: 'ended' }, { type: 'detailsDone', videoId: 'a', details: detail('d') }],
      playingTail(),
    );
    expect(currentSong(s)?.videoId).toBe('d');
    expect(s.status).toBe('preparing');
    expect(s.awaitingMore).toBe(false);
  });

  it('lanjutan beruntun diterapkan sekaligus saat posisinya ikut berpindah', () => {
    /*
     * Satu penyambungan bisa memicu penyambungan berikutnya, tapi hanya lewat jalur ini:
     * lagu terakhir sudah habis (`awaitingMore`), jadi `continueQueue` MEMINDAHKAN posisi ke
     * lagu tambahan — dan lagu itu langsung jadi "lagu terakhir di antrean" yang memenuhi
     * syarat penyambungan. Kalau keterangannya sudah ada di sesi ini (`details` disimpan
     * selamanya), sambungan kedua bisa dihitung sekarang alih-alih menunggu peristiwa lain.
     *
     * Selama masih ada lagu berikutnya, penyambungan TIDAK berantai — syaratnya posisi harus
     * di lagu terakhir.
     */
    const s = run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'playing' },
      // Keterangan 'b' sudah diketahui lebih dulu, mis. 'b' pernah diputar sebelumnya.
      { type: 'detailsDone', videoId: 'b', details: detail('c') },
      { type: 'ended' },
      { type: 'detailsDone', videoId: 'a', details: detail('b') },
    ]);
    expect(s.queue.map((x) => x.videoId)).toEqual(['a', 'b', 'c']);
    // Dan pemutar sudah berpindah ke lagu tambahannya, tidak diam menunggu.
    expect(currentSong(s)?.videoId).toBe('b');
    expect(s.awaitingMore).toBe(false);
  });

  it('tidak berantai selama masih ada lagu berikutnya di antrean', () => {
    const s = run([
      { type: 'setQueue', songs: songs('a') },
      { type: 'ready', videoId: 'a', url: 'u-a' },
      { type: 'playing' },
      { type: 'detailsDone', videoId: 'b', details: detail('c') },
      { type: 'detailsDone', videoId: 'a', details: detail('b') },
    ]);
    // 'b' masuk antrean, tapi 'c' belum: posisi masih di 'a', bukan di lagu terakhir.
    expect(s.queue.map((x) => x.videoId)).toEqual(['a', 'b']);
  });

  it('berhenti pada batas pengulangan, tidak berputar tanpa akhir', () => {
    // Keadaan buatan: setiap lagu menunjuk ke lagu berikutnya yang keterangannya sudah ada.
    // Yang diuji bukan jumlah persisnya, tapi bahwa ia MEMANG berhenti.
    const ids = Array.from({ length: 40 }, (_, i) => `s${i}`);
    const details: Record<string, TrackDetails> = {};
    ids.forEach((id, i) => {
      const next = ids[i + 1];
      details[id] = detail(...(next ? [next] : []));
    });
    const start: YtState = {
      ...INITIAL_YT_STATE,
      queue: songs('s0'),
      order: [0],
      position: 0,
      status: 'playing',
      urls: { s0: 'u' },
      details,
    };
    const s = settleQueue(start);
    expect(s.queue.length).toBeLessThan(ids.length);
    expect(s.queue.length).toBeGreaterThan(1);
  });

  it('tidak menyambung apa pun saat penyambungan otomatis dimatikan', () => {
    const s = run(
      [{ type: 'toggleAutoContinue' }, { type: 'detailsDone', videoId: 'a', details: detail('d') }],
      playingTail(),
    );
    expect(s.queue).toHaveLength(1);
  });
});
