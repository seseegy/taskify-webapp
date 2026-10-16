import { describe, expect, it, vi } from 'vitest';
import { explainErrorCode, retryUploadError, type UploadErrorRecord } from './upload-errors';

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

describe('retryUploadError', () => {
  const rec = (over: Partial<UploadErrorRecord> = {}): UploadErrorRecord => ({
    op: 'PUT',
    table_name: 'tasks',
    row_id: 't1',
    payload: JSON.stringify({ title: 'Beli kopi' }),
    ...over,
  });

  it('PUT/DELETE dikirim apa adanya; sukses → ok', async () => {
    const apply = vi.fn(async () => null);
    const deps = { apply, localRow: async () => null };
    expect(await retryUploadError(rec(), deps)).toEqual({ ok: true });
    expect(apply).toHaveBeenLastCalledWith({
      op: 'PUT',
      table: 'tasks',
      id: 't1',
      opData: { title: 'Beli kopi' },
    });
    await retryUploadError(rec({ op: 'DELETE', payload: null }), deps);
    expect(apply).toHaveBeenLastCalledWith({
      op: 'DELETE',
      table: 'tasks',
      id: 't1',
      opData: undefined,
    });
  });

  it('masih ditolak → pesan yang bisa dibaca', async () => {
    const r = await retryUploadError(rec(), {
      apply: async () => ({ code: '23514', message: 'violates check' }),
      localRow: async () => null,
    });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/batas isian.*violates check/) });
  });

  it('PATCH ke baris yang hilang di server → PUT baris lokal + perubahannya', async () => {
    const apply = vi
      .fn()
      .mockResolvedValueOnce({ code: 'TASKIFY_ROW_MISSING' })
      .mockResolvedValueOnce(null);
    const r = await retryUploadError(rec({ op: 'PATCH', payload: '{"title":"Baru"}' }), {
      apply,
      localRow: async () => ({ id: 't1', title: 'Lama', status: 'todo' }),
    });
    expect(r).toEqual({ ok: true });
    expect(apply).toHaveBeenLastCalledWith({
      op: 'PUT',
      table: 'tasks',
      id: 't1',
      opData: { title: 'Baru', status: 'todo' },
    });
  });

  it('PATCH ke baris yang hilang di server DAN perangkat → tidak bisa, jelaskan', async () => {
    const r = await retryUploadError(rec({ op: 'PATCH' }), {
      apply: async () => ({ code: 'TASKIFY_ROW_MISSING' }),
      localRow: async () => null,
    });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/manual/) });
  });

  it('menolak tabel di luar daftar tersinkron (nama tabel tidak pernah dipercaya)', async () => {
    const apply = vi.fn();
    const r = await retryUploadError(rec({ table_name: 'upload_errors; DROP' }), {
      apply,
      localRow: async () => null,
    });
    expect(r.ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});
