/**
 * Aturan "coba lagi atau simpan ke upload_errors" untuk antrean upload PowerSync (connector.ts).
 * Dipisah dari connector agar bisa diuji tanpa supabase-js maupun PowerSync.
 *
 * Tiga golongan error:
 *   1. PERMANEN langsung  — mengulang pasti gagal lagi:
 *        22xxx data exception, 23xxx pelanggaran constraint, 42501 RLS/grant,
 *        ROW_MISSING_CODE (PATCH ke baris yang tidak ada di server, lihat connector.ts).
 *   2. SKEMA (PostgREST PGRST1xx/PGRST2xx, mis. PGRST204 "kolom tidak ada", PGRST205 "tabel tidak
 *      ada") — biasanya karena aplikasi ter-deploy sebelum migrasinya, atau schema cache PostgREST
 *      belum dimuat ulang. Bisa pulih sendiri, jadi dicoba ulang DULU. Tetapi antrean upload
 *      berjalan berurutan: kalau dicoba ulang selamanya, SEMUA perubahan lain ikut tertahan.
 *      Maka setelah gagal terus selama SCHEMA_GRACE_MS (dan minimal SCHEMA_MIN_ATTEMPTS kali),
 *      transaksi itu dianggap permanen → disimpan ke upload_errors, antrean jalan lagi.
 *   3. Lainnya (jaringan, 5xx, JWT kedaluwarsa PGRST3xx, PGRST0xx koneksi) → selalu coba ulang.
 */

export interface PostgrestLikeError {
  code?: string;
  message?: string;
}

/** Kode buatan klien: PATCH tidak mengenai baris mana pun di server. */
export const ROW_MISSING_CODE = 'TASKIFY_ROW_MISSING';

const FATAL_CODES = [/^22...$/, /^23...$/, /^42501$/, new RegExp(`^${ROW_MISSING_CODE}$`)];
const SCHEMA_CODES = /^PGRST[12]\d\d$/;

export const SCHEMA_GRACE_MS = 10 * 60_000;
export const SCHEMA_MIN_ATTEMPTS = 5;

const codeOf = (error: unknown) =>
  error && typeof error === 'object' && typeof (error as PostgrestLikeError).code === 'string'
    ? (error as PostgrestLikeError).code!
    : null;

export const isFatal = (error: unknown) => {
  const code = codeOf(error);
  return code !== null && FATAL_CODES.some((re) => re.test(code));
};

export const isSchemaError = (error: unknown) => {
  const code = codeOf(error);
  return code !== null && SCHEMA_CODES.test(code);
};

export type UploadVerdict = 'retry' | 'fatal';

/**
 * Mengingat berapa lama transaksi TERDEPAN antrean sudah gagal karena error skema.
 * Hanya satu transaksi yang dilacak: antrean diproses berurutan, jadi yang gagal selalu yang
 * terdepan. Disimpan di memori saja — memuat ulang aplikasi memberi masa tenggang baru.
 */
export class UploadFailureTracker {
  private key: string | null = null;
  private firstAt = 0;
  private attempts = 0;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  verdict(key: string, error: unknown): UploadVerdict {
    if (isFatal(error)) {
      this.reset();
      return 'fatal';
    }
    if (!isSchemaError(error)) {
      // Error sementara tidak menghapus hitungan skema: jaringan putus di tengah masa tenggang
      // tidak boleh membuat transaksi yang sama mulai dari nol lagi.
      return 'retry';
    }
    if (this.key !== key) {
      this.key = key;
      this.firstAt = this.now();
      this.attempts = 0;
    }
    this.attempts++;
    if (this.attempts >= SCHEMA_MIN_ATTEMPTS && this.now() - this.firstAt >= SCHEMA_GRACE_MS) {
      this.reset();
      return 'fatal';
    }
    return 'retry';
  }

  /** Dipanggil setelah transaksi berhasil diunggah. */
  reset() {
    this.key = null;
    this.firstAt = 0;
    this.attempts = 0;
  }
}
