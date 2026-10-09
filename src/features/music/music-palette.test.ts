import { beforeEach, describe, expect, it, vi } from 'vitest';

import { musicCommands } from './music-palette';
import { bindMusicToggle, useMusicSheet, type MusicRemoteState } from './music-store';

const state = (patch: Partial<MusicRemoteState> = {}): MusicRemoteState => ({
  active: false,
  playing: false,
  hasLyrics: false,
  ...patch,
});

const keys = (s: MusicRemoteState) => musicCommands(s).map((c) => c.key);

beforeEach(() => {
  useMusicSheet.setState({ open: false, tab: 'cari' });
  bindMusicToggle(null);
});

describe('item yang ditawarkan per keadaan', () => {
  it('belum ada yang diputar: hanya "Cari lagu"', () => {
    // "Jeda", "Antrean", dan "Lirik" semuanya jalan buntu kalau belum ada lagu.
    expect(keys(state())).toEqual(['music-search']);
  });

  it('sedang berbunyi: jeda dulu, lalu antrean, lalu cari', () => {
    expect(keys(state({ active: true, playing: true }))).toEqual([
      'music-toggle',
      'music-queue',
      'music-search',
    ]);
  });

  it('"Lirik lagu ini" disembunyikan saat lagunya tidak punya lirik', () => {
    expect(keys(state({ active: true, playing: true }))).not.toContain('music-lyrics');
  });

  it('"Lirik lagu ini" muncul saat lagunya punya lirik', () => {
    expect(keys(state({ active: true, playing: true, hasLyrics: true }))).toContain('music-lyrics');
  });

  it('judul putar/jeda mengikuti keadaan, jadi tidak pernah menawarkan yang salah', () => {
    const [playing] = musicCommands(state({ active: true, playing: true }));
    const [paused] = musicCommands(state({ active: true, playing: false }));
    expect(playing?.title).toBe('Jeda musik');
    expect(paused?.title).toBe('Lanjutkan musik');
  });

  it('setiap item punya kata kunci yang memuat "musik"', () => {
    // Satu kata itu harus cukup untuk memunculkan seluruh seksi di palette.
    for (const c of musicCommands(state({ active: true, hasLyrics: true }))) {
      expect(c.keywords).toContain('musik');
    }
  });

  it('kunci item tidak ada yang kembar', () => {
    const list = keys(state({ active: true, playing: true, hasLyrics: true }));
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('apa yang dilakukan item', () => {
  const find = (s: MusicRemoteState, key: string) => {
    const item = musicCommands(s).find((c) => c.key === key);
    if (!item) throw new Error(`item ${key} tidak ada`);
    return item;
  };

  it('"Cari lagu" membuka panel di tab pencarian', () => {
    find(state(), 'music-search').run();
    expect(useMusicSheet.getState()).toMatchObject({ open: true, tab: 'cari' });
  });

  it('"Antrean musik" membuka panel di tab antrean', () => {
    find(state({ active: true }), 'music-queue').run();
    expect(useMusicSheet.getState()).toMatchObject({ open: true, tab: 'antrean' });
  });

  it('"Lirik lagu ini" membuka panel di tab lirik', () => {
    find(state({ active: true, hasLyrics: true }), 'music-lyrics').run();
    expect(useMusicSheet.getState()).toMatchObject({ open: true, tab: 'lirik' });
  });

  it('putar/jeda TIDAK membuka panel — menjeda tidak perlu melihat apa pun', () => {
    const toggle = vi.fn();
    bindMusicToggle(toggle);
    find(state({ active: true, playing: true }), 'music-toggle').run();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(useMusicSheet.getState().open).toBe(false);
  });

  it('putar/jeda tanpa pemutar terpasang tidak melempar error', () => {
    // Bisa terjadi bila bilah pemutar belum ter-mount saat palette dipakai.
    expect(() => find(state({ active: true }), 'music-toggle').run()).not.toThrow();
  });
});
