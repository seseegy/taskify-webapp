import { describe, expect, it, vi } from 'vitest';
import { verifyPasswordForReset, type AuthLikeError } from './forgot-pin';

const base = { email: 'saya@contoh.id', password: 'rahasia', online: true };
const failWith = (e: AuthLikeError | Error) => vi.fn().mockRejectedValue(e);

describe('verifyPasswordForReset', () => {
  it('password benar → ok, dan signIn dipanggil dengan email + password akun', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    expect(await verifyPasswordForReset({ ...base, signIn })).toEqual({ ok: true });
    expect(signIn).toHaveBeenCalledWith('saya@contoh.id', 'rahasia');
  });

  it('password salah (400 / invalid_credentials) → wrong', async () => {
    for (const e of [{ status: 400 }, { code: 'invalid_credentials' }]) {
      const r = await verifyPasswordForReset({ ...base, signIn: failWith(e) });
      expect(r).toMatchObject({ ok: false, reason: 'wrong', message: 'Password salah.' });
    }
  });

  it('terlalu banyak percobaan (429) → rate_limited', async () => {
    const r = await verifyPasswordForReset({ ...base, signIn: failWith({ status: 429 }) });
    expect(r).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('offline: tidak memanggil server sama sekali', async () => {
    const signIn = vi.fn();
    const r = await verifyPasswordForReset({ ...base, online: false, signIn });
    expect(r).toMatchObject({ ok: false, reason: 'offline' });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('jaringan putus di tengah jalan (navigator.onLine bisa berbohong) → offline', async () => {
    for (const e of [
      { name: 'AuthRetryableFetchError', status: 0 },
      new TypeError('Failed to fetch'),
    ]) {
      const r = await verifyPasswordForReset({ ...base, signIn: failWith(e) });
      expect(r).toMatchObject({ ok: false, reason: 'offline' });
    }
  });

  it('password kosong tidak memanggil server', async () => {
    const signIn = vi.fn();
    expect(await verifyPasswordForReset({ ...base, password: '', signIn })).toMatchObject({
      reason: 'empty',
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('error lain menampilkan pesannya, email tidak ada → error', async () => {
    const r = await verifyPasswordForReset({
      ...base,
      signIn: failWith({ status: 500, message: 'server mati' }),
    });
    expect(r).toMatchObject({ reason: 'error', message: 'Gagal memeriksa password: server mati' });
    const noEmail = await verifyPasswordForReset({ ...base, email: null, signIn: vi.fn() });
    expect(noEmail).toMatchObject({ ok: false, reason: 'error' });
  });
});
