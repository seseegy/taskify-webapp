import { describe, expect, it } from 'vitest';
import { mustWipeFor } from './local-reset';

describe('mustWipeFor', () => {
  it('akun lain masuk → kosongkan', () => {
    expect(mustWipeFor('alice', 'bob')).toBe(true);
  });

  it('akun yang sama masuk lagi → jangan (perubahan offline tetap terkirim)', () => {
    expect(mustWipeFor('alice', 'alice')).toBe(false);
  });

  it('pemilik belum tercatat (instalasi lama / baru dikosongkan) → jangan', () => {
    expect(mustWipeFor(null, 'alice')).toBe(false);
  });
});
