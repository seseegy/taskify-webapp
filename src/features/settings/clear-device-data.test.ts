import { beforeEach, describe, expect, it, vi } from 'vitest';

const forgetDevice = vi.fn<() => Promise<void>>();
const clearShareInbox = vi.fn<() => Promise<void>>();

vi.mock('@/features/sandi/device-trust', () => ({ forgetDevice: () => forgetDevice() }));
vi.mock('@/features/share/share-inbox', () => ({ clearShareInbox: () => clearShareInbox() }));

const { clearDeviceData } = await import('./clear-device-data');

describe('clearDeviceData (saat logout)', () => {
  beforeEach(() => {
    forgetDevice.mockReset();
    clearShareInbox.mockReset().mockResolvedValue(undefined);
  });

  it('MENUNGGU kepercayaan perangkat Sandi terhapus sebelum selesai', async () => {
    let finishForget!: () => void;
    forgetDevice.mockReturnValue(new Promise<void>((r) => (finishForget = r)));

    let done = false;
    const running = clearDeviceData().then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(forgetDevice).toHaveBeenCalledTimes(1);
    expect(done).toBe(false); // halaman belum boleh dimuat ulang

    finishForget();
    await running;
    expect(done).toBe(true);
  });

  it('satu langkah gagal tidak menghalangi logout', async () => {
    forgetDevice.mockRejectedValue(new Error('IndexedDB diblokir'));
    clearShareInbox.mockRejectedValue(new Error('cache rusak'));
    await expect(clearDeviceData()).resolves.toBeUndefined();
  });
});
