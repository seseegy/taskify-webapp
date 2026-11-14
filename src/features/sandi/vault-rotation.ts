/**
 * Pengaman penggantian kunci brankas (ganti master password, kunci pemulihan baru, pulihkan).
 *
 * Mengganti kunci = DEK baru + SEMUA baris terenkripsi ditulis ulang. Server menegakkan dua hal
 * (RPC `apply_vault_rotation`, migrasi …_vault_key_guard.sql): kunci di server masih kunci asal
 * rotasi, dan tidak ada baris di server yang terlewat. Modul ini adalah lapis KLIEN-nya:
 *   1. `rotationBlocker` — jangan mulai bila jelas akan ditolak / tidak bisa dipastikan
 *      (offline, sinkron belum selesai, ada perubahan yang belum terunggah, kunci di server sudah
 *      berbeda). Pengguna belum kehilangan apa pun dan cukup mencoba lagi.
 *   2. `rotationOutcome` — setelah transaksi lokal ditulis, tunggu jawaban server sebelum
 *      menganggap kunci baru berlaku.
 * MURNI (tanpa PowerSync/Supabase) agar bisa diuji.
 */

export type RotationBlocker =
  'offline' | 'not-synced' | 'downloading' | 'pending-uploads' | 'key-changed' | 'unreachable';

export interface RotationProbe {
  online: boolean;
  /** Tersambung ke layanan PowerSync. */
  connected: boolean;
  /** Sinkron penuh pertama sudah selesai. */
  hasSynced: boolean;
  /** Sedang mengunduh perubahan dari server. */
  downloading: boolean;
  /** Jumlah operasi lokal yang belum terunggah. */
  pendingUploads: () => Promise<number>;
  /** `wrapped_key` di SERVER; null = tidak ada brankas; 'unreachable' = tidak terjawab. */
  remoteWrappedKey: () => Promise<string | null | 'unreachable'>;
}

/** null = boleh mulai. */
export async function rotationBlocker(
  probe: RotationProbe,
  localWrappedKey: string,
): Promise<RotationBlocker | null> {
  if (!probe.online || !probe.connected) return 'offline';
  if (!probe.hasSynced) return 'not-synced';
  if (probe.downloading) return 'downloading';
  if ((await probe.pendingUploads()) > 0) return 'pending-uploads';
  const remote = await probe.remoteWrappedKey();
  if (remote === 'unreachable') return 'unreachable';
  if (remote !== localWrappedKey) return 'key-changed';
  return null;
}

export const ROTATION_BLOCKER_MESSAGE: Record<RotationBlocker, string> = {
  offline:
    'Mengganti kunci brankas butuh internet supaya semua perangkat tetap bisa membukanya. Sambungkan lalu coba lagi.',
  'not-synced': 'Sinkronisasi pertama belum selesai. Tunggu sebentar lalu coba lagi.',
  downloading: 'Masih mengunduh perubahan dari server. Tunggu sampai selesai lalu coba lagi.',
  'pending-uploads':
    'Masih ada perubahan di perangkat ini yang belum terkirim. Tunggu sampai terkirim (lihat Pengaturan → Sinkronisasi) lalu coba lagi.',
  'key-changed':
    'Kunci brankas sudah diganti di perangkat lain. Tunggu sinkronisasi, buka brankas dengan master password terbaru, lalu coba lagi.',
  unreachable: 'Tidak bisa memeriksa server. Periksa koneksi lalu coba lagi.',
};

/**
 * Kode penolakan dari server (lihat migrasi …_vault_key_guard.sql). Kelas SQLSTATE 23 (integrity
 * constraint) supaya upload-policy.ts — versi baru MAUPUN versi lama yang masih ter-cache di
 * perangkat — menganggapnya permanen (masuk upload_errors, antrean tidak macet).
 */
export const VAULT_ERROR = {
  /** Kunci di server bukan kunci asal rotasi (rotasi bersamaan dari perangkat lain). */
  keyChanged: '23V01',
  /** Ada baris di server yang tidak ikut / sudah berubah sejak dirotasi perangkat ini. */
  incomplete: '23V02',
  /** Tulisan dienkripsi dengan kunci yang sudah dirotasi / tanpa brankas. */
  staleKey: '23V03',
  /** Transaksi rotasi terlalu besar untuk satu permintaan. */
  tooLarge: '23V04',
  /** Bentuk transaksi rotasi tidak valid, atau rotasi dari aplikasi versi lama. */
  invalid: '23V05',
} as const;

export function rotationRejectedMessage(code: string | null): string {
  const tail =
    ' Tidak ada yang berubah di server. Tunggu beberapa detik sampai sinkron, lalu buka brankas dengan master password LAMA.';
  switch (code) {
    case VAULT_ERROR.keyChanged:
      return 'Kunci brankas sudah diganti di perangkat lain sebelum perubahan ini terkirim.' + tail;
    case VAULT_ERROR.incomplete:
      return (
        'Ada data brankas di server yang belum sampai ke perangkat ini, atau baru saja diubah di perangkat lain.' +
        tail
      );
    case VAULT_ERROR.tooLarge:
      return (
        'Data brankas terlalu besar untuk dikirim sekaligus. Hapus versi konfigurasi/riwayat yang tidak perlu dulu.' +
        tail
      );
    default:
      return `Server menolak penggantian kunci${code ? ` (${code})` : ''}.` + tail;
  }
}

export type RotationOutcome =
  { kind: 'accepted' } | { kind: 'rejected'; code: string | null } | { kind: 'unconfirmed' };

export interface OutcomeProbe {
  /** Operasi rotasi masih menunggu di antrean upload? */
  pending: () => Promise<boolean>;
  /** Kode error bila server menolak rotasi ini (dari upload_errors), selain itu undefined. */
  rejected: () => Promise<string | null | undefined>;
}

/** Tunggu jawaban server atas transaksi rotasi yang baru ditulis. */
export async function rotationOutcome(
  probe: OutcomeProbe,
  { timeoutMs = 30_000, pollMs = 400 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<RotationOutcome> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let code = await probe.rejected();
    if (code !== undefined) return { kind: 'rejected', code };
    if (!(await probe.pending())) {
      // Ditolak tepat di antara dua pemeriksaan → catatan penolakan baru saja ditulis
      code = await probe.rejected();
      return code !== undefined ? { kind: 'rejected', code } : { kind: 'accepted' };
    }
    if (Date.now() >= deadline) return { kind: 'unconfirmed' };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Rotasi TIDAK dimulai (prasyarat belum terpenuhi). Tidak ada yang berubah; brankas tetap terbuka. */
export class RotationBlockedError extends Error {
  readonly blocker: RotationBlocker;
  constructor(blocker: RotationBlocker) {
    super(ROTATION_BLOCKER_MESSAGE[blocker]);
    this.name = 'RotationBlockedError';
    this.blocker = blocker;
  }
}

/**
 * Server MENOLAK rotasi. Tidak ada yang berubah di server, tetapi database lokal masih memegang
 * kunci baru sampai sinkron berikutnya mengembalikannya → brankas harus dikunci.
 */
export class RotationRejectedError extends Error {
  readonly code: string | null;
  constructor(code: string | null) {
    super(rotationRejectedMessage(code));
    this.name = 'RotationRejectedError';
    this.code = code;
  }
}
