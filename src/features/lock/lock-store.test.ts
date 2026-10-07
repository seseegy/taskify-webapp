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

  it('jeda tersimpan yang berbulan-bulan di depan (jam perangkat pernah salah) dijepit ke 30 dtk', async () => {
    stubStorage({
      'taskify-lock': CONFIG,
      'taskify-lock-attempts': JSON.stringify({
        failedAttempts: 0,
        cooldownUntil: Date.now() + 90 * 86_400_000,
      }),
    });
    const store = await freshStore();
    const until = store.getState().cooldownUntil!;
    expect(until).toBeGreaterThan(Date.now());
    expect(until).toBeLessThanOrEqual(Date.now() + 30_000);
  });

  it('dua tab berbagi hitungan: 3 gagal di tab A + 2 gagal di tab B = 5 → jeda', async () => {
    const data = stubStorage({ 'taskify-lock': CONFIG });
    const tabA = await freshStore();
    for (let i = 0; i < 3; i++) tabA.getState().registerFailure();
    expect(tabA.getState().failedAttempts).toBe(3);

    // Tab B dibuka belakangan, memuat hitungan dari penyimpanan bersama
    const tabB = await freshStore();
    expect(tabB.getState().failedAttempts).toBe(3);
    tabB.getState().registerFailure();
    tabB.getState().registerFailure();
    expect(tabB.getState().cooldownUntil).toBeGreaterThan(Date.now());
    expect(JSON.parse(data.get('taskify-lock-attempts')!).cooldownUntil).toBeGreaterThan(
      Date.now(),
    );
  });

  it('tab yang sudah terbuka tidak menimpa hitungan tab lain dengan angka usang', async () => {
    const data = stubStorage({ 'taskify-lock': CONFIG });
    const tabA = await freshStore(); // memuat hitungan 0
    // Sementara itu tab B menambah 4 kegagalan ke penyimpanan bersama
    data.set('taskify-lock-attempts', JSON.stringify({ failedAttempts: 4, cooldownUntil: null }));
    tabA.getState().registerFailure(); // percobaan ke-5 secara total
    expect(tabA.getState().cooldownUntil).toBeGreaterThan(Date.now());
  });

  it('event storage dari tab lain memperbarui state tab ini', async () => {
    const data = stubStorage({ 'taskify-lock': CONFIG });
    let onStorage: ((e: { key: string | null }) => void) | undefined;
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: { key: string | null }) => void) => {
        if (type === 'storage') onStorage = fn;
      },
    });
    const store = await freshStore();
    data.set('taskify-lock-attempts', JSON.stringify({ failedAttempts: 2, cooldownUntil: null }));
    onStorage!({ key: 'taskify-lock-attempts' });
    expect(store.getState().failedAttempts).toBe(2);
    onStorage!({ key: 'kunci-lain' }); // diabaikan
    expect(store.getState().failedAttempts).toBe(2);
  });
});
