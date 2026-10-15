import { describe, expect, it } from 'vitest';
import { charCount, sliceChars, splitTyped, typingSteps } from './typewriter';

describe('sliceChars / charCount', () => {
  it('memotong per karakter dan tidak membelah emoji (pasangan surrogate)', () => {
    expect(sliceChars('halo', 2)).toBe('ha');
    expect(sliceChars('a😀b', 2)).toBe('a😀');
    expect(() => encodeURIComponent(sliceChars('a😀b', 2))).not.toThrow(); // lone surrogate akan melempar
    expect(charCount('a😀b')).toBe(3);
  });

  it('batas: 0/negatif kosong, melebihi panjang = utuh', () => {
    expect(sliceChars('halo', 0)).toBe('');
    expect(sliceChars('halo', -3)).toBe('');
    expect(sliceChars('halo', 99)).toBe('halo');
    expect(sliceChars('', 3)).toBe('');
  });

  it('nama beraksen/ber-spasi dihitung per karakter', () => {
    expect(charCount('José Núñez')).toBe(10);
    expect(sliceChars('José Núñez', 4)).toBe('José');
  });
});

describe('splitTyped', () => {
  const TEXT = 'Selamat datang di Taskify';
  const join = (p: ReturnType<typeof splitTyped>) =>
    p.plain + p.plainRest + p.accent + p.accentRest;

  it('tanpa aksen: plain + plainRest, done hanya di akhir', () => {
    expect(splitTyped('Halo', 2)).toEqual({
      plain: 'Ha',
      plainRest: 'lo',
      accent: '',
      accentRest: '',
      done: false,
    });
    expect(splitTyped('Halo', 4)).toMatchObject({ plain: 'Halo', plainRest: '', done: true });
  });

  it('belum sampai aksen: seluruh aksen masih tak terlihat (accentRest penuh)', () => {
    const p = splitTyped(TEXT, 10, 'Taskify');
    expect(p.plain).toBe('Selamat da');
    expect(p.plainRest).toBe('tang di ');
    expect(p.accent).toBe('');
    expect(p.accentRest).toBe('Taskify'); // lebar elemen aksen sudah penuh sejak awal
  });

  it('aksen mulai terketik setelah bagian plain habis', () => {
    // "Selamat datang di " = 18 karakter
    const p = splitTyped(TEXT, 21, 'Taskify');
    expect(p).toEqual({
      plain: 'Selamat datang di ',
      plainRest: '',
      accent: 'Tas',
      accentRest: 'kify',
      done: false,
    });
  });

  it('selesai: seluruh aksen tampil, tak ada sisa', () => {
    expect(splitTyped(TEXT, 999, 'Taskify')).toEqual({
      plain: 'Selamat datang di ',
      plainRest: '',
      accent: 'Taskify',
      accentRest: '',
      done: true,
    });
  });

  it('aksen yang BUKAN akhiran diabaikan (tidak merusak teks)', () => {
    const p = splitTyped('Halo dunia', 10, 'Halo');
    expect(p.plain).toBe('Halo dunia');
    expect(p.accent + p.accentRest).toBe('');
  });

  it('n negatif diperlakukan 0; teks kosong langsung done', () => {
    expect(splitTyped('Halo', -5).plain).toBe('');
    expect(splitTyped('', 0).done).toBe(true);
  });

  it('keempat bagian selalu menyusun ulang teks asli di setiap n (termasuk emoji/aksen)', () => {
    const text = 'Selamat pagi, José 😀';
    for (let n = 0; n <= 25; n++) {
      expect(join(splitTyped(text, n, 'José 😀'))).toBe(text);
      expect(join(splitTyped(text, n))).toBe(text);
    }
  });

  it('emoji di batas aksen tidak terbelah', () => {
    for (let n = 0; n <= 25; n++) {
      const p = splitTyped('Hai 😀😀', n, '😀😀');
      for (const part of [p.plain, p.plainRest, p.accent, p.accentRest])
        expect(() => encodeURIComponent(part)).not.toThrow();
    }
  });
});

describe('typingSteps', () => {
  const take = (n: number, ex: string[], o = {}) => {
    const out = [];
    const g = typingSteps(ex, o);
    for (let i = 0; i < n; i++) out.push(g.next().value!);
    return out;
  };

  it('mengetik huruf demi huruf, menahan teks penuh, lalu menghapus', () => {
    const steps = take(9, ['abc'], { typeMs: 10, holdMs: 100, eraseMs: 5, gapMs: 30 });
    expect(steps.map((s) => s.text)).toEqual(['a', 'ab', 'abc', 'ab', 'a', '', 'a', 'ab', 'abc']);
    expect(steps.map((s) => s.delay)).toEqual([10, 10, 100, 5, 5, 30, 10, 10, 100]);
  });

  it('berputar ke contoh berikutnya, lalu kembali ke yang pertama', () => {
    const full = take(40, ['ab', 'cd'])
      .filter((s) => s.delay === 1800)
      .map((s) => s.text);
    expect(full.slice(0, 3)).toEqual(['ab', 'cd', 'ab']);
  });

  it('contoh 1 karakter tidak menghasilkan langkah ganjil', () => {
    expect(take(3, ['x']).map((s) => s.text)).toEqual(['x', '', 'x']);
  });

  it('daftar kosong berhenti (tidak berputar selamanya)', () => {
    expect(typingSteps([]).next().done).toBe(true);
  });

  it('emoji tidak terbelah di langkah mana pun', () => {
    for (const s of take(30, ['a😀b😀'])) expect(() => encodeURIComponent(s.text)).not.toThrow();
  });
});
