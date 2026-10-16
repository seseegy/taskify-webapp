import { describe, expect, it } from 'vitest';
import { explainErrorCode } from './upload-errors';

describe('explainErrorCode', () => {
  it('menerjemahkan kode permanen yang ditangani connector', () => {
    expect(explainErrorCode('23514')).toMatch(/batas isian/);
    expect(explainErrorCode('23503')).toMatch(/sudah tidak ada/);
    expect(explainErrorCode('42501')).toMatch(/izin/);
    expect(explainErrorCode('22P02')).toMatch(/Format data/);
    expect(explainErrorCode('TASKIFY_ROW_MISSING')).toMatch(/tidak ada di server/);
    expect(explainErrorCode('PGRST204')).toMatch(/migrasi/);
  });

  it('kode kosong/tak dikenal tetap menghasilkan teks yang berguna', () => {
    expect(explainErrorCode(null)).toBe('Ditolak server');
    expect(explainErrorCode('99999')).toBe('Ditolak server');
  });
});
