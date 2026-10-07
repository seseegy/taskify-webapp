/**
 * Kebijakan unggah lampiran yang murni (tanpa database/UI) supaya bisa diuji:
 * kunci antar-tab dan aturan kapan outbox boleh mencoba lagi.
 */

export const MAX_AUTO_RETRIES = 3;
export const MAX_PER_RUN = 5;
export const MIN_RETRY_GAP_MS = 60_000;

export interface AutoAttempt {
  n: number;
  at: number;
}

/**
 * Boleh dicoba otomatis lagi? Maks. 3 kali per sesi dan jeda ≥ 1 menit antar-percobaan, supaya
 * koneksi yang berkedip tidak menghabiskan jatah dalam hitungan detik dan kegagalan permanen
 * tidak berulang selamanya.
 */
export function canAutoRetry(prev: AutoAttempt | undefined, now: number): boolean {
  if (!prev) return true;
  return prev.n < MAX_AUTO_RETRIES && now - prev.at >= MIN_RETRY_GAP_MS;
}

/**
 * Kunci antar-tab per lampiran (Web Locks). SQLite dipakai bersama semua tab, tetapi progres
 * unggahan hanya ada di memori satu tab, jadi tanpa kunci dua tab bisa mengunggah file yang
 * sama bersamaan. `whenBusy` dikembalikan jika tab lain sedang mengunggahnya. Tanpa Web Locks
 * (browser lama), tetap jalan tanpa kunci.
 */
export async function withUploadLock<T>(id: string, fn: () => Promise<T>, whenBusy: T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn();
  return navigator.locks.request(`taskify-upload:${id}`, { ifAvailable: true }, (lock) =>
    lock ? fn() : whenBusy,
  );
}
