import { describe, expect, it } from 'vitest';
import { parseCapture } from './parse-capture';

const TODAY = '2026-10-07'; // Rabu

describe('parseCapture · transaksi yang valid', () => {
  it('pengeluaran dengan sufiks, kategori ditebak, tanggal "kemarin"', () => {
    expect(parseCapture('makan siang 25rb kemarin', TODAY)).toMatchObject({
      kind: 'expense',
      title: 'makan siang',
      amount: 25000,
      date: '2026-10-06',
      categoryHint: 'makan',
    });
  });

  it('awalan + atau kata gaji → pemasukan', () => {
    expect(parseCapture('+5jt gaji oktober', TODAY)).toMatchObject({
      kind: 'income',
      amount: 5_000_000,
    });
  });

  it('nominal berpemisah ribuan & angka polos ≥ 4 digit', () => {
    expect(parseCapture('servis motor 1.250.000', TODAY)).toMatchObject({
      kind: 'expense',
      amount: 1_250_000,
    });
    expect(parseCapture('tiket konser 2500000', TODAY)).toMatchObject({ amount: 2_500_000 });
  });

  it('angka kecil di tengah kalimat bukan nominal', () => {
    expect(parseCapture('beli 3 buku 45rb', TODAY)).toMatchObject({ amount: 45000 });
  });

  it('tahun polos bukan nominal', () => {
    expect(parseCapture('target tahun 2027 tercapai', TODAY).kind).toBe('task');
  });
});

describe('parseCapture · angka yang BUKAN uang', () => {
  it('nomor telepon / ID panjang atau berawalan 0', () => {
    for (const s of ['hubungi 081234567890', 'wa ke 6281234567890', 'hubungi +6281234567890']) {
      const c = parseCapture(s, TODAY);
      expect(c.kind, s).toBe('task');
      expect(c.amount, s).toBeUndefined();
    }
  });

  it('angka yang diikuti satuan hitung bukan nominal', () => {
    const c = parseCapture('tulis artikel 1000 kata', TODAY);
    expect(c.kind).toBe('task');
    expect(c.title).toBe('tulis artikel 1000 kata');
  });

  it('nominal sungguhan setelah angka non-uang tetap ditemukan', () => {
    expect(parseCapture('tulis 1000 kata lalu beli kopi 25rb', TODAY)).toMatchObject({
      kind: 'expense',
      amount: 25000,
    });
  });
});

describe('parseCapture · kata tanggal tidak mengubah jenis', () => {
  it('nominal + besok/lusa/minggu depan tetap transaksi (jenis bisa diganti di palette)', () => {
    expect(parseCapture('beli kado 100rb untuk ulang tahun besok', TODAY).kind).toBe('expense');
    expect(parseCapture('+5jt gaji minggu depan', TODAY).kind).toBe('income');
  });

  it('"kemarin" mengatur tanggal, "hari ini" dibuang dari judul', () => {
    expect(parseCapture('makan siang 25rb senin', TODAY).kind).toBe('expense');
    expect(parseCapture('bensin 50rb hari ini', TODAY)).toMatchObject({
      kind: 'expense',
      title: 'bensin',
      date: TODAY,
    });
  });
});
