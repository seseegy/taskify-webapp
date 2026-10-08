import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getClockOffset,
  isClockSkewed,
  offsetFromSample,
  setClockOffset,
  SKEW_WARN_MS,
  syncClockOffset,
  totpNow,
} from './totp-clock';

afterEach(() => {
  setClockOffset(0);
  vi.restoreAllMocks();
});

describe('offsetFromSample', () => {
  it('mengompensasi separuh waktu pulang-pergi', () => {
    // server bilang 1000; permintaan dikirim 0, jawaban tiba 200 → titik tengah lokal 100
    expect(offsetFromSample({ serverMs: 1000, sentAtMs: 0, receivedAtMs: 200 })).toBe(900);
  });

  it('jam perangkat lebih cepat → selisih negatif', () => {
    expect(offsetFromSample({ serverMs: 1000, sentAtMs: 5000, receivedAtMs: 5000 })).toBe(-4000);
  });

  it('jam perangkat tepat → 0', () => {
    expect(offsetFromSample({ serverMs: 1000, sentAtMs: 1000, receivedAtMs: 1000 })).toBe(0);
  });

  it('sampel tidak masuk akal diabaikan', () => {
    expect(offsetFromSample({ serverMs: NaN, sentAtMs: 0, receivedAtMs: 1 })).toBeNull();
    expect(offsetFromSample({ serverMs: 1000, sentAtMs: 500, receivedAtMs: 100 })).toBeNull();
    // selisih lebih dari sehari: jam salah total, jangan dipakai
    expect(offsetFromSample({ serverMs: 0, sentAtMs: 9e8, receivedAtMs: 9e8 })).toBeNull();
  });
});

describe('penyimpanan selisih & waktu terkoreksi', () => {
  it('totpNow menambahkan selisih ke jam perangkat', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    setClockOffset(7_500);
    expect(getClockOffset()).toBe(7_500);
    expect(totpNow()).toBe(1_007_500);
  });

  it('peringatan hanya untuk selisih yang berisiko ditolak', () => {
    expect(isClockSkewed(0)).toBe(false);
    expect(isClockSkewed(SKEW_WARN_MS - 1)).toBe(false);
    expect(isClockSkewed(SKEW_WARN_MS)).toBe(true);
    expect(isClockSkewed(-SKEW_WARN_MS)).toBe(true);
  });
});

describe('syncClockOffset', () => {
  const response = (date: string | null) =>
    ({ headers: { get: () => date } }) as unknown as Response;

  it('membaca header Date dan menyimpan selisihnya', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T00:00:00.000Z'));
    const fetchImpl = vi.fn().mockResolvedValue(response('Wed, 07 Oct 2026 00:00:30 GMT'));

    expect(await syncClockOffset('https://x/health', fetchImpl as never)).toBe(30_000);
    expect(getClockOffset()).toBe(30_000);
    expect(isClockSkewed()).toBe(true);
  });

  it('offline atau header tidak ada → null, selisih lama dipertahankan', async () => {
    setClockOffset(1234);
    const failing = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await syncClockOffset('https://x/health', failing as never)).toBeNull();
    expect(getClockOffset()).toBe(1234);

    const noHeader = vi.fn().mockResolvedValue(response(null));
    expect(await syncClockOffset('https://x/health', noHeader as never)).toBeNull();
    expect(getClockOffset()).toBe(1234);
  });

  it('header Date yang tidak bisa diurai diabaikan', async () => {
    const bad = vi.fn().mockResolvedValue(response('bukan tanggal'));
    expect(await syncClockOffset('https://x/health', bad as never)).toBeNull();
    expect(getClockOffset()).toBe(0);
  });
});
