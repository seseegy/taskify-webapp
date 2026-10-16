import { describe, expect, it } from 'vitest';
import { mfaRequirementMet, tokenAal } from '../functions/_shared/mfa';

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: object) => `${b64url({ alg: 'ES256' })}.${b64url(payload)}.sig`;

describe('Edge Function · syarat MFA (sama dengan RLS mfa_aal2)', () => {
  const verified = { factors: [{ status: 'verified' }] };

  it('akun ber-MFA: hanya token aal2 yang diterima', () => {
    expect(mfaRequirementMet(verified, jwt({ aal: 'aal2' }))).toBe(true);
    expect(mfaRequirementMet(verified, jwt({ aal: 'aal1' }))).toBe(false);
    expect(mfaRequirementMet(verified, 'rusak')).toBe(false);
  });

  it('akun tanpa faktor terverifikasi: aal1 boleh', () => {
    expect(mfaRequirementMet({ factors: [] }, jwt({ aal: 'aal1' }))).toBe(true);
    expect(mfaRequirementMet({ factors: null }, jwt({ aal: 'aal1' }))).toBe(true);
    expect(mfaRequirementMet({ factors: [{ status: 'unverified' }] }, jwt({ aal: 'aal1' }))).toBe(
      true,
    );
  });

  it('tokenAal membaca base64url tanpa padding', () => {
    expect(tokenAal(jwt({ sub: 'x', aal: 'aal2', n: 'ññ' }))).toBe('aal2');
    expect(tokenAal(jwt({ sub: 'x' }))).toBeNull();
  });
});
