import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TempFile } from '@/db/schema';

const api = {
  createUpload: vi.fn(),
  completeUpload: vi.fn(),
  deleteFile: vi.fn(),
  updateFile: vi.fn(),
};
const put = vi.fn();

class FakeTempfileError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

vi.mock('@powersync/react', () => ({ useQuery: () => ({ data: [], isLoading: false }) }));
vi.mock('./tempfile-api', () => ({
  createUpload: (...a: unknown[]) => api.createUpload(...a),
  completeUpload: (...a: unknown[]) => api.completeUpload(...a),
  deleteFile: (...a: unknown[]) => api.deleteFile(...a),
  updateFile: (...a: unknown[]) => api.updateFile(...a),
  TempfileError: FakeTempfileError,
}));
vi.mock('@/lib/files', () => ({ putWithProgress: (...a: unknown[]) => put(...a) }));

const { startUpload, cancelUpload, changeFile, removeFile, useTempFileStore } =
  await import('./tempfile-store');

const file = (name = 'a.bin', size = 1000) => new File([new Uint8Array(size)], name);
const reserved = (over: Partial<TempFile> = {}) =>
  ({ id: 'srv-1', status: 'pending', deleted_at: null, ...over }) as TempFile;

beforeEach(() => {
  vi.useRealTimers();
  for (const f of [...Object.values(api), put]) f.mockReset();
  useTempFileStore.setState({ jobs: [], overlay: {} });
});

const job = () => useTempFileStore.getState().jobs[0]!;

describe('startUpload', () => {
  it('pesan → PUT dengan progres → periksa; hasilnya masuk overlay sebelum sinkron tiba', async () => {
    api.createUpload.mockResolvedValue({ file: reserved(), uploadUrl: 'https://r2/put' });
    put.mockImplementation(async (_u: string, _f: File, onProgress: (n: number) => void) => {
      onProgress(0.5);
      expect(job()).toMatchObject({ phase: 'uploading', progress: 0.5, fileId: 'srv-1' });
    });
    api.completeUpload.mockResolvedValue(reserved({ status: 'ready' }));

    await startUpload(file(), '7d');
    expect(api.createUpload).toHaveBeenCalledWith(expect.any(File), '7d');
    expect(put.mock.calls[0]![0]).toBe('https://r2/put');
    expect(job().phase).toBe('done');
    expect(useTempFileStore.getState().overlay['srv-1']).toMatchObject({ status: 'ready' });
  });

  it('kuota penuh saat memesan → gagal dengan pesan server, tidak ada PUT', async () => {
    api.createUpload.mockRejectedValue(new FakeTempfileError('Kuota 1 GB penuh.', 'TF001'));
    await startUpload(file(), '1d');
    expect(put).not.toHaveBeenCalled();
    expect(job()).toMatchObject({ phase: 'failed', error: 'Kuota 1 GB penuh.' });
  });

  it('dibatalkan saat mengunggah → pesanan DIHAPUS di server (kuota dibebaskan)', async () => {
    api.createUpload.mockResolvedValue({ file: reserved(), uploadUrl: 'u' });
    put.mockImplementation(
      (_u: string, _f: File, _p: unknown, signal: AbortSignal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () =>
            reject(new DOMException('Dibatalkan', 'AbortError')),
          ),
        ),
    );
    api.deleteFile.mockResolvedValue({ ok: true });
    const running = startUpload(file(), '7d');
    await vi.waitFor(() => expect(job().phase).toBe('uploading'));
    cancelUpload(job().key);
    await running;
    expect(job().phase).toBe('cancelled');
    expect(api.deleteFile).toHaveBeenCalledWith('srv-1');
    expect(useTempFileStore.getState().overlay['srv-1']).toBeNull();
  });

  it('PUT gagal (jaringan/CORS) → pesanan DILEPAS agar kuota tidak tertahan 2 jam', async () => {
    api.createUpload.mockResolvedValue({ file: reserved(), uploadUrl: 'u' });
    put.mockRejectedValue(new Error('Upload gagal — periksa koneksi'));
    api.deleteFile.mockResolvedValue({ ok: true });
    await startUpload(file(), '7d');
    expect(job()).toMatchObject({ phase: 'failed', error: 'Upload gagal — periksa koneksi' });
    expect(api.deleteFile).toHaveBeenCalledWith('srv-1');
  });

  it('pemeriksaan gagal karena jaringan → diulang; ukuran tidak cocok (selain TF004) → langsung gagal', async () => {
    api.createUpload.mockResolvedValue({ file: reserved(), uploadUrl: 'u' });
    put.mockResolvedValue(undefined);
    api.completeUpload
      .mockRejectedValueOnce(new FakeTempfileError('Failed to fetch'))
      .mockResolvedValueOnce(reserved({ status: 'ready' }));
    await startUpload(file(), '7d');
    expect(api.completeUpload).toHaveBeenCalledTimes(2);
    expect(job().phase).toBe('done');

    useTempFileStore.setState({ jobs: [], overlay: {} });
    api.completeUpload.mockReset().mockRejectedValue(new FakeTempfileError('Kedaluwarsa', 'TF003'));
    await startUpload(file(), '7d');
    expect(api.completeUpload).toHaveBeenCalledTimes(1);
    expect(job()).toMatchObject({ phase: 'failed', error: 'Kedaluwarsa' });
    // Objek mungkin sudah lengkap di server: pesanan TIDAK dilepas otomatis
    expect(api.deleteFile).not.toHaveBeenCalled();
  });
});

describe('changeFile & removeFile', () => {
  it('hasil server langsung tampil (overlay); hapus = null', async () => {
    api.updateFile.mockResolvedValue(reserved({ id: 'x', file_name: 'baru' }));
    await changeFile('x', { name: 'baru' });
    expect(useTempFileStore.getState().overlay.x).toMatchObject({ file_name: 'baru' });
    api.deleteFile.mockResolvedValue({ ok: true });
    await removeFile('x');
    expect(useTempFileStore.getState().overlay.x).toBeNull();
  });

  it('gagal di server → overlay TIDAK diubah (tampilan tidak berbohong)', async () => {
    api.deleteFile.mockRejectedValue(new FakeTempfileError('Butuh koneksi internet.'));
    await expect(removeFile('y')).rejects.toThrow(/internet/);
    expect('y' in useTempFileStore.getState().overlay).toBe(false);
  });
});
