import { describe, expect, it } from 'vitest';
import { TikTokError, type TikTokClient } from './api-client';
import {
  assetFallbackName,
  assetUrl,
  createFileCache,
  downloadAsset,
  LINK_MAX_AGE_MS,
} from './download-asset';
import type { TikTokPost } from './types';

const post = (gen: string): TikTokPost => ({
  id: '7123456789012345678',
  type: 'photo',
  description: '',
  created_at: 0,
  canonical_url: '',
  author: { unique_id: 'kreator', nickname: 'Kreator', verified: false },
  stats: { plays: 0, likes: 0, comments: 0, shares: 0, bookmarks: 0 },
  video: null,
  music: null,
  hashtags: [],
  photo_count: 2,
  cover: null,
  downloads: {
    video: `video-${gen}`,
    photos: [`p0-${gen}`, `p1-${gen}`],
    audio: null,
  },
});

function client(fail: (url: string) => Error | null) {
  const urls: string[] = [];
  const c: TikTokClient = {
    extract: async () => post('x'),
    image: async () => new Blob(),
    download: async (url, fallbackName) => {
      urls.push(url);
      const err = fail(url);
      if (err) throw err;
      return { blob: new Blob([url]), fileName: fallbackName };
    },
  };
  return { c, urls };
}

describe('assetUrl & assetFallbackName', () => {
  it('per jenis', () => {
    const p = post('a');
    expect(assetUrl(p, { kind: 'video' })).toBe('video-a');
    expect(assetUrl(p, { kind: 'photo', index: 1 })).toBe('p1-a');
    expect(assetUrl(p, { kind: 'photo', index: 5 })).toBeNull();
    expect(assetUrl(p, { kind: 'audio' })).toBeNull();
    expect(assetFallbackName(p, { kind: 'photo', index: 0 })).toBe(
      'kreator_7123456789012345678_01.jpg',
    );
    expect(assetFallbackName(p, { kind: 'audio' })).toBe('kreator_7123456789012345678_audio.mp3');
  });
});

describe('downloadAsset', () => {
  const NOW = 1_000_000_000;

  it('link masih segar → langsung diunduh', async () => {
    const { c, urls } = client(() => null);
    let refreshes = 0;
    const file = await downloadAsset(
      { kind: 'photo', index: 1 },
      {
        client: c,
        current: { post: post('a'), at: NOW },
        refresh: async () => (refreshes++, post('b')),
        now: () => NOW + 1000,
      },
    );
    expect(urls).toEqual(['p1-a']);
    expect(refreshes).toBe(0);
    expect(file.fileName).toBe('kreator_7123456789012345678_02.jpg');
  });

  it('link sudah tua → ekstrak ulang dulu', async () => {
    const { c, urls } = client(() => null);
    await downloadAsset(
      { kind: 'video' },
      {
        client: c,
        current: { post: post('a'), at: NOW },
        refresh: async () => post('b'),
        now: () => NOW + LINK_MAX_AGE_MS + 1,
      },
    );
    expect(urls).toEqual(['video-b']);
  });

  it('ditolak kedaluwarsa → ekstrak ulang SEKALI lalu coba lagi', async () => {
    const { c, urls } = client((u) =>
      u.endsWith('-a') ? new TikTokError('lama', 'TOKEN_EXPIRED', 410) : null,
    );
    await downloadAsset(
      { kind: 'video' },
      {
        client: c,
        current: { post: post('a'), at: NOW },
        refresh: async () => post('b'),
        now: () => NOW,
      },
    );
    expect(urls).toEqual(['video-a', 'video-b']);
  });

  it('error lain tidak diulang; gagal setelah diperbarui tidak diulang lagi', async () => {
    const network = client(() => new TikTokError('offline', 'NETWORK'));
    await expect(
      downloadAsset(
        { kind: 'video' },
        {
          client: network.c,
          current: { post: post('a'), at: NOW },
          refresh: async () => post('b'),
          now: () => NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'NETWORK' });
    expect(network.urls).toEqual(['video-a']);

    const stale = client(() => new TikTokError('cdn', 'UPSTREAM', 502));
    await expect(
      downloadAsset(
        { kind: 'video' },
        {
          client: stale.c,
          current: { post: post('a'), at: NOW },
          refresh: async () => post('b'),
          now: () => NOW + LINK_MAX_AGE_MS + 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM' });
    expect(stale.urls).toEqual(['video-b']);
  });

  it('file tidak tersedia', async () => {
    const { c } = client(() => null);
    await expect(
      downloadAsset(
        { kind: 'audio' },
        {
          client: c,
          current: { post: post('a'), at: NOW },
          refresh: async () => post('b'),
          now: () => NOW,
        },
      ),
    ).rejects.toThrow(/tidak tersedia/);
  });
});

describe('createFileCache', () => {
  const file = (name: string) => ({ blob: new Blob([name]), fileName: name });

  it('satu permintaan per kunci, juga bila diminta bersamaan', async () => {
    const loads: number[] = [];
    const cache = createFileCache<number>(async (i) => (loads.push(i), file(`f${i}`)));
    const [a, b] = await Promise.all([cache.get(1), cache.get(1)]);
    expect(a).toBe(b);
    await cache.get(1);
    await cache.get(2);
    expect(loads).toEqual([1, 2]);
  });

  it('gagal → dilupakan, permintaan berikutnya mencoba lagi', async () => {
    let n = 0;
    const cache = createFileCache<number>(async () => {
      if (n++ === 0) throw new Error('jaringan');
      return file('ok');
    });
    await expect(cache.get(0)).rejects.toThrow('jaringan');
    expect((await cache.get(0)).fileName).toBe('ok');
    expect(n).toBe(2);
  });

  it('clear → dimuat ulang', async () => {
    let n = 0;
    const cache = createFileCache<number>(async () => file(String(n++)));
    await cache.get(0);
    cache.clear();
    expect((await cache.get(0)).fileName).toBe('1');
  });
});
