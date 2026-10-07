import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quick-parse';

const TODAY = '2026-10-07'; // Rabu

describe('parseQuickAdd · perilaku yang sudah benar', () => {
  it('tanggal relatif, jam, dan prioritas', () => {
    expect(parseQuickAdd('Bayar listrik besok jam 9 !3', TODAY)).toEqual({
      title: 'Bayar listrik',
      due_date: '2026-10-08',
      due_time: '09:00',
      priority: 3,
    });
  });

  it('hari bernama → kemunculan berikutnya (bukan hari ini)', () => {
    expect(parseQuickAdd('Rapat senin 14.30', TODAY)).toEqual({
      title: 'Rapat',
      due_date: '2026-10-12',
      due_time: '14:30',
    });
    expect(parseQuickAdd('Kirim laporan jumat', TODAY).due_date).toBe('2026-10-09');
    expect(parseQuickAdd('Beres-beres minggu', TODAY).due_date).toBe('2026-10-11');
  });

  it('jam tanpa tanggal → hari ini, tag diambil', () => {
    expect(parseQuickAdd('Telepon klien 16.00 #kerja', TODAY)).toMatchObject({
      title: 'Telepon klien',
      due_date: TODAY,
      due_time: '16:00',
      tags: ['kerja'],
    });
  });

  it('judul kosong setelah token dihapus → pakai input apa adanya', () => {
    expect(parseQuickAdd('besok', TODAY)).toEqual({ title: 'besok' });
  });
});

describe('parseQuickAdd · "minggu" sebagai pekan vs hari Minggu', () => {
  it('"minggu depan" = 7 hari lagi, kata "depan" ikut terhapus', () => {
    expect(parseQuickAdd('Review minggu depan', TODAY)).toEqual({
      title: 'Review',
      due_date: '2026-10-14',
    });
  });

  it('"<hari> depan" tidak meninggalkan kata "depan" di judul', () => {
    expect(parseQuickAdd('Rapat senin depan', TODAY)).toEqual({
      title: 'Rapat',
      due_date: '2026-10-12',
    });
  });

  it('"minggu ini/lalu/ke-2/3" bukan hari Minggu → dibiarkan di judul', () => {
    for (const s of [
      'Baca minggu ini',
      'Review minggu lalu',
      'Laporan minggu ke-2',
      'Bab minggu 3',
    ]) {
      expect(parseQuickAdd(s, TODAY)).toEqual({ title: s });
    }
  });
});

describe('parseQuickAdd · angka berformat jam vs angka biasa', () => {
  it('nomor versi / harga tidak dianggap jam', () => {
    expect(parseQuickAdd('Update ke versi 3.14 hari ini', TODAY)).toEqual({
      title: 'Update ke versi 3.14',
      due_date: TODAY,
    });
    expect(parseQuickAdd('Beli beras 10.50', TODAY)).toEqual({ title: 'Beli beras 10.50' });
    expect(parseQuickAdd('Baca bab 2.30 nanti', TODAY)).toEqual({ title: 'Baca bab 2.30 nanti' });
  });

  it('penanda "jam/pukul" membuat angka apa pun dianggap jam', () => {
    expect(parseQuickAdd('Jemput jam 3.14', TODAY)).toMatchObject({ due_time: '03:14' });
    expect(parseQuickAdd('Sholat pukul 17:45', TODAY)).toMatchObject({ due_time: '17:45' });
  });

  it('format titik dua selalu jam; titik hanya untuk menit kelipatan 15', () => {
    expect(parseQuickAdd('Standup 9:05', TODAY)).toMatchObject({ due_time: '09:05' });
    expect(parseQuickAdd('Makan malam 19.15', TODAY)).toMatchObject({ due_time: '19:15' });
    expect(parseQuickAdd('Makan malam 19.00', TODAY)).toMatchObject({ due_time: '19:00' });
  });

  it('jam tidak valid ditolak', () => {
    expect(parseQuickAdd('Tiket 25:99', TODAY)).toEqual({ title: 'Tiket 25:99' });
  });
});
