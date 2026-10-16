import { describe, expect, it } from 'vitest';
import {
  decodeJwtPayload,
  isTotpCode,
  mfaStatus,
  normalizeTotpCode,
  translateMfaError,
} from './mfa';

const b64url = (o: object) =>
  Buffer.from(JSON.stringify(o))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const jwt = (payload: object) => `${b64url({ alg: 'ES256' })}.${b64url(payload)}.sig`;

const session = (aal: string | undefined, factors: { status: string }[] = []) =>
  ({
    access_token: jwt(aal ? { sub: 'u', aal } : { sub: 'u' }),
    user: { factors },
  }) as never;

describe('mfaStatus', () => {
  it('sesi aal2 → ok', () => {
    expect(mfaStatus(session('aal2', [{ status: 'verified' }]))).toBe('ok');
  });

  it('punya authenticator terverifikasi tapi sesi aal1 → minta kode', () => {
    expect(mfaStatus(session('aal1', [{ status: 'verified' }]))).toBe('challenge');
  });

  it('belum punya authenticator (atau hanya yang belum diverifikasi) → wajib daftar', () => {
    expect(mfaStatus(session('aal1'))).toBe('enroll');
    expect(mfaStatus(session('aal1', [{ status: 'unverified' }]))).toBe('enroll');
  });

  it('token rusak / tanpa claim aal tidak pernah dianggap aal2', () => {
    expect(mfaStatus({ access_token: 'bukan-jwt', user: { factors: [] } } as never)).toBe('enroll');
    expect(mfaStatus(session(undefined, [{ status: 'verified' }]))).toBe('challenge');
  });
});

describe('decodeJwtPayload', () => {
  it('membaca base64url tanpa padding, termasuk karakter non-ASCII', () => {
    expect(decodeJwtPayload(jwt({ aal: 'aal2', name: 'Bambang Ñ' }))).toEqual({
      aal: 'aal2',
      name: 'Bambang Ñ',
    });
  });
});

describe('kode TOTP', () => {
  it('spasi dari salin-tempel dibuang; hanya 6 angka yang sah', () => {
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456');
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode('12345')).toBe(false);
    expect(isTotpCode('12345a')).toBe(false);
  });

  it('pesan error dimengerti', () => {
    expect(translateMfaError({ code: 'mfa_verification_failed' })).toMatch(/Kode salah/);
    expect(translateMfaError(new TypeError('Failed to fetch'))).toMatch(/internet/);
  });
});
