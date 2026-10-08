import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFS,
  GENERATOR_PREFS_KEY,
  readPrefs,
  sanitizePrefs,
  writePrefs,
} from './generator-prefs';

function stub(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  return data;
}

describe('sanitizePrefs', () => {
  it('data kosong/bukan objek → bawaan', () => {
    for (const raw of [null, undefined, 5, 'x', []])
      expect(sanitizePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('nilai di luar rentang dijepit; tipe salah diganti bawaan', () => {
    const p = sanitizePrefs({
      mode: 'passphrase',
      password: { length: 9999, lower: 'ya', upper: false },
      passphrase: { words: 1, separator: '??', capitalize: true },
    });
    expect(p.mode).toBe('passphrase');
    expect(p.password.length).toBe(128);
    expect(p.password.lower).toBe(true); // 'ya' bukan boolean → bawaan
    expect(p.password.upper).toBe(false);
    expect(p.passphrase.words).toBe(4);
    expect(p.passphrase.separator).toBe('-'); // tidak ada di daftar → bawaan
    expect(p.passphrase.capitalize).toBe(true);
  });

  it('semua jenis karakter mati → satu dinyalakan kembali (generator tak boleh macet)', () => {
    const p = sanitizePrefs({
      password: { lower: false, upper: false, digits: false, symbols: false },
    });
    expect(p.password.lower).toBe(true);
  });

  it('mode tak dikenal → password', () => {
    expect(sanitizePrefs({ mode: 'aneh' }).mode).toBe('password');
  });
});

describe('readPrefs / writePrefs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bolak-balik', () => {
    stub();
    const next = sanitizePrefs({ mode: 'passphrase', passphrase: { words: 7, separator: ' ' } });
    writePrefs(next);
    expect(readPrefs()).toEqual(next);
  });

  it('JSON rusak tidak membuat aplikasi gagal', () => {
    stub({ [GENERATOR_PREFS_KEY]: '{bukan json' });
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('penyimpanan memblokir akses → tetap kembali ke bawaan', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('diblokir');
      },
      setItem: () => {
        throw new Error('diblokir');
      },
    });
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => writePrefs(DEFAULT_PREFS)).not.toThrow();
  });

  it('yang tersimpan hanya pengaturan — tidak ada sandi', () => {
    const data = stub();
    writePrefs(DEFAULT_PREFS);
    const saved = data.get(GENERATOR_PREFS_KEY)!;
    expect(Object.keys(JSON.parse(saved))).toEqual(['mode', 'password', 'passphrase']);
  });
});
