import { beforeEach, describe, expect, it, vi } from 'vitest';

/** localStorage palsu (proses tes berjalan di Node). */
function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

/** Muat store dari nol, seperti memuat ulang halaman. */
async function freshStore() {
  vi.resetModules();
  return (await import('./lock-store')).useLockStore;
}

const CONFIG = JSON.stringify({
  salt: 'x',
  hash: 'y',
  iterations: 1,
  length: 4,
  autoLockMinutes: 5,
});

describe('lock-store · percobaan PIN bertahan setelah reload', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('3 percobaan gagal, reload, hitungan tetap 3 (bukan kembali ke 0)', async () => {
    const data = stubStorage({ 'taskify-lock': CONFIG });
    let store = await freshStore();
    for (let i = 0; i < 3; i++) store.getState().registerFailure();
    expect(store.getState().failedAttempts).toBe(3);

    store = await freshStore(); // reload
    expect(store.getState().failedAttempts).toBe(3);
    expect(data.has('taskify-lock-attempts')).toBe(true);
  });

  it('percobaan ke-5 memicu jeda 30 dtk yang juga bertahan setelah reload', async () => {
    stubStorage({ 'taskify-lock': CONFIG });
    let store = await freshStore();
    for (let i = 0; i < 5; i++) store.getState().registerFailure();
    const until = store.getState().cooldownUntil;
    expect(until).toBeGreaterThan(Date.now() + 25_000);

    store = await freshStore(); // reload di tengah jeda
    expect(store.getState().cooldownUntil).toBe(until);
  });

  it('jeda yang sudah lewat dibuang saat dimuat', async () => {
    stubStorage({
      'taskify-lock': CONFIG,
      'taskify-lock-attempts': JSON.stringify({ failedAttempts: 0, cooldownUntil: Date.now() - 1 }),
    });
    const store = await freshStore();
    expect(store.getState().cooldownUntil).toBeNull();
  });

  it('PIN benar (unlock) membersihkan hitungan tersimpan', async () => {
    const data = stubStorage({ 'taskify-lock': CONFIG });
    const store = await freshStore();
    store.getState().registerFailure();
    store.getState().registerFailure();
    store.getState().unlock();
    expect(store.getState().failedAttempts).toBe(0);
    expect(data.has('taskify-lock-attempts')).toBe(false);
  });

  it('data tersimpan yang rusak tidak membuat aplikasi gagal dibuka', async () => {
    stubStorage({ 'taskify-lock': CONFIG, 'taskify-lock-attempts': '{bukan json' });
    const store = await freshStore();
    expect(store.getState().failedAttempts).toBe(0);
    expect(store.getState().cooldownUntil).toBeNull();
  });
});
