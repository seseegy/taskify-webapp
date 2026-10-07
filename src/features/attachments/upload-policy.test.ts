import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAutoRetry, MAX_AUTO_RETRIES, MIN_RETRY_GAP_MS, withUploadLock } from './upload-policy';

describe('canAutoRetry', () => {
  const T0 = 1_000_000;

  it('percobaan pertama selalu boleh', () => {
    expect(canAutoRetry(undefined, T0)).toBe(true);
  });

  it('koneksi berkedip: percobaan berikutnya ditahan sampai jeda 1 menit lewat', () => {
    expect(canAutoRetry({ n: 1, at: T0 }, T0 + 5_000)).toBe(false);
    expect(canAutoRetry({ n: 1, at: T0 }, T0 + MIN_RETRY_GAP_MS - 1)).toBe(false);
    expect(canAutoRetry({ n: 1, at: T0 }, T0 + MIN_RETRY_GAP_MS)).toBe(true);
  });

  it('berhenti setelah batas percobaan walau jeda sudah lewat', () => {
    expect(canAutoRetry({ n: MAX_AUTO_RETRIES, at: T0 }, T0 + 10 * MIN_RETRY_GAP_MS)).toBe(false);
    expect(canAutoRetry({ n: MAX_AUTO_RETRIES - 1, at: T0 }, T0 + MIN_RETRY_GAP_MS)).toBe(true);
  });
});

/** Web Locks palsu dengan semantik `ifAvailable` (dua pemanggil bersamaan → yang kedua dapat null). */
function fakeLocks() {
  const held = new Set<string>();
  return {
    request: async (name: string, _opts: unknown, cb: (lock: object | null) => unknown) => {
      if (held.has(name)) return cb(null);
      held.add(name);
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

describe('withUploadLock', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dua "tab" mengunggah lampiran yang sama bersamaan → hanya satu yang berjalan', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const upload = async () => {
      runs++;
      await gate;
      return 'selesai';
    };

    const tabA = withUploadLock('att-1', upload, 'sibuk');
    const tabB = withUploadLock('att-1', upload, 'sibuk');
    release();
    expect(await Promise.all([tabA, tabB])).toEqual(['selesai', 'sibuk']);
    expect(runs).toBe(1);
  });

  it('lampiran berbeda tidak saling menunggu', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    const out = await Promise.all([
      withUploadLock('a', async () => 'A', 'sibuk'),
      withUploadLock('b', async () => 'B', 'sibuk'),
    ]);
    expect(out).toEqual(['A', 'B']);
  });

  it('kunci dilepas setelah selesai, sehingga percobaan berikutnya bisa jalan', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    expect(await withUploadLock('a', async () => 1, 0)).toBe(1);
    expect(await withUploadLock('a', async () => 2, 0)).toBe(2);
  });

  it('kunci dilepas juga ketika unggahan melempar error', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    await expect(
      withUploadLock(
        'a',
        async () => {
          throw new Error('putus');
        },
        0,
      ),
    ).rejects.toThrow('putus');
    expect(await withUploadLock('a', async () => 2, 0)).toBe(2);
  });

  it('browser tanpa Web Locks tetap menjalankan unggahan', async () => {
    vi.stubGlobal('navigator', {});
    expect(await withUploadLock('a', async () => 'jalan', 'sibuk')).toBe('jalan');
  });
});
