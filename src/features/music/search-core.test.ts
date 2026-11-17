import { describe, expect, it } from 'vitest';

import {
  SEARCH_TABS,
  canLoadMore,
  coverUrl,
  mergeSongPages,
  supportsPaging,
  thumbUrl,
} from './search-core';
import type { Song } from './types';

const song = (id: string, patch: Partial<Song> = {}): Song => ({
  videoId: id,
  title: id,
  artist: 'Artis',
  duration: '3.00',
  thumbnails: [],
  url: `https://music.youtube.com/watch?v=${id}`,
  ...patch,
});

const ids = (list: Song[]) => list.map((s) => s.videoId);

describe('paginasi per filter', () => {
  it('pencarian tanpa filter PUNYA halaman lanjutan — Worker mengirim cursor gabungan', () => {
    // Dulu hulu tidak mengirim token lanjutan untuk hasil campuran, jadi gate ini
    // menutup tab "Semua". Sejak Worker mengirim `mergedCursor`, tab itu bisa
    // dilanjutkan seperti tab lain.
    expect(supportsPaging(undefined)).toBe(true);
  });

  it('pencarian dengan filter bisa dilanjutkan', () => {
    expect(supportsPaging('songs')).toBe(true);
    expect(supportsPaging('videos')).toBe(true);
  });

  it('tombol "Muat lagi" muncul di tab Semua bila ada cursor', () => {
    expect(canLoadMore(undefined, 'kursor-gabungan')).toBe(true);
  });

  it('tombol "Muat lagi" muncul hanya saat filternya mendukung DAN masih ada cursor', () => {
    expect(canLoadMore('songs', 'eyJrIjoic2Vhcm')).toBe(true);
    expect(canLoadMore('songs', undefined)).toBe(false);
    expect(canLoadMore('songs', '')).toBe(false);
  });

  it('tab Semua memang memakai filter undefined, bukan string "semua"', () => {
    const all = SEARCH_TABS.find((t) => t.key === 'all');
    expect(all?.filter).toBeUndefined();
    // Dan tidak ada tab yang memakai filter di luar daftar tertutup Worker.
    const allowed = new Set([undefined, 'songs', 'videos', 'albums', 'artists', 'playlists']);
    for (const tab of SEARCH_TABS) expect(allowed.has(tab.filter)).toBe(true);
  });
});

describe('menggabungkan halaman hasil', () => {
  it('halaman berikutnya ditambahkan di belakang', () => {
    expect(ids(mergeSongPages(songs(), [song('c')]))).toEqual(['a', 'b', 'c']);
  });

  function songs() {
    return [song('a'), song('b')];
  }

  it('lagu yang sudah ada dibuang — dedupe antar halaman tugas klien', () => {
    // Worker tidak menyimpan status, jadi ia tidak tahu halaman mana yang sudah diterima.
    expect(ids(mergeSongPages(songs(), [song('b'), song('c'), song('a')]))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('duplikat di dalam satu halaman masukan juga dibuang', () => {
    expect(ids(mergeSongPages([], [song('a'), song('a')]))).toEqual(['a']);
  });

  it('baris tanpa videoId dibuang — lagunya tidak bisa diputar', () => {
    expect(ids(mergeSongPages([], [song(''), song('a')]))).toEqual(['a']);
  });

  it('yang pertama masuk yang dipertahankan, bukan yang terakhir', () => {
    const merged = mergeSongPages([song('a', { title: 'Asli' })], [song('a', { title: 'Ulang' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('Asli');
  });

  it('tidak mengubah daftar yang diberikan', () => {
    const existing = [song('a')];
    mergeSongPages(existing, [song('b')]);
    expect(ids(existing)).toEqual(['a']);
  });

  it('halaman kosong tidak mengubah apa pun', () => {
    expect(ids(mergeSongPages([song('a')], []))).toEqual(['a']);
  });
});

describe('gambar album', () => {
  const enam = song('a', {
    thumbnails: [
      { url: 'kecil.jpg', width: 60, height: 60 },
      { url: 'sedang.jpg', width: 226, height: 226 },
      { url: 'besar.jpg', width: 544, height: 544 },
    ],
  });

  it('baris daftar memakai ukuran TERKECIL', () => {
    // Barisnya hanya selebar 40px; mengambil yang terbesar hanya membuang kuota data.
    expect(thumbUrl(enam)).toBe('kecil.jpg');
  });

  it('layar Sedang diputar memakai ukuran TERBESAR', () => {
    expect(coverUrl(enam)).toBe('besar.jpg');
  });

  it('yang terbesar dipilih dari width, bukan dari posisi terakhir di daftar', () => {
    // Urutan "terkecil dulu" itu kebiasaan hulu, bukan janji di kontrak API. Mengandalkan
    // posisi akan memasang gambar 60px di bingkai 320px kalau urutannya berubah.
    const terbalik = song('a', {
      thumbnails: [
        { url: 'besar.jpg', width: 544, height: 544 },
        { url: 'kecil.jpg', width: 60, height: 60 },
      ],
    });
    expect(coverUrl(terbalik)).toBe('besar.jpg');
  });

  it('tanpa gambar: string kosong, bukan undefined', () => {
    // Trek album memang tidak diberi gambar sendiri oleh hulu.
    expect(thumbUrl(song('a'))).toBe('');
    expect(coverUrl(song('a'))).toBe('');
  });

  it('entri tanpa url diabaikan, tidak dipilih hanya karena width-nya besar', () => {
    const rusak = song('a', {
      thumbnails: [
        { url: '', width: 9999, height: 9999 },
        { url: 'kecil.jpg', width: 60, height: 60 },
      ],
    });
    expect(coverUrl(rusak)).toBe('kecil.jpg');
  });
});
