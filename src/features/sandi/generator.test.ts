import { describe, expect, it } from 'vitest';
import { EFF_WORDLIST } from './eff-wordlist';
import {
  AMBIGUOUS,
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  DIGITS,
  LENGTH_MAX,
  LENGTH_MIN,
  LOWER,
  SYMBOLS,
  UPPER,
  charClasses,
  clampLength,
  estimatePasswordStrength,
  generatePassphrase,
  generatePassword,
  masterPasswordProblem,
  passphraseEntropy,
  passwordEntropy,
  randomInt,
  strengthFromBits,
  type PasswordOptions,
  type RandomSource,
} from './generator';

const opts = (over: Partial<PasswordOptions> = {}): PasswordOptions => ({
  ...DEFAULT_PASSWORD_OPTIONS,
  ...over,
});

/** RNG yang mengembalikan deretan uint32 yang sudah ditentukan (untuk menguji rejection sampling). */
function fixedRng(values: number[]): { rng: RandomSource; calls: () => number } {
  let i = 0;
  return {
    rng: (bytes) => {
      new DataView(bytes.buffer).setUint32(0, values[i++ % values.length]! >>> 0);
    },
    calls: () => i,
  };
}

describe('randomInt', () => {
  it('menolak nilai di ekor yang menimbulkan bias modulo, lalu mengambil ulang', () => {
    // max=3 → 2^32 % 3 = 1 → nilai 0xFFFFFFFF (satu-satunya di ekor) harus dibuang
    const { rng, calls } = fixedRng([0xffffffff, 7]);
    expect(randomInt(3, rng)).toBe(7 % 3);
    expect(calls()).toBe(2);
  });

  it('nilai tepat di batas limit diterima, satu di atasnya ditolak', () => {
    const max = 10; // 2^32 % 10 = 6 → limit = 4294967290
    expect(randomInt(max, fixedRng([4294967289]).rng)).toBe(9);
    const rejected = fixedRng([4294967290, 4294967295, 3]);
    expect(randomInt(max, rejected.rng)).toBe(3);
    expect(rejected.calls()).toBe(3);
  });

  it('max = 1 selalu 0 tanpa memakai RNG', () => {
    const { rng, calls } = fixedRng([123]);
    expect(randomInt(1, rng)).toBe(0);
    expect(calls()).toBe(0);
  });

  it('argumen tidak valid ditolak', () => {
    for (const bad of [0, -1, 1.5, NaN, 2 ** 32 + 1])
      expect(() => randomInt(bad)).toThrow(RangeError);
  });

  it('sebaran seragam (CSPRNG asli): 70.000 undian atas 7 nilai, tiap nilai ±6% dari rata-rata', () => {
    const counts = new Array<number>(7).fill(0);
    for (let i = 0; i < 70_000; i++) counts[randomInt(7)]!++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(600);
  });
});

describe('generatePassword', () => {
  it('panjang sesuai permintaan dan dibatasi 8..128', () => {
    expect(generatePassword(opts({ length: 20 }))).toHaveLength(20);
    expect(generatePassword(opts({ length: 3 }))).toHaveLength(LENGTH_MIN);
    expect(generatePassword(opts({ length: 9999 }))).toHaveLength(LENGTH_MAX);
    expect(clampLength(NaN)).toBe(20);
  });

  it('setiap kelompok yang dipilih PASTI muncul — 2.000 percobaan untuk setiap kombinasi', () => {
    for (let mask = 1; mask < 16; mask++) {
      const o = opts({
        length: 8,
        lower: !!(mask & 1),
        upper: !!(mask & 2),
        digits: !!(mask & 4),
        symbols: !!(mask & 8),
      });
      const classes = charClasses(o);
      for (let i = 0; i < 150; i++) {
        const pw = generatePassword(o);
        for (const cls of classes)
          expect(
            [...pw].some((ch) => cls.includes(ch)),
            `${pw} (mask ${mask})`,
          ).toBe(true);
      }
    }
  });

  it('hanya memakai karakter dari kelompok yang dipilih', () => {
    const pw = generatePassword(opts({ length: 128, upper: false, symbols: false }));
    for (const ch of pw) expect(LOWER + DIGITS).toContain(ch);
    expect(pw).not.toMatch(/[A-Z]/);
  });

  it('hindari karakter ambigu: Il1O0o tidak pernah muncul', () => {
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword(opts({ length: 64, avoidAmbiguous: true }));
      for (const ch of AMBIGUOUS) expect(pw).not.toContain(ch);
    }
  });

  it('tanpa jenis karakter → error yang jelas (UI mencegahnya)', () => {
    expect(() =>
      generatePassword(opts({ lower: false, upper: false, digits: false, symbols: false })),
    ).toThrow(/minimal satu/i);
  });

  it('dua hasil berurutan berbeda dan simbol tidak memuat karakter bermasalah', () => {
    expect(generatePassword(opts())).not.toBe(generatePassword(opts()));
    expect(SYMBOLS).not.toMatch(/["'\\\s<>|~`]/);
  });

  it('semua karakter punya peluang muncul (tidak ada yang tersingkir diam-diam)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++)
      for (const ch of generatePassword(opts({ length: 64 }))) seen.add(ch);
    for (const ch of LOWER + UPPER + DIGITS + SYMBOLS) expect(seen.has(ch), ch).toBe(true);
  });

  it('pengacakan akhir menghilangkan pola posisi: karakter pertama bukan selalu huruf kecil', () => {
    const firstClasses = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = generatePassword(opts({ length: 8 }))[0]!;
      firstClasses.add(
        LOWER.includes(c) ? 'l' : UPPER.includes(c) ? 'u' : DIGITS.includes(c) ? 'd' : 's',
      );
    }
    expect(firstClasses.size).toBe(4);
  });
});

