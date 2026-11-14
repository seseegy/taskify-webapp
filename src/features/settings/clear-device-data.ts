import { clearTrust } from '@/features/auth/mfa-trust';
import { forgetPushSubscription } from '@/features/notifications/push';
import { forgetDevice } from '@/features/sandi/device-trust';
import { clearShareInbox } from '@/features/share/share-inbox';
import { FILE_CACHE_NAME } from '@/lib/files';

/**
 * Hapus data pribadi yang tersimpan di perangkat DI LUAR database lokal: isi lampiran (struk,
 * zip project, foto jurnal) di Cache Storage, kotak masuk "Bagikan ke Taskify", kepercayaan
 * perangkat brankas Sandi ("Ingat perangkat ini", DEK di IndexedDB), dan langganan notifikasi
 * push perangkat ini.
 *
 * `powerSync.disconnectAndClear()` hanya menghapus database, bukan semua itu. Tanpa ini, file yang
 * pernah dibuka tetap ada di perangkat setelah "Keluar" — penting jika perangkat dipakai bersama —
 * dan perangkat tetap menerima pengingat (berisi judul tugas) milik akun yang sudah keluar.
 *
 * Kepercayaan perangkat HARUS ditunggu di sini. `AuthProvider` juga membuangnya saat sesi hilang,
 * tetapi tanpa menunggu (`void`), sementara logout langsung memuat ulang halaman: transaksi
 * IndexedDB yang belum selesai bisa terputus, dan akun yang sama yang masuk lagi akan membuka
 * brankas tanpa master password.
 *
 * Dipanggil saat logout (SEBELUM signOut, supaya baris langganan di server masih bisa dihapus)
 * dan saat database lokal milik akun lain dibersihkan. Kegagalan satu langkah tidak boleh
 * menghalangi logout.
 */
export async function clearDeviceData(): Promise<void> {
  // "Ingat perangkat ini" (verifikasi dua langkah) ikut dilupakan saat Keluar
  clearTrust();
  const tasks: Promise<unknown>[] = [clearShareInbox(), forgetDevice(), forgetPushSubscription()];
  if (typeof caches !== 'undefined') tasks.push(caches.delete(FILE_CACHE_NAME));
  await Promise.allSettled(tasks);
}
