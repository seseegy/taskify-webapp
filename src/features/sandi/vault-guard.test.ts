import { describe, expect, it } from 'vitest';
import { checkRemoteKey, waitForKeyUpload } from './vault-guard';

describe('checkRemoteKey', () => {
  it('tidak ada baris → none; ada → exists', async () => {
    expect(await checkRemoteKey(async () => ({ data: [], error: null }))).toBe('none');
    expect(await checkRemoteKey(async () => ({ data: [{ id: 'k' }], error: null }))).toBe('exists');
  });

  it('error, data kosong-tak-jelas, melempar, atau timeout → unreachable (gagal tertutup)', async () => {
    expect(await checkRemoteKey(async () => ({ data: null, error: { message: 'offline' } }))).toBe(
      'unreachable',
    );
    expect(await checkRemoteKey(async () => ({ data: null, error: null }))).toBe('unreachable');
    expect(
      await checkRemoteKey(async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBe('unreachable');
    expect(await checkRemoteKey(() => new Promise(() => undefined), 20)).toBe('unreachable');
  });
});

function probe(script: { pending: boolean[]; rejected: boolean[] }) {
  const p = [...script.pending];
  const r = [...script.rejected];
  return {
    keyOpPending: async () => (p.length > 1 ? p.shift()! : p[0]!),
    keyOpRejected: async () => (r.length > 1 ? r.shift()! : r[0]!),
  };
}

describe('waitForKeyUpload', () => {
  const fast = { timeoutMs: 200, pollMs: 5 };

  it('antrean kosong tanpa penolakan → accepted', async () => {
    expect(await waitForKeyUpload(probe({ pending: [false], rejected: [false] }), fast)).toBe(
      'accepted',
    );
  });

  it('menunggu antrean habis lalu accepted', async () => {
    const p = probe({ pending: [true, true, false], rejected: [false] });
    expect(await waitForKeyUpload(p, fast)).toBe('accepted');
  });

  it('ditolak server (tercatat di upload_errors) → rejected, walau antrean sudah kosong', async () => {
    expect(await waitForKeyUpload(probe({ pending: [false], rejected: [false, true] }), fast)).toBe(
      'rejected',
    );
    expect(await waitForKeyUpload(probe({ pending: [true], rejected: [true] }), fast)).toBe(
      'rejected',
    );
  });

  it('tak kunjung selesai sampai batas waktu → unconfirmed (tidak menggantung selamanya)', async () => {
    const t = Date.now();
    expect(
      await waitForKeyUpload(probe({ pending: [true], rejected: [false] }), {
        timeoutMs: 60,
        pollMs: 5,
      }),
    ).toBe('unconfirmed');
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
