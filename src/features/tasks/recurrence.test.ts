import { describe, expect, it } from 'vitest';
import {
  buildRule,
  describeRule,
  nextDueAfterCompletion,
  nextOccurrence,
  occurrencesBetween,
  parseRule,
  retargetRule,
  type RecurrenceState,
} from './recurrence';

const monthly = (interval = 1): RecurrenceState => ({
  freq: 'monthly',
  interval,
  byDay: [],
  until: null,
});

describe('recurrence · bulanan di tanggal akhir bulan', () => {
  it('tgl 31 jatuh di hari terakhir bulan pendek (tidak melompati bulan)', () => {
    const rule = buildRule(monthly(), '2026-01-31')!;
    expect(occurrencesBetween(rule, '2026-01-31', '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('tgl 30 → Februari jatuh di tgl 28/29', () => {
    const rule = buildRule(monthly(), '2026-01-30')!;
    const days = occurrencesBetween(rule, '2026-01-30', '2026-01-01', '2026-04-30');
    expect(days).toEqual(['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30']);
    expect(occurrencesBetween(rule, '2028-01-30', '2028-02-01', '2028-02-29')).toEqual([
      '2028-02-29',
    ]);
  });

  it('tgl 29 → Februari non-kabisat jatuh di tgl 28, kabisat tgl 29', () => {
    const rule = buildRule(monthly(), '2026-01-29')!;
    expect(occurrencesBetween(rule, '2026-01-29', '2026-02-01', '2026-03-31')).toEqual([
      '2026-02-28',
      '2026-03-29',
    ]);
    expect(occurrencesBetween(rule, '2028-01-29', '2028-02-01', '2028-02-29')).toEqual([
      '2028-02-29',
    ]);
  });

  it('tgl 1–28 tidak berubah', () => {
    const rule = buildRule(monthly(), '2026-01-15')!;
    expect(rule).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15');
    expect(occurrencesBetween(rule, '2026-01-15', '2026-01-01', '2026-03-31')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('interval 2 bulan tetap menghormati akhir bulan', () => {
    const rule = buildRule(monthly(2), '2026-01-31')!;
    expect(occurrencesBetween(rule, '2026-01-31', '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
      '2026-09-30',
      '2026-11-30',
    ]);
  });

  it('rule lama yang sudah tersimpan (BYMONTHDAY=31) ikut diperbaiki saat dibaca', () => {
    const legacy = 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31';
    expect(nextOccurrence(legacy, '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    expect(occurrencesBetween(legacy, '2026-01-31', '2026-04-01', '2026-04-30')).toEqual([
      '2026-04-30',
    ]);
  });

  it('batas "sampai" (until) tetap dihormati', () => {
    const rule = buildRule({ ...monthly(), until: '2026-03-15' }, '2026-01-31')!;
    expect(occurrencesBetween(rule, '2026-01-31', '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
    ]);
  });

  it('model bergulir: selesai di 28 Feb → berikutnya 31 Mar (bukan 28 Mar)', () => {
    const rule = buildRule(monthly(), '2026-01-31')!;
    expect(nextDueAfterCompletion(rule, '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    expect(nextDueAfterCompletion(rule, '2026-02-28', '2026-02-28')).toBe('2026-03-31');
  });

  it('parseRule membaca kembali rule hasil buildRule sebagai bulanan', () => {
    const rule = buildRule(monthly(3), '2026-01-31')!;
    expect(parseRule(rule)).toMatchObject({ freq: 'monthly', interval: 3 });
  });

  it('describeRule menampilkan tanggal sebenarnya, bukan 28', () => {
    expect(describeRule(buildRule(monthly(), '2026-01-31'), '2026-01-31')).toContain('tgl 31');
    expect(describeRule('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31')).toContain('tgl 31');
    expect(describeRule(buildRule(monthly(), '2026-01-15'), '2026-01-15')).toBe(
      'Setiap bulan tgl 15',
    );
  });
});

describe('recurrence · tahunan 29 Februari', () => {
  it('jatuh di 28 Feb pada tahun non-kabisat', () => {
    const rule = buildRule({ freq: 'yearly', interval: 1, byDay: [], until: null }, '2028-02-29')!;
    expect(occurrencesBetween(rule, '2028-02-29', '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });
});

describe('recurrence · mengedit tugas berulang akhir-bulan', () => {
  const rule31 = buildRule(monthly(), '2026-01-31')!;

  it('parseRule membawa tanggal yang dimaksud (31), bukan 28', () => {
    expect(parseRule(rule31)).toMatchObject({ freq: 'monthly', monthDay: 31 });
    expect(parseRule(buildRule(monthly(), '2026-01-15'))).toMatchObject({ monthDay: 15 });
  });

  it('mengubah JAM saja pada baris yang sedang jatuh di 28 Feb tidak mengubah rule', () => {
    expect(retargetRule(rule31, '2026-02-28')).toBe(rule31);
    // dan berikutnya tetap 31 Mar, bukan 28 Mar
    expect(
      nextDueAfterCompletion(retargetRule(rule31, '2026-02-28')!, '2026-02-28', '2026-02-28'),
    ).toBe('2026-03-31');
  });

  it('mengubah interval di editor mempertahankan tanggal 31', () => {
    const edited = buildRule({ ...parseRule(rule31), interval: 2 }, '2026-02-28')!;
    expect(occurrencesBetween(edited, '2026-02-28', '2026-02-01', '2026-12-31')).toEqual([
      '2026-02-28',
      '2026-04-30',
      '2026-06-30',
      '2026-08-31',
      '2026-10-31',
      '2026-12-31',
    ]);
  });

  it('memindahkan tanggal ke hari lain membangun ulang rule dari tanggal baru', () => {
    expect(retargetRule(rule31, '2026-02-15')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15');
  });

  it('memindahkan ke tanggal yang masih kejadian sah (30 Apr) tetap akhir-bulan', () => {
    expect(retargetRule(rule31, '2026-04-30')).toBe(rule31);
  });

  it('rule bukan-bulanan & tanpa rule tidak berubah perilakunya', () => {
    const daily = buildRule({ freq: 'daily', interval: 3, byDay: [], until: null }, '2026-02-01')!;
    expect(retargetRule(daily, '2026-02-10')).toBe(daily);
    expect(retargetRule(null, '2026-02-10')).toBeNull();
    const yearly = buildRule(
      { freq: 'yearly', interval: 1, byDay: [], until: null },
      '2026-10-07',
    )!;
    expect(retargetRule(yearly, '2026-10-08')).toBe(
      'FREQ=YEARLY;INTERVAL=1;BYMONTH=10;BYMONTHDAY=8',
    );
  });
});
