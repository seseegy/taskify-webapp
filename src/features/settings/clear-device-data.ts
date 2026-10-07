import { clearShareInbox } from '@/features/share/share-inbox';
import { FILE_CACHE_NAME } from '@/lib/files';

/**
 * Hapus data pribadi yang tersimpan di perangkat DI LUAR database lokal: isi lampiran (struk,
 * zip project, foto jurnal) di Cache Storage dan kotak masuk "Bagikan ke Taskify".
 *
 * `powerSync.disconnectAndClear()` hanya menghapus database, bukan keduanya. Tanpa ini, file yang
 * pernah dibuka tetap ada di perangkat setelah "Keluar" — penting jika perangkat dipakai bersama.
 * Dipanggil saat logout; kegagalan satu langkah tidak boleh menghalangi logout.
 */
export async function clearDeviceData(): Promise<void> {
  const tasks: Promise<unknown>[] = [clearShareInbox()];
  if (typeof caches !== 'undefined') tasks.push(caches.delete(FILE_CACHE_NAME));
  await Promise.allSettled(tasks);
}
