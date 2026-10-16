import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTrust,
  gateStatus,
  readTrust,
  recordVerification,
  resetTrustStateForTests,
  resolveGate,
  setRememberChoice,
  TRUST_DAYS,
} from './mfa-trust';

const DAY = 86400_000;
const ctx = (over: Partial<Parameters<typeof gateStatus>[2]> = {}) => ({
  now: 1_000 * DAY,
  online: true,
  trust: null,
  launchUser: null,
  ...over,
});

describe('gateStatus', () => {
  it('status server (belum aal2) selalu menang: kepercayaan perangkat tidak bisa melewatinya', () => {
    const trust = { userId: 'u', until: 2_000 * DAY };
    expect(gateStatus('challenge', 'u', ctx({ trust }))).toBe('challenge');
    expect(gateStatus('enroll', 'u', ctx({ trust, launchUser: 'u' }))).toBe('enroll');
  });

  it('aal2 + perangkat dipercaya dan belum lewat 30 hari → langsung masuk', () => {
    expect(gateStatus('ok', 'u', ctx({ trust: { userId: 'u', until: 1_001 * DAY } }))).toBe('ok');
  });

  it('aal2 tanpa kepercayaan / sudah kedaluwarsa / milik akun lain → konfirmasi ulang', () => {
    expect(gateStatus('ok', 'u', ctx())).toBe('reverify');
    expect(gateStatus('ok', 'u', ctx({ trust: { userId: 'u', until: 1_000 * DAY } }))).toBe(
      'reverify',
    );
    expect(gateStatus('ok', 'u', ctx({ trust: { userId: 'lain', until: 9e15 } }))).toBe('reverify');
  });

  it('sudah lolos sejak aplikasi dibuka → tidak dikunci di tengah pemakaian', () => {
    expect(gateStatus('ok', 'u', ctx({ launchUser: 'u' }))).toBe('ok');
  });

  it('offline → tidak memblokir (kode tidak bisa diperiksa tanpa internet)', () => {
    expect(gateStatus('ok', 'u', ctx({ online: false }))).toBe('ok');
  });
});

describe('recordVerification & resolveGate', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    resetTrustStateForTests();
  });

  it('dicentang → dipercaya 30 hari', () => {
    setRememberChoice(true);
    recordVerification('u', 0);
    expect(readTrust()).toEqual({ userId: 'u', until: TRUST_DAYS * DAY });
  });

  it('tidak dicentang → kepercayaan lama dihapus; hanya berlaku untuk pembukaan ini', () => {
    setRememberChoice(true);
    recordVerification('u', 0);
    setRememberChoice(false);
    recordVerification('u', 0);
    expect(readTrust()).toBeNull();
    expect(resolveGate('ok', 'u')).toBe('ok'); // sudah lolos di pembukaan ini
  });

  it('verifikasi tanpa pilihan (tambah authenticator cadangan) tidak mengubah kepercayaan', () => {
    setRememberChoice(true);
    recordVerification('u', 0);
    recordVerification('u', 5 * DAY);
    expect(readTrust()?.until).toBe(TRUST_DAYS * DAY);
  });

  it('Lupakan perangkat ini → pembukaan berikutnya minta kode lagi', () => {
    setRememberChoice(true);
    recordVerification('u', Date.now());
    clearTrust();
    resetTrustStateForTests(); // = aplikasi dibuka ulang
    expect(resolveGate('ok', 'u')).toBe('reverify');
  });
});
