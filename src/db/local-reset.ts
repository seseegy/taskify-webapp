/**
 * Mengosongkan database lokal & menandai pemiliknya.
 *
 * Database lokal (`taskify.db`) dipakai bersama oleh semua akun yang pernah login di browser ini.
 * Logout lewat Pengaturan mengosongkannya, tetapi sesi juga bisa berakhir TANPA tombol Keluar
 * (refresh token dicabut, logout dari tab lain, sesi kedaluwarsa). Jika setelah itu akun LAIN
 * masuk, data akun sebelumnya masih ada di perangkat dan tampil sampai sync pertama selesai —
 * selamanya bila offline. Karena itu pemilik database dicatat, dan database dikosongkan saat
 * akun yang masuk berbeda.
 *
 * Database TIDAK dikosongkan saat akun yang SAMA masuk lagi: perubahan offline yang belum
 * terunggah tetap aman dan terkirim setelah login ulang.
 */
import type { PowerSyncDatabase } from '@powersync/web';

const OWNER_KEY = 'taskify-db-owner';

export function readDbOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

export function writeDbOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    /* penyimpanan diblokir: pemeriksaan pemilik dilewati, sama seperti sebelum fitur ini */
  }
}

/**
 * true = database lokal milik akun lain dan harus dikosongkan sebelum sync dimulai.
 * Pemilik tidak diketahui (instalasi lama / baru dikosongkan) → tidak dikosongkan.
 */
export function mustWipeFor(owner: string | null, userId: string): boolean {
  return owner !== null && owner !== userId;
}

/**
 * Hapus seluruh isi database lokal, termasuk indeks pencarian FTS (`search_index`, lihat
 * search-index.ts). Indeks itu tabel buatan sendiri, bukan tabel PowerSync, jadi
 * `disconnectAndClear()` tidak menjaminnya ikut kosong — padahal isinya judul & isi jurnal,
 * catatan, dan tugas.
 */
export async function wipeLocalDatabase(powerSync: PowerSyncDatabase) {
  await powerSync.disconnectAndClear();
  await powerSync.execute('DELETE FROM search_index').catch(() => undefined); // FTS tidak tersedia
  writeDbOwner(null);
}
