/**
 * Menyalin rahasia ke papan klip lalu menghapusnya otomatis.
 *
 * Batasan platform (jujur): browser hanya mengizinkan menulis papan klip saat dokumen sedang
 * fokus. Jika tab sudah di latar belakang saat timer berbunyi, penghapusan gagal diam-diam dan
 * sandi tertinggal di papan klip. Karena itu juga dihapus saat brankas dikunci.
 */
export const CLIPBOARD_CLEAR_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: string | null = null;

async function canReadClipboard(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

async function clearIfStillOurs(expected: string) {
  try {
    // Bila izin baca sudah ada, jangan menimpa sesuatu yang disalin pengguna sesudahnya.
    // Tanpa izin baca (jangan memunculkan permintaan izin), hapus saja.
    if (await canReadClipboard()) {
      if ((await navigator.clipboard.readText()) !== expected) return;
    }
    await navigator.clipboard.writeText('');
  } catch {
    /* dokumen tidak fokus / ditolak: tidak ada yang bisa dilakukan */
  }
}

/** true = berhasil disalin. */
export async function copySecret(
  text: string,
  clearAfterMs = CLIPBOARD_CLEAR_MS,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }
  clearTimeout(timer);
  pending = text;
  timer = setTimeout(() => {
    const value = pending;
    pending = null;
    if (value !== null) void clearIfStillOurs(value);
  }, clearAfterMs);
  return true;
}

/** Hapus sekarang bila masih ada rahasia yang menunggu dihapus (dipanggil saat brankas dikunci). */
export function clearClipboardNow(): void {
  clearTimeout(timer);
  const value = pending;
  pending = null;
  if (value !== null) void clearIfStillOurs(value);
}
