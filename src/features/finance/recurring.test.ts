import { describe, expect, it } from 'vitest';
import { buildRule } from '@/features/tasks/recurrence';
import {
  deterministicUuid,
  dueOccurrences,
  firstOccurrenceFrom,
  occurrenceAfter,
} from './recurring';

const rule31 = buildRule({ freq: 'monthly', interval: 1, byDay: [], until: null }, '2026-01-31')!;
const schedule = { rrule: rule31, start_on: '2026-01-31', end_on: null as string | null };

describe('transaksi berulang · tagihan/gaji tgl 31', () => {
  it('tidak melewatkan bulan yang tidak punya tgl 31', () => {
    const { dates, next } = dueOccurrences(
      { ...schedule, next_run_on: '2026-01-31' },
      '2026-10-07',
    );
    expect(dates).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
    ]);
    expect(next).toBe('2026-10-31');
  });

  it('kejadian pertama & berikutnya mengikuti akhir bulan', () => {
    expect(firstOccurrenceFrom(schedule, '2026-02-01')).toBe('2026-02-28');
    expect(occurrenceAfter(schedule, '2026-02-28')).toBe('2026-03-31');
  });

  it('end_on dihormati', () => {
    const s = { ...schedule, end_on: '2026-03-01' };
    expect(occurrenceAfter(s, '2026-02-28')).toBeNull();
  });
});

describe('deterministicUuid', () => {
  it('stabil untuk input sama dan berbeda untuk input beda (mencegah transaksi dobel antar perangkat)', async () => {
    const a = await deterministicUuid('taskify:recurring:r1:2026-02-28');
    expect(await deterministicUuid('taskify:recurring:r1:2026-02-28')).toBe(a);
    expect(await deterministicUuid('taskify:recurring:r1:2026-03-31')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
