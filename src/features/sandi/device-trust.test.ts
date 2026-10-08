import { describe, expect, it } from 'vitest';
import { trustDaysLeft, trustExpiresAt, trustState, TRUST_DAYS } from './device-trust';

const NOW = Date.parse('2026-10-08T00:00:00.000Z');
const STAMP = 'wrapped-key-v1';

describe('masa berlaku kepercayaan perangkat', () => {
  it('kedaluwarsa dihitung dari jumlah hari', () => {
    expect(trustExpiresAt(NOW, 30)).toBe(NOW + 30 * 86400_000);
    expect(trustExpiresAt(NOW)).toBe(trustExpiresAt(NOW, TRUST_DAYS));
  });

  it('sisa hari dibulatkan ke atas dan tidak pernah negatif', () => {
    const meta = { stamp: STAMP, expiresAt: trustExpiresAt(NOW, 30) };
    expect(trustDaysLeft(meta, NOW)).toBe(30);
    expect(trustDaysLeft(meta, NOW + 29.5 * 86400_000)).toBe(1); // masih ada sisa → 1 hari
    expect(trustDaysLeft(meta, NOW + 30 * 86400_000)).toBe(0);
    expect(trustDaysLeft(meta, NOW + 99 * 86400_000)).toBe(0);
  });
});

describe('trustState', () => {
  const meta = { stamp: STAMP, expiresAt: trustExpiresAt(NOW, 30) };

  it('masih berlaku dan kunci brankas sama → ok', () => {
    expect(trustState(meta, STAMP, NOW)).toBe('ok');
    expect(trustState(meta, STAMP, NOW + 29 * 86400_000)).toBe('ok');
  });

  it('tepat di detik kedaluwarsa sudah dianggap habis', () => {
    expect(trustState(meta, STAMP, meta.expiresAt - 1)).toBe('ok');
    expect(trustState(meta, STAMP, meta.expiresAt)).toBe('expired');
    expect(trustState(meta, STAMP, meta.expiresAt + 1)).toBe('expired');
  });

  it('kunci brankas berganti (ganti master password / rotasi DEK) → stale', () => {
    expect(trustState(meta, 'wrapped-key-v2', NOW)).toBe('stale');
  });

  it('kedaluwarsa diperiksa lebih dulu daripada basi', () => {
    expect(trustState(meta, 'wrapped-key-v2', meta.expiresAt + 1)).toBe('expired');
  });
});
