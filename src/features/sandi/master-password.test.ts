import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EFF_WORDLIST } from './eff-wordlist';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase,
  generatePassword,
} from './generator';
import {
  ENGINE_LOAD_ERROR,
  MASTER_ADVICE,
  MASTER_MIN_BITS,
  ensureStrengthEngine,
  evaluateMasterPassword,
  masterPasswordProblem,
  userInputsFromEmail,
} from './master-password';

beforeAll(async () => {
  await ensureStrengthEngine();
}, 30_000);

describe('gerbang master password (zxcvbn-ts)', () => {
  // Semuanya LOLOS pada estimator lama (temuan review keamanan): kata + tahun + simbol.
  it('menolak kata umum + tahun/angka + simbol', () => {
    return Promise.all(
      [
        'Password1234!',
        'Qwerty123456!',
        'Welcome2024!!',
        'Iloveyou2024!',
        'Indonesia1945!',
        'Taskify@2024!!',
        'Kucing123456!',
        'P@ssw0rd1234!',
        'Bismillah1234!',
      ].map(async (bad) => {
        expect(await masterPasswordProblem(bad), bad).not.toBeNull();
        expect(evaluateMasterPassword(bad).bits, bad).toBeLessThan(MASTER_MIN_BITS);
      }),
    );
  });

  it('menolak pendek, urutan, dan pengulangan', async () => {
    expect(await masterPasswordProblem('pendek')).toMatch(/12 karakter/);
    expect(await masterPasswordProblem('')).toMatch(/12 karakter/);
    for (const bad of ['abcdefghijkl', '1234567890123', 'aaaaaaaaaaaaaaaa', 'qwertyuiopasdf'])
      expect(await masterPasswordProblem(bad), bad).not.toBeNull();
  });

  it('menolak sandi yang memuat bagian email pemilik akun', async () => {
    const inputs = userInputsFromEmail('rosyid.wijaya@example.com');
    expect(inputs).toContain('rosyid');
    expect(evaluateMasterPassword('rosyid-wijaya-2026', inputs).bits).toBeLessThan(
      evaluateMasterPassword('rosyid-wijaya-2026').bits,
    );
    expect(await masterPasswordProblem('rosyidwijaya2026', inputs)).not.toBeNull();
  });

  it(
    'menerima sandi acak dari generator (panjang bawaan dan ≥ 20) tanpa salah tolak',
    { timeout: 30_000 },
    async () => {
      for (const length of [DEFAULT_PASSWORD_OPTIONS.length, 20, 24]) {
        for (let i = 0; i < 25; i++) {
          const p = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length });
          expect(await masterPasswordProblem(p), p).toBeNull();
        }
      }
    },
  );

  it('sandi acak pendek (12) ditolak dengan petunjuk yang bisa ditindaklanjuti', async () => {
    // Banyak percobaan: sandi acak kadang memuat kata umum ("love", "sun"); petunjuk tetap wajib ada
    for (let i = 0; i < 40; i++) {
      const p = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 12 });
      expect(await masterPasswordProblem(p), p).toMatch(/frasa 5 kata|16 karakter/);
    }
  });

  it('penolakan karena pola tetap menyertakan saran (deterministik)', async () => {
    // Acak 12 karakter yang memuat kata umum: sumber kegagalan acak tes di atas sebelumnya
    const msg = await masterPasswordProblem('x7Qlove#k2Mz');
    expect(msg).toMatch(/kata atau nama yang umum/);
    expect(msg).toContain(MASTER_ADVICE);
    expect(await masterPasswordProblem('Welcome2024!!')).toContain(MASTER_ADVICE);
  });

  it(
    'menerima frasa 5 kata EFF buatan generator (termasuk yang memuat kata berulang)',
    { timeout: 30_000 },
    async () => {
      for (let i = 0; i < 150; i++) {
        const p = generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 5 }, EFF_WORDLIST);
        expect(await masterPasswordProblem(p), p).toBeNull();
      }
      // 4 kata berbeda dari 5 (satu ulang) ≈ 52 bit asli: masih boleh
      expect(await masterPasswordProblem('wolf-cabbage-jigsaw-orbit-wolf')).toBeNull();
    },
  );

  it('frasa dari sedikit kata berbeda ditolak walau panjang', async () => {
    for (const bad of [
      'kopi kopi kopi kopi kopi',
      'kopi kuda kopi kuda kopi',
      'zebra-quartz-zebra-zebra-quartz',
    ])
      expect(await masterPasswordProblem(bad), bad).not.toBeNull();
  });

  it('petunjuk pola hanya muncul untuk sandi yang belum kuat', () => {
    expect(evaluateMasterPassword('Welcome2024!!').issues.length).toBeGreaterThan(0);
    const strong = evaluateMasterPassword(generatePassword(DEFAULT_PASSWORD_OPTIONS));
    expect(strong.issues).toEqual([]);
  });

  it('masukan sangat panjang tidak membuat pemeriksa macet', () => {
    const t = performance.now();
    evaluateMasterPassword('a1B!'.repeat(5000));
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it('gagal TERTUTUP: pemeriksa tidak termuat → sandi ditolak, bukan diloloskan', async () => {
    vi.resetModules();
    vi.doMock('@zxcvbn-ts/core', () => {
      throw new Error('chunk gagal dimuat');
    });
    const fresh = await import('./master-password');
    const strongRandom = 'xK9#mQ2$vL7!pZwR';
    expect(await fresh.masterPasswordProblem(strongRandom)).toBe(ENGINE_LOAD_ERROR);
    expect(() => fresh.evaluateMasterPassword(strongRandom)).toThrow(/belum dimuat/);
    vi.doUnmock('@zxcvbn-ts/core');
    vi.resetModules();
  });
});
