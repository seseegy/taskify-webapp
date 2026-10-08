import { beforeEach, describe, expect, it } from 'vitest';
import { askConfirm, useConfirmStore } from './confirm-store';

beforeEach(() => {
  // Bersihkan permintaan yang mungkin tertinggal dari tes sebelumnya
  useConfirmStore.getState().settle(false);
});

describe('askConfirm', () => {
  it('menyimpan permintaan dan menunggu jawaban', async () => {
    const answer = askConfirm({ title: 'Hapus tag?' });

    const { request } = useConfirmStore.getState();
    expect(request?.title).toBe('Hapus tag?');

    useConfirmStore.getState().settle(true);
    expect(await answer).toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('batal menghasilkan false', async () => {
    const answer = askConfirm({ title: 'Hapus?' });
    useConfirmStore.getState().settle(false);
    expect(await answer).toBe(false);
  });

  it('opsi diteruskan apa adanya, termasuk tone dan label', () => {
    void askConfirm({
      title: 'Keluar?',
      description: 'Data lokal dihapus.',
      confirmLabel: 'Keluar',
      cancelLabel: 'Tetap di sini',
      tone: 'default',
    });
    const r = useConfirmStore.getState().request;
    expect(r).toMatchObject({
      title: 'Keluar?',
      description: 'Data lokal dihapus.',
      confirmLabel: 'Keluar',
      cancelLabel: 'Tetap di sini',
      tone: 'default',
    });
  });

  it('setiap permintaan punya id berbeda (memaksa dialog dirender ulang)', async () => {
    void askConfirm({ title: 'A' });
    const first = useConfirmStore.getState().request!.id;
    useConfirmStore.getState().settle(false);
    void askConfirm({ title: 'B' });
    expect(useConfirmStore.getState().request!.id).not.toBe(first);
    useConfirmStore.getState().settle(false);
  });

  it('permintaan kedua membatalkan yang pertama — janji lama TIDAK menggantung', async () => {
    const first = askConfirm({ title: 'Pertama' });
    const second = askConfirm({ title: 'Kedua' });

    // yang pertama harus sudah dijawab false tanpa perlu disentuh lagi
    expect(await first).toBe(false);
    expect(useConfirmStore.getState().request?.title).toBe('Kedua');

    useConfirmStore.getState().settle(true);
    expect(await second).toBe(true);
  });

  it('settle tanpa permintaan terbuka tidak melempar dan tidak mengubah apa pun', () => {
    expect(useConfirmStore.getState().request).toBeNull();
    expect(() => useConfirmStore.getState().settle(true)).not.toThrow();
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('settle dua kali hanya menjawab sekali', async () => {
    const answer = askConfirm({ title: 'Hapus?' });
    useConfirmStore.getState().settle(true);
    useConfirmStore.getState().settle(false); // diabaikan
    expect(await answer).toBe(true);
  });
});