describe('generatePassphrase', () => {
  it('daftar kata EFF: 7.776 kata unik', () => {
    expect(EFF_WORDLIST).toHaveLength(7776);
    expect(new Set(EFF_WORDLIST).size).toBe(7776);
    for (const w of EFF_WORDLIST) expect(w).toMatch(/^[a-z-]+$/);
  });

  it('jumlah kata, pemisah, dan semua kata berasal dari daftar', () => {
    const p = generatePassphrase(
      { ...DEFAULT_PASSPHRASE_OPTIONS, words: 6, separator: ' ' },
      EFF_WORDLIST,
    );
    const words = p.split(' ');
    expect(words).toHaveLength(6);
    for (const w of words) expect(EFF_WORDLIST).toContain(w);
  });

  it('kapitalisasi dan angka opsional', () => {
    const p = generatePassphrase(
      { words: 5, separator: '-', capitalize: true, includeNumber: true },
      ['alpha', 'bravo', 'charlie'],
    );
    expect(p.split('-')).toHaveLength(5);
    for (const w of p.split('-')) expect(w).toMatch(/^[A-Z][a-z]+\d?$/);
    expect(p.match(/\d/g)).toHaveLength(1);
  });

  it('jumlah kata dibatasi 4..10; daftar kosong ditolak', () => {
    expect(
      generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 1 }, EFF_WORDLIST).split('-'),
    ).toHaveLength(4);
    expect(
      generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 99 }, EFF_WORDLIST).split('-'),
    ).toHaveLength(10);
    expect(() => generatePassphrase(DEFAULT_PASSPHRASE_OPTIONS, [])).toThrow();
  });
});

describe('entropi & kekuatan', () => {
  it('sandi acak 20 karakter dari 85 simbol ≈ 128 bit', () => {
    const bits = passwordEntropy(opts({ length: 20 }));
    expect(bits).toBeCloseTo(20 * Math.log2(26 + 26 + 10 + SYMBOLS.length), 5);
    expect(bits).toBeGreaterThan(120);
  });

  it('menghindari karakter ambigu menurunkan entropi sedikit', () => {
    expect(passwordEntropy(opts({ avoidAmbiguous: true }))).toBeLessThan(passwordEntropy(opts()));
  });

  it('frasa EFF: tiap kata ≈ 12,92 bit; 6 kata ≈ 77,5 bit; angka menambah ±5 bit', () => {
    expect(passphraseEntropy({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 6 }, 7776)).toBeCloseTo(
      6 * 12.92,
      1,
    );
    const withNum = passphraseEntropy(
      { ...DEFAULT_PASSPHRASE_OPTIONS, words: 6, includeNumber: true },
      7776,
    );
    expect(withNum - 6 * Math.log2(7776)).toBeCloseTo(Math.log2(6) + Math.log2(10), 5);
  });

  it('label kekuatan mengikuti ambang', () => {
    expect(strengthFromBits(20).label).toBe('Lemah');
    expect(strengthFromBits(45).label).toBe('Cukup');
    expect(strengthFromBits(70).label).toBe('Kuat');
    expect(strengthFromBits(100).label).toBe('Sangat kuat');
    expect(strengthFromBits(100).score).toBe(4);
  });
});

describe('estimatePasswordStrength & syarat master password', () => {
  it('menolak yang umum, pendek, berpola, dan berulang', () => {
    for (const bad of [
      'password123',
      'Qwerty123',
      'abcdefghijkl',
      '1234567890123',
      'aaaaaaaaaaaaaaaa',
      'Rosyid2026',
      'Abc123!',
    ]) {
      expect(masterPasswordProblem(bad), bad).not.toBeNull();
    }
  });

  it('kata + angka dinilai pola lemah walau panjang', () => {
    expect(estimatePasswordStrength('Bismillah1').label).toBe('Lemah');
    expect(estimatePasswordStrength('Rosyid2026').bits).toBeLessThanOrEqual(30);
  });

  it('menerima frasa 5 kata dan sandi acak panjang', () => {
    expect(masterPasswordProblem('kuda biru minum kopi pagi')).toBeNull();
    expect(masterPasswordProblem('kuda-biru-minum-kopi-pagi')).toBeNull();
    expect(masterPasswordProblem(generatePassword(opts({ length: 16 })))).toBeNull();
  });

  it('frasa 3 kata terlalu lemah; kata yang diulang tidak dihitung dua kali', () => {
    expect(masterPasswordProblem('kuda biru minum')).not.toBeNull();
    expect(estimatePasswordStrength('kopi kopi kopi kopi kopi').bits).toBeLessThan(
      estimatePasswordStrength('kuda biru minum kopi pagi').bits,
    );
  });

  it('frasa yang dibuat generator selalu lolos syarat master password', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 5 }, EFF_WORDLIST);
      expect(masterPasswordProblem(p), p).toBeNull();
    }
  });

  it('pesan masalah berisi petunjuk yang bisa ditindaklanjuti', () => {
    expect(masterPasswordProblem('pendek')).toMatch(/12 karakter/);
    expect(masterPasswordProblem('')).toMatch(/12 karakter/);
  });
});
