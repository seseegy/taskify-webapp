import { describe, expect, it } from 'vitest';
import { recoveryFileText } from './recovery-file';

describe('recoveryFileText', () => {
  const key = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ';

  it('memuat kunci dan akun, serta petunjuk penyimpanan', () => {
    const text = recoveryFileText(key, 'saya@contoh.id');
    expect(text).toContain(key);
    expect(text).toContain('saya@contoh.id');
    expect(text).toMatch(/TERPISAH/);
  });

  it('tanpa email tidak mencetak baris akun kosong', () => {
    const text = recoveryFileText(key, null);
    expect(text).not.toMatch(/Akun\s*:/);
    expect(text).toContain(key);
  });

  it('TIDAK memuat kata "master password" sebagai nilai (berkas ini tak pernah berisi password)', () => {
    expect(recoveryFileText(key, 'a@b.id')).not.toMatch(/password\s*[:=]/i);
  });
});
