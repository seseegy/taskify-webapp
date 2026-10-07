import { describe, expect, it } from 'vitest';
import { isoToLocal, localDateTimeToIso, msUntilNextDay, parseTimestamp, todayLocal } from './date';

// Proses tes berjalan di zona waktu America/Los_Angeles (lihat vitest.config.ts) — semua hasil
// di bawah harus tetap mengikuti WIB, bukan zona perangkat.
describe('todayLocal (WIB)', () => {
  it('berganti tepat pukul 00:00 WIB = 17:00 UTC', () => {
    expect(todayLocal(new Date('2026-10-07T16:59:59Z'))).toBe('2026-10-07');
    expect(todayLocal(new Date('2026-10-07T17:00:00Z'))).toBe('2026-10-08');
  });

  it('akhir tahun', () => {
    expect(todayLocal(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
  });
});

describe('msUntilNextDay', () => {
  it('23:59 WIB → sekitar 1 menit lagi', () => {
    expect(msUntilNextDay(Date.parse('2026-10-07T16:59:00Z'))).toBe(60_250);
  });

  it('tepat tengah malam WIB → satu hari penuh', () => {
    expect(msUntilNextDay(Date.parse('2026-10-07T17:00:00Z'))).toBe(86_400_250);
  });

  it('setelah timer berbunyi, todayLocal() benar-benar sudah berganti', () => {
    for (const iso of ['2026-10-07T03:15:00Z', '2026-10-07T16:59:59Z', '2026-03-01T00:00:00Z']) {
      const now = Date.parse(iso);
      const later = new Date(now + msUntilNextDay(now));
      expect(todayLocal(later) > todayLocal(new Date(now))).toBe(true);
    }
  });
});

describe('konversi WIB ↔ UTC', () => {
  it('localDateTimeToIso / isoToLocal bolak-balik', () => {
    const iso = localDateTimeToIso('2026-10-08', '09:00');
    expect(iso).toBe('2026-10-08T02:00:00.000Z');
    expect(isoToLocal(iso)).toEqual({ date: '2026-10-08', time: '09:00' });
  });

  it('timestamp dari PowerSync (spasi, bukan T) dibaca benar', () => {
    expect(parseTimestamp('2026-10-05 07:00:00Z').toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });
});
