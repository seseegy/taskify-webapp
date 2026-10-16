import { clearTrust } from '@/features/auth/mfa-trust';
import { forgetDevice } from '@/features/sandi/device-trust';
import { clearShareInbox } from '@/features/share/share-inbox';
import { FILE_CACHE_NAME } from '@/lib/files';

/**
 * Hapus data pribadi yang tersimpan di perangkat DI LUAR database lokal: isi lampiran (struk,
 * zip project, foto jurnal) di Cache Storage, kotak masuk "Bagikan ke Taskify", dan kepercayaan
 * perangkat brankas Sandi ("Ingat perangkat ini", DEK di IndexedDB).
 *
 * `powerSync.disconnectAndClear()` hanya menghapus database, bukan semua itu. Tanpa ini, file yang
 * pernah dibuka tetap ada di perangkat setelah "Keluar" — penting jika perangkat dipakai bersama.
 *
 * Kepercayaan perangkat HARUS ditunggu di sini. `AuthProvider` juga membuangnya saat sesi hilang,
 * tetapi tanpa menunggu (`void`), sementara logout langsung memuat ulang halaman: transaksi
 * IndexedDB yang belum selesai bisa terputus, dan akun yang sama yang masuk lagi akan membuka
 * brankas tanpa master password.
 *
 * Dipanggil saat logout; kegagalan satu langkah tidak boleh menghalangi logout.
 */
export async function clearDeviceData(): Promise<void> {
  // "Ingat perangkat ini" (verifikasi dua langkah) ikut dilupakan saat Keluar
  clearTrust();
  const tasks: Promise<unknown>[] = [clearShareInbox(), forgetDevice()];
  if (typeof caches !== 'undefined') tasks.push(caches.delete(FILE_CACHE_NAME));
  await Promise.allSettled(tasks);
}
