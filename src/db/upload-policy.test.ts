import { describe, expect, it } from 'vitest';
import {
  isFatal,
  isSchemaError,
  ROW_MISSING_CODE,
  SCHEMA_GRACE_MS,
  SCHEMA_MIN_ATTEMPTS,
  UploadFailureTracker,
} from './upload-policy';

describe('klasifikasi error upload', () => {
  it('constraint, data, RLS, dan baris hilang = permanen', () => {
    for (const code of ['23514', '23503', '22P02', '42501', ROW_MISSING_CODE]) {
      expect(isFatal({ code })).toBe(true);
    }
  });

  it('penolakan penjaga kunci brankas (23V0n) = permanen, juga menurut aturan kelas 23 klien lama', () => {
    for (const code of ['23V01', '23V02', '23V03', '23V04', '23V05'])
      expect(isFatal({ code })).toBe(true);
  });

  it('jaringan, JWT kedaluwarsa, dan error skema BUKAN permanen langsung', () => {
    expect(isFatal(new TypeError('Failed to fetch'))).toBe(false);
    expect(isFatal({ code: 'PGRST301' })).toBe(false);
    expect(isFatal({ code: 'PGRST204' })).toBe(false);
    expect(isFatal(null)).toBe(false);
  });

  it('PGRST1xx/2xx = error skema; PGRST0xx/3xx tidak', () => {
    expect(isSchemaError({ code: 'PGRST204' })).toBe(true);
    expect(isSchemaError({ code: 'PGRST205' })).toBe(true);
    expect(isSchemaError({ code: 'PGRST100' })).toBe(true);
    expect(isSchemaError({ code: 'PGRST002' })).toBe(false);
    expect(isSchemaError({ code: 'PGRST301' })).toBe(false);
  });
});

describe('UploadFailureTracker', () => {
  const schema = { code: 'PGRST204', message: 'kolom tidak ada' };

  const setup = () => {
    let t = 0;
    const tracker = new UploadFailureTracker(() => t);
    return { tracker, advance: (ms: number) => (t += ms) };
  };

  it('error permanen langsung fatal', () => {
    const { tracker } = setup();
    expect(tracker.verdict('1', { code: '23514' })).toBe('fatal');
  });

  it('error sementara selalu dicoba ulang', () => {
    const { tracker, advance } = setup();
    for (let i = 0; i < 50; i++) {
      advance(60_000);
      expect(tracker.verdict('1', new Error('jaringan'))).toBe('retry');
    }
  });

  it('error skema dicoba ulang selama masa tenggang, lalu fatal agar antrean tidak macet', () => {
    const { tracker, advance } = setup();
    expect(tracker.verdict('1', schema)).toBe('retry');
    advance(SCHEMA_GRACE_MS);
    // Waktu sudah lewat, tetapi percobaan belum cukup (mis. perangkat baru bangun dari tidur)
    for (let i = 2; i < SCHEMA_MIN_ATTEMPTS; i++)
      expect(tracker.verdict('1', schema)).toBe('retry');
    expect(tracker.verdict('1', schema)).toBe('fatal');
  });

  it('banyak percobaan cepat tidak memotong masa tenggang', () => {
    const { tracker, advance } = setup();
    for (let i = 0; i < SCHEMA_MIN_ATTEMPTS * 3; i++) {
      advance(1_000);
      expect(tracker.verdict('1', schema)).toBe('retry');
    }
  });

  it('transaksi lain atau sukses memulai hitungan dari nol', () => {
    const { tracker, advance } = setup();
    tracker.verdict('1', schema);
    advance(SCHEMA_GRACE_MS);
    for (let i = 0; i < SCHEMA_MIN_ATTEMPTS; i++)
      expect(tracker.verdict('2', schema)).toBe('retry');

    tracker.reset();
    advance(SCHEMA_GRACE_MS);
    expect(tracker.verdict('2', schema)).toBe('retry');
  });

  it('jaringan putus di tengah masa tenggang tidak mereset hitungan', () => {
    const { tracker, advance } = setup();
    tracker.verdict('1', schema);
    advance(SCHEMA_GRACE_MS / 2);
    tracker.verdict('1', new Error('offline'));
    advance(SCHEMA_GRACE_MS / 2);
    for (let i = 2; i < SCHEMA_MIN_ATTEMPTS; i++) tracker.verdict('1', schema);
    expect(tracker.verdict('1', schema)).toBe('fatal');
  });
});
