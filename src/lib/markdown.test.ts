import { describe, expect, it } from 'vitest';
import { plainExcerpt, toggleChecklistLine, wordCount } from './markdown';

// Fungsi-fungsi ini dipindah dari features/journal/journal-utils.ts agar Catatan ikut memakainya.
// Tes ini mengunci perilakunya supaya perpindahan tidak mengubah tampilan Jurnal.

describe('plainExcerpt', () => {
  it('membuang sintaks markdown', () => {
    expect(plainExcerpt('## Judul\n- **tebal** dan _miring_\n- [x] selesai')).toBe(
      'Judul tebal dan miring selesai',
    );
  });

  it('mengambil teks tautan dan membuang gambar & blok kode', () => {
    expect(plainExcerpt('lihat [situs](https://x.id) ![img](a.png) ```kode``` akhir')).toBe(
      'lihat situs akhir',
    );
  });

  it('memotong dengan elipsis di batas', () => {
    const out = plainExcerpt('kata '.repeat(100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('teks pendek utuh, kosong tetap kosong', () => {
    expect(plainExcerpt('halo')).toBe('halo');
    expect(plainExcerpt('   ')).toBe('');
  });
});

describe('wordCount', () => {
  it('menghitung kata dan mengabaikan spasi berlebih', () => {
    expect(wordCount('  satu   dua\ntiga ')).toBe(3);
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
  });
});

describe('toggleChecklistLine', () => {
  it('mencentang dan melepas centang pada baris yang tepat (1-based)', () => {
    const md = '- [ ] a\n- [x] b\n- biasa';
    expect(toggleChecklistLine(md, 1)).toBe('- [x] a\n- [x] b\n- biasa');
    expect(toggleChecklistLine(md, 2)).toBe('- [ ] a\n- [ ] b\n- biasa');
  });

  it('baris non-checklist atau di luar jangkauan tidak diubah', () => {
    const md = '- [ ] a\n- biasa';
    expect(toggleChecklistLine(md, 2)).toBe(md);
    expect(toggleChecklistLine(md, 9)).toBe(md);
  });

  it('mendukung daftar bernomor dan indentasi', () => {
    expect(toggleChecklistLine('  1. [ ] langkah', 1)).toBe('  1. [x] langkah');
  });
});
