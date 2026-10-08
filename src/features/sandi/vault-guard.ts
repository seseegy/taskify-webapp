/**
 * Pengaman pembuatan brankas pertama. Server hanya menerima SATU baris `pw_keys` per user
 * (unique index). Jika dua perangkat membuat brankas sebelum saling tahu, yang kalah ditolak
 * (23505) sementara item yang sudah ia tulis dengan kunci berbeda tetap terunggah dan tak
 * pernah bisa dibuka. Dua lapis pencegahan di sini; sisanya (dua perangkat membuat PERSIS
 * bersamaan) ditangkap oleh `waitForKeyUpload` dan banner di halaman Sandi.
 */

export type RemoteKeyState = 'none' | 'exists' | 'unreachable';

export const REMOTE_CHECK_TIMEOUT_MS = 8_000;

interface RemoteResult {
  data: unknown[] | null;
  error: unknown;
}

/**
 * Tanya SERVER (bukan database lokal) apakah brankas sudah ada. Butuh internet:
 * gagal / timeout → 'unreachable' (jangan membuat brankas dalam keadaan buta).
 */
export async function checkRemoteKey(
  fetchKeys: () => PromiseLike<RemoteResult>,
  timeoutMs = REMOTE_CHECK_TIMEOUT_MS,
): Promise<RemoteKeyState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const res = await Promise.race([Promise.resolve(fetchKeys()), timeout]);
    if (res === 'timeout' || res.error || !Array.isArray(res.data)) return 'unreachable';
    return res.data.length > 0 ? 'exists' : 'none';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export const REMOTE_KEY_MESSAGE: Record<Exclude<RemoteKeyState, 'none'>, string> = {
  exists:
    'Brankas sudah dibuat di perangkat lain. Tunggu sinkronisasi selesai, lalu buka dengan master password-nya.',
  unreachable:
    'Tidak bisa memeriksa server. Membuat brankas pertama kali butuh internet; sambungkan lalu coba lagi.',
};

export interface UploadProbe {
  /** Masih ada operasi `pw_keys` untuk id ini yang menunggu diunggah? */
  keyOpPending: () => Promise<boolean>;
  /** Server menolak operasi `pw_keys` untuk id ini (tercatat di upload_errors)? */
  keyOpRejected: () => Promise<boolean>;
}

export const KEY_REJECTED_MESSAGE =
  'Server menolak brankas ini karena brankas sudah dibuat di perangkat lain. Tidak ada sandi yang disimpan. Muat ulang halaman lalu buka dengan master password brankas yang pertama dibuat.';

/**
 * Tunggu sampai record kunci yang baru dibuat benar-benar diterima server SEBELUM brankas
 * dibuka (jadi tidak ada item yang ditulis dengan kunci yang akhirnya ditolak).
 * Mengembalikan 'accepted', 'rejected', atau 'unconfirmed' (belum ada kepastian sampai batas
 * waktu, mis. koneksi lambat: brankas tetap dibuka, banner di halaman Sandi menjaga sisanya).
 */
export async function waitForKeyUpload(
  probe: UploadProbe,
  { timeoutMs = 15_000, pollMs = 400 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<'accepted' | 'rejected' | 'unconfirmed'> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe.keyOpRejected()) return 'rejected';
    if (!(await probe.keyOpPending()))
      return (await probe.keyOpRejected()) ? 'rejected' : 'accepted';
    if (Date.now() >= deadline) return 'unconfirmed';
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
