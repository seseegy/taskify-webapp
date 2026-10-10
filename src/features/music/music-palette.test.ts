import { beforeEach, describe, expect, it, vi } from 'vitest';

import { musicCommands } from './music-palette';
import { bindMusicToggle, useMusicPanel, type MusicRemoteState } from './music-store';

const state = (patch: Partial<MusicRemoteState> = {}): MusicRemoteState => ({
  active: false,
  playing: false,
  hasLyrics: false,
  ...patch,
});

const keys = (s: MusicRemoteState) => musicCommands(s).map((c) => c.key);

beforeEach(() => {
  useMusicPanel.setState({ panel: 'none', tab: 'cari' });
  bindMusicToggle(null);
});

describe('item yang ditawarkan per keadaan', () => {
  it('belum ada yang diputar: hanya "Cari lagu"', () => {
    // "Jeda", "Antrean", dan "Lirik" semuanya jalan buntu kalau belum ada lagu.
    expect(keys(state())).toEqual(['music-search']);
  });

  it('sedang berbunyi: jeda dulu, lalu sedang diputar, antrean, cari', () => {
    expect(keys(state({ active: true, playing: true }))).toEqual([
      'music-toggle',
      'music-now',
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
    expect(useMusicPanel.getState()).toMatchObject({ panel: 'cari', tab: 'cari' });
  });

  it('"Antrean musik" membuka panel di tab antrean', () => {
    find(state({ active: true }), 'music-queue').run();
    expect(useMusicPanel.getState()).toMatchObject({ panel: 'antrean', tab: 'antrean' });
  });

  it('"Lirik lagu ini" membuka panel di tab lirik', () => {
    find(state({ active: true, hasLyrics: true }), 'music-lyrics').run();
    expect(useMusicPanel.getState()).toMatchObject({ panel: 'lirik', tab: 'lirik' });
  });

  it('"Sedang diputar" membuka layar now-playing, bukan Sheet tiga tab', () => {
    find(state({ active: true }), 'music-now').run();
    expect(useMusicPanel.getState().panel).toBe('sekarang');
  });

  it('membuka layar now-playing tidak mengubah tab terakhir yang dilihat', () => {
    // Supaya tombol "Antrean" di layar itu mengembalikan pengguna ke tempat yang sama.
    useMusicPanel.setState({ panel: 'none', tab: 'lirik' });
    find(state({ active: true }), 'music-now').run();
    expect(useMusicPanel.getState().tab).toBe('lirik');
  });

  it('berpindah dari layar Sedang diputar ke tab TIDAK menutup panelnya', () => {
    /*
     * Ini yang dulu rusak. Dua `<dialog>` terpisah dikendalikan satu field `panel`, dan
     * `ui/Sheet` memanggil `onClose` juga saat ditutup secara TERPROGRAM — jadi menutup
     * layar Sedang diputar memicu `hide()` yang menghapus `panel` yang baru saja dipasang
     * untuk Sheet satunya, dan keduanya tertutup.
     *
     * Perbaikannya struktural (satu dialog, isinya yang berganti), jadi tes ini tidak bisa
     * menangkap bug aslinya — yang rusak interaksi antar komponen, dan repo ini tidak punya
     * tes komponen. Yang dikunci di sini kontrak store-nya: berpindah panel memang
     * perpindahan, bukan penutupan.
     */
    useMusicPanel.getState().show('sekarang');
    expect(useMusicPanel.getState().panel).toBe('sekarang');

    find(state({ active: true }), 'music-queue').run();
    expect(useMusicPanel.getState().panel).toBe('antrean');

    find(state({ active: true, hasLyrics: true }), 'music-lyrics').run();
    expect(useMusicPanel.getState().panel).toBe('lirik');

    // Dan hanya `hide()` yang boleh menutupnya.
    useMusicPanel.getState().hide();
    expect(useMusicPanel.getState().panel).toBe('none');
  });

  it('putar/jeda TIDAK membuka panel — menjeda tidak perlu melihat apa pun', () => {
    const toggle = vi.fn();
    bindMusicToggle(toggle);
    find(state({ active: true, playing: true }), 'music-toggle').run();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(useMusicPanel.getState().panel).toBe('none');
  });

  it('putar/jeda tanpa pemutar terpasang tidak melempar error', () => {
    // Bisa terjadi bila bilah pemutar belum ter-mount saat palette dipakai.
    expect(() => find(state({ active: true }), 'music-toggle').run()).not.toThrow();
  });
});
