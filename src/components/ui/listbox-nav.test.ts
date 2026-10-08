import { describe, expect, it } from 'vitest';
import {
  computePlacement,
  MIN_POPUP_HEIGHT,
  nextIndex,
  OPTION_HEIGHT,
  POPUP_GAP,
  POPUP_PADDING,
  seek,
  typeaheadIndex,
  VISIBLE_OPTIONS,
  type NavOption,
} from './listbox-nav';

const opts = (...labels: string[]): NavOption[] =>
  labels.map((label) => ({ value: label.toLowerCase(), label }));

const WALLETS = opts('Tunai', 'Bank', 'BCA', 'Dana');

describe('seek', () => {
  it('melingkar ke awal setelah opsi terakhir', () => {
    expect(seek(WALLETS, 4, 1)).toBe(0);
    expect(seek(WALLETS, -1, -1)).toBe(3);
  });

  it('melewati opsi nonaktif', () => {
    const list: NavOption[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C', disabled: true },
    ];
    expect(seek(list, 0, 1)).toBe(1);
    expect(seek(list, 2, 1)).toBe(1);
    expect(seek(list, 2, -1)).toBe(1);
  });

  it('semua nonaktif → -1 (tidak berputar tanpa henti)', () => {
    expect(seek([{ value: 'a', label: 'A', disabled: true }], 0, 1)).toBe(-1);
  });
});

describe('nextIndex', () => {
  it('panah bawah dari belum ada pilihan mulai dari opsi pertama', () => {
    expect(nextIndex(WALLETS, -1, 'ArrowDown')).toBe(0);
  });

  it('panah atas dari belum ada pilihan mulai dari opsi terakhir', () => {
    expect(nextIndex(WALLETS, -1, 'ArrowUp')).toBe(3);
  });

  it('bergerak satu langkah dan melingkar di kedua ujung', () => {
    expect(nextIndex(WALLETS, 0, 'ArrowDown')).toBe(1);
    expect(nextIndex(WALLETS, 3, 'ArrowDown')).toBe(0);
    expect(nextIndex(WALLETS, 0, 'ArrowUp')).toBe(3);
  });

  it('Home & End ke ujung yang aktif', () => {
    const list: NavOption[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
      { value: 'd', label: 'D', disabled: true },
    ];
    expect(nextIndex(list, 2, 'Home')).toBe(1);
    expect(nextIndex(list, 1, 'End')).toBe(2);
  });

  it('tombol lain dan daftar kosong tidak diurus', () => {
    expect(nextIndex(WALLETS, 0, 'Enter')).toBeNull();
    expect(nextIndex(WALLETS, 0, 'a')).toBeNull();
    expect(nextIndex([], 0, 'ArrowDown')).toBeNull();
  });
});

describe('typeaheadIndex', () => {
  it('mencari berdasarkan awalan, tidak peduli huruf besar-kecil', () => {
    expect(typeaheadIndex(WALLETS, 'b', -1)).toBe(1);
    expect(typeaheadIndex(WALLETS, 'BA', -1)).toBe(1);
    expect(typeaheadIndex(WALLETS, 'tun', -1)).toBe(0);
  });

  it('satu huruf yang sama berpindah ke kecocokan berikutnya, lalu melingkar', () => {
    // "Bank" dan "BCA" sama-sama diawali B
    expect(typeaheadIndex(WALLETS, 'b', 1)).toBe(2);
    expect(typeaheadIndex(WALLETS, 'b', 2)).toBe(1);
  });

  it('buffer yang dirangkai tidak melompati opsi yang sedang aktif', () => {
    // sudah di "Bank" lalu mengetik "ba" → tetap "Bank", bukan lompat ke kecocokan lain
    expect(typeaheadIndex(WALLETS, 'ba', 1)).toBe(1);
  });

  it('melewati opsi nonaktif', () => {
    const list: NavOption[] = [
      { value: 'b1', label: 'Bank', disabled: true },
      { value: 'b2', label: 'BCA' },
    ];
    expect(typeaheadIndex(list, 'b', -1)).toBe(1);
  });

  it('tidak cocok atau buffer kosong → -1', () => {
    expect(typeaheadIndex(WALLETS, 'z', -1)).toBe(-1);
    expect(typeaheadIndex(WALLETS, '', -1)).toBe(-1);
    expect(typeaheadIndex(WALLETS, '   ', -1)).toBe(-1);
  });
});

describe('computePlacement', () => {
  const rect = { top: 100, bottom: 144, left: 32, width: 240 };

  it('mengikuti lebar & kiri pemicu', () => {
    const p = computePlacement(rect, 900, 4);
    expect(p.left).toBe(32);
    expect(p.width).toBe(240);
  });

  it('terbuka ke bawah bila ruangnya cukup', () => {
    const p = computePlacement(rect, 900, 4);
    expect(p.above).toBe(false);
    expect(p.top).toBe(rect.bottom + POPUP_GAP);
    expect(p.maxHeight).toBe(4 * OPTION_HEIGHT + POPUP_PADDING * 2);
  });

  it('terbuka ke atas bila bawah sempit dan atas lebih lega', () => {
    // pemicu dekat dasar viewport
    const low = { top: 700, bottom: 744, left: 32, width: 240 };
    const p = computePlacement(low, 800, 7);
    expect(p.above).toBe(true);
    expect(p.top).toBe(low.top - p.maxHeight - POPUP_GAP);
  });

  it('tetap ke bawah bila atas juga sempit (tidak melompat tanpa manfaat)', () => {
    const tight = { top: 40, bottom: 84, left: 0, width: 200 };
    const p = computePlacement(tight, 300, 10);
    expect(p.above).toBe(false);
  });

  it('tinggi dibatasi jumlah opsi yang terlihat, lalu digulir', () => {
    const many = computePlacement(rect, 2000, 50);
    expect(many.maxHeight).toBe(VISIBLE_OPTIONS * OPTION_HEIGHT + POPUP_PADDING * 2);
  });

  it('tidak pernah lebih pendek dari batas minimum walau ruang nyaris habis', () => {
    const cramped = { top: 10, bottom: 54, left: 0, width: 200 };
    const p = computePlacement(cramped, 70, 8);
    expect(p.maxHeight).toBe(MIN_POPUP_HEIGHT);
  });
});
