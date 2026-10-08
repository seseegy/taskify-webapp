import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_CLEAR_MS, clearClipboardNow, copySecret } from './clipboard';
import { shouldLock, useSandiStore, type LockCheck } from './sandi-store';

function stubClipboard(opts: { readable?: boolean; failWrite?: boolean } = {}) {
  let content = '';
  const writes: string[] = [];
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async (t: string) => {
        if (opts.failWrite) throw new Error('ditolak');
        content = t;
        writes.push(t);
      },
      readText: async () => content,
    },
    permissions: { query: async () => ({ state: opts.readable ? 'granted' : 'prompt' }) },
  });
  return { get: () => content, set: (v: string) => (content = v), writes };
}

describe('copySecret', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearClipboardNow();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('menyalin lalu menghapus papan klip setelah 30 detik', async () => {
    const cb = stubClipboard();
    expect(await copySecret('RAHASIA')).toBe(true);
    expect(cb.get()).toBe('RAHASIA');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1);
    expect(cb.get()).toBe('RAHASIA');
    await vi.advanceTimersByTimeAsync(2);
    expect(cb.get()).toBe('');
  });

  it('gagal menyalin → false dan tidak ada timer yang tertinggal', async () => {
    const cb = stubClipboard({ failWrite: true });
    expect(await copySecret('RAHASIA')).toBe(false);
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS * 2);
    expect(cb.writes).toEqual([]);
  });

  it('menyalin lagi me-reset hitungan mundur, dan yang dihapus adalah yang terbaru', async () => {
    const cb = stubClipboard();
    await copySecret('PERTAMA');
    await vi.advanceTimersByTimeAsync(20_000);
    await copySecret('KEDUA');
    await vi.advanceTimersByTimeAsync(20_000); // 40 dtk sejak yang pertama, 20 dtk sejak yang kedua
    expect(cb.get()).toBe('KEDUA');
    await vi.advanceTimersByTimeAsync(11_000);
    expect(cb.get()).toBe('');
  });

  it('bila izin baca ada dan pengguna sudah menyalin hal lain, JANGAN menimpanya', async () => {
    const cb = stubClipboard({ readable: true });
    await copySecret('RAHASIA');
    cb.set('alamat-rumah-yang-disalin-pengguna');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1);
    expect(cb.get()).toBe('alamat-rumah-yang-disalin-pengguna');
  });

  it('bila izin baca ada dan isinya masih sandi kita → dihapus', async () => {
    const cb = stubClipboard({ readable: true });
    await copySecret('RAHASIA');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1);
    expect(cb.get()).toBe('');
  });

  it('clearClipboardNow (saat dikunci) menghapus segera, dan timer lama tidak menghapus dua kali', async () => {
    const cb = stubClipboard();
    await copySecret('RAHASIA');
    clearClipboardNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.get()).toBe('');
    cb.set('milik-pengguna');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS * 2);
    expect(cb.get()).toBe('milik-pengguna');
  });

  it('clearClipboardNow tanpa rahasia yang menunggu tidak menyentuh papan klip', async () => {
    const cb = stubClipboard();
    cb.set('milik-pengguna');
    clearClipboardNow();
    await vi.advanceTimersByTimeAsync(10);
    expect(cb.get()).toBe('milik-pengguna');
  });
});

describe('shouldLock', () => {
  const MIN = 60_000;
  const base: LockCheck = {
    now: 1_000_000,
    lastActivity: 1_000_000,
    hiddenAt: null,
    autoLockMinutes: 5,
  };

  it('terlihat & aktif → tidak dikunci', () => {
    expect(shouldLock(base)).toBe(false);
    expect(shouldLock({ ...base, now: base.now + 4 * MIN })).toBe(false);
  });

  it('terlihat tetapi diam ≥ batas → dikunci', () => {
    expect(shouldLock({ ...base, now: base.now + 5 * MIN })).toBe(true);
  });

  it('tersembunyi ≥ batas → dikunci; kurang dari batas → tidak', () => {
    const hidden = { ...base, hiddenAt: base.now };
    expect(shouldLock({ ...hidden, now: base.now + 4 * MIN })).toBe(false);
    expect(shouldLock({ ...hidden, now: base.now + 5 * MIN })).toBe(true);
  });

  it('"segera" (0): dikunci begitu ditinggalkan, tetapi tidak dikunci selama terlihat', () => {
    expect(shouldLock({ ...base, autoLockMinutes: 0, hiddenAt: base.now })).toBe(true);
    expect(shouldLock({ ...base, autoLockMinutes: 0, now: base.now + 60 * MIN })).toBe(false);
  });

  it('batas 1 dan 15 menit', () => {
    expect(shouldLock({ ...base, autoLockMinutes: 1, now: base.now + MIN })).toBe(true);
    expect(shouldLock({ ...base, autoLockMinutes: 15, now: base.now + 14 * MIN })).toBe(false);
  });
});

describe('stempel kunci (deteksi DEK usang)', () => {
  const dek = {} as CryptoKey;

  it('unlock menyimpan stempel record; lock menghapus dek dan stempel', () => {
    useSandiStore.getState().unlock(dek, 'wrapped-1');
    expect(useSandiStore.getState().stamp).toBe('wrapped-1');
    useSandiStore.getState().lock();
    expect(useSandiStore.getState().dek).toBeNull();
    expect(useSandiStore.getState().stamp).toBeNull();
  });

  it('flag rekeying bisa dinyalakan dan dimatikan', () => {
    useSandiStore.getState().setRekeying(true);
    expect(useSandiStore.getState().rekeying).toBe(true);
    useSandiStore.getState().setRekeying(false);
    expect(useSandiStore.getState().rekeying).toBe(false);
  });
});
