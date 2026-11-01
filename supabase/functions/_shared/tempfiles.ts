// =============================================================================
// Berkas publik (tempfile) — aturan murni yang dipakai Edge Function `tempfiles`.
// MURNI (tanpa impor Deno/npm) agar bisa diuji Vitest: supabase/tests/tempfiles.test.ts.
// Angka & pola di sini HARUS sama dengan migrasi …_temp_files.sql dan
// src/features/tempfiles/tempfile-utils.ts (diuji sama).
// =============================================================================

/** Kuota total semua berkas milik satu akun: 1 GB (1024³ byte). */
export const TEMP_QUOTA_BYTES = 1024 ** 3;

/** Batas atas berlakunya presigned PUT: 1 GB di koneksi ±2,5 Mbps. */
export const UPLOAD_TTL_SECONDS = 60 * 60;

/**
 * Masa berlaku presigned PUT menurut ukuran: cukup untuk mulai mengunggah di koneksi lambat
 * (±256 KB/s) + 10 menit, minimal 15 menit, maksimal 1 jam. S3/R2 memeriksa masa berlaku saat
 * permintaan DIMULAI, jadi unggahan yang sedang berjalan tidak terputus. Semakin pendek, semakin
 * sempit jendela URL itu bisa dipakai menimpa/mengembalikan objek setelah selesai atau dihapus.
 */
export function uploadTtlFor(size: number): number {
  const seconds = Math.ceil(size / (256 * 1024)) + 10 * 60;
  return Math.min(UPLOAD_TTL_SECONDS, Math.max(15 * 60, seconds));
}

/** ETag dari header R2 apa adanya (bertanda kutip), atau null bila tidak ada/tidak wajar. */
export function normalizeEtag(raw: string | null): string | null {
  const v = raw?.trim() ?? '';
  return v.length >= 1 && v.length <= 200 ? v : null;
}
/** Presigned GET untuk pengunduh: pendek, karena tautan publik bisa dipakai siapa saja. */
export const DOWNLOAD_TTL_SECONDS = 5 * 60;

export const EXPIRY_OPTIONS = ['1h', '1d', '7d', '30d', 'never'] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

const EXPIRY_MS: Record<ExpiryOption, number | null> = {
  '1h': 3600_000,
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  never: null,
};

export const isExpiryOption = (v: unknown): v is ExpiryOption =>
  typeof v === 'string' && (EXPIRY_OPTIONS as readonly string[]).includes(v);

/** Waktu kedaluwarsa dari pilihan, dihitung dengan jam SERVER. null = tanpa batas. */
export function expiresAtFor(option: ExpiryOption, nowMs: number): string | null {
  const ms = EXPIRY_MS[option];
  return ms === null ? null : new Date(nowMs + ms).toISOString();
}

/** 1 B – kuota, bilangan bulat. */
export const isValidSize = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= TEMP_QUOTA_BYTES;

const MAX_NAME = 255;

/**
 * Nama tampilan & nama unduhan. Karakter kontrol (termasuk CR/LF → header injection) dan pemisah
 * path diganti '_'; dipotong per code point (bukan per UTF-16 unit) agar emoji tidak terbelah.
 * Kosong → 'berkas'. Hasilnya selalu lolos CHECK char_length 1..255 di Postgres.
 */
export function sanitizeFileName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const cleaned = [...s.normalize('NFC')]
    .map((c) => {
      const code = c.codePointAt(0)!;
      return code < 32 || code === 127 || c === '/' || c === '\\' ? '_' : c;
    })
    .join('')
    .trim();
  const clipped = [...cleaned].slice(0, MAX_NAME).join('').trim();
  return clipped || 'berkas';
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** Tipe MIME hanya sebagai informasi; yang tidak valid → application/octet-stream. */
export function sanitizeMime(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase().split(';')[0]!.trim() : '';
  return MIME_RE.test(s) ? s : 'application/octet-stream';
}

/** Token tautan publik: 32 byte acak, base64url tanpa padding = 43 karakter (256 bit). */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isShareToken = (v: unknown): v is string =>
  typeof v === 'string' && SHARE_TOKEN_RE.test(v);

export function newShareToken(random: (n: number) => Uint8Array): string {
  const bytes = random(32);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/**
 * Key objek R2: `temp/<berkas>`. Nama berkas TIDAK masuk key (disimpan di baris), jadi mengganti
 * nama tidak memindahkan objek dan key tidak bisa dipengaruhi pengguna. Id pemilik juga TIDAK masuk:
 * key terlihat oleh siapa pun yang mengunduh lewat tautan publik (presigned URL).
 * Format ini sengaja berbeda dari key lampiran (`<user>/<lampiran>/<nama>`), sehingga pembersih
 * objek yatim milik fungsi `files` tidak pernah menyentuhnya.
 */
export function tempStorageKey(fileId: string): string {
  if (!isUuid(fileId)) throw new Error('id tidak valid');
  return `temp/${fileId}`;
}
export const TEMP_KEY_RE = /^temp\/[0-9a-f-]{36}$/;

/**
 * Content-Disposition untuk unduhan: SELALU `attachment` (tidak pernah ditampilkan inline di
 * origin R2 — berkas HTML/SVG publik tidak boleh dijalankan sebagai halaman). Nama ASCII sebagai
 * cadangan untuk peramban lama + `filename*` UTF-8 (RFC 6266/5987).
 */
export function attachmentDisposition(name: string): string {
  const safe = sanitizeFileName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Ambil token dari path GET publik `/tempfiles/d/<token>`. */
export function tokenFromPath(pathname: string): string | null {
  const m = /\/d\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return m ? m[1]! : null;
}

/** Kode error (juga dipakai klien untuk pesan): diawali TF. */
export const TEMPFILE_ERROR = {
  quota: 'TF001',
  notFound: 'TF002',
  expired: 'TF003',
  sizeMismatch: 'TF004',
  invalid: 'TF005',
} as const;

/** Status HTTP untuk kode error di atas. */
export const TEMPFILE_ERROR_STATUS: Record<string, number> = {
  TF001: 409,
  TF002: 404,
  TF003: 410,
  TF004: 422,
  TF005: 400,
};

/**
 * Perbandingan rahasia (header cron) dengan waktu konstan terhadap ISI: panjang tetap bocor,
 * tetapi tidak ada tebakan per karakter. Kosong di salah satu sisi = tidak sama.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
