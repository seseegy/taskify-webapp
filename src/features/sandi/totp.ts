/**
 * Kode TOTP (RFC 6238) — Taskify sebagai authenticator sendiri.
 *
 * Murni dan tanpa dependensi: HMAC memakai WebCrypto yang sudah dipakai `crypto.ts`.
 * Kunci rahasia disimpan di dalam item Sandi (ikut terenkripsi), jadi tidak ada kolom baru.
 *
 * Catatan base32: TOTP memakai alfabet RFC 4648 (A–Z, 2–7), BUKAN Crockford yang dipakai kunci
 * pemulihan di `crypto.ts`. Keduanya sengaja dipisah.
 */

export const TOTP_DIGITS = [6, 8] as const;
export type TotpDigits = (typeof TOTP_DIGITS)[number];

export const TOTP_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

export interface TotpConfig {
  /** base32 (RFC 4648) tanpa padding, huruf besar. */
  secret: string;
  digits: TotpDigits;
  /** detik per kode */
  period: number;
  algorithm: TotpAlgorithm;
}

export const DEFAULT_DIGITS: TotpDigits = 6;
export const DEFAULT_PERIOD = 30;
export const DEFAULT_ALGORITHM: TotpAlgorithm = 'SHA1';

export const PERIOD_MIN = 5;
export const PERIOD_MAX = 300;
/** Di bawah ini hampir pasti salah tempel, bukan kunci asli. */
export const MIN_SECRET_BYTES = 8;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Panjang sisa (mod 8) yang tidak mungkin dihasilkan base32 yang benar. */
const IMPOSSIBLE_REMAINDER = new Set([1, 3, 6]);

/**
 * base32 RFC 4648 → byte. Toleran terhadap cara orang menempel: huruf kecil, spasi, tanda hubung,
 * dan padding `=`. Bit sisa yang tidak nol diabaikan (seperti authenticator umumnya), karena
 * kunci yang salah toh hanya menghasilkan kode yang salah.
 * `null` = ada karakter di luar alfabet, atau panjangnya mustahil.
 */
export function decodeBase32(text: string): Uint8Array<ArrayBuffer> | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean || IMPOSSIBLE_REMAINDER.has(clean.length % 8)) return null;

  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Bentuk rapi untuk ditampilkan: huruf besar, dikelompokkan 4 ("JBSW Y3DP"). */
export function formatSecret(secret: string): string {
  return (
    secret
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .match(/.{1,4}/g) ?? []
  ).join(' ');
}

const SUBTLE_HASH: Record<TotpAlgorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

function counterBytes(counter: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(counter));
  return buf;
}

/**
 * HOTP (RFC 4226) atas penghitung tertentu. Dipakai langsung oleh tes vektor RFC 6238 yang
 * memberi kunci dalam bentuk byte mentah.
 */
export async function hotpFromBytes(
  secret: Uint8Array<ArrayBuffer>,
  counter: number,
  digits: TotpDigits,
  algorithm: TotpAlgorithm,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: SUBTLE_HASH[algorithm] },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)));

  // Dynamic truncation (RFC 4226 §5.3): 4 nibble terakhir menentukan offset.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpWindow {
  /** Kode yang berlaku sekarang. */
  code: string;
  /** Kode periode berikutnya — ditampilkan saat waktu hampir habis. */
  next: string;
  /** Sisa milidetik sebelum `code` kedaluwarsa. */
  remainingMs: number;
  /** Panjang periode (detik), untuk menggambar hitung mundur. */
  period: number;
}

/** Nomor periode TOTP untuk waktu tertentu (T0 = epoch Unix). */
export function counterAt(atMs: number, period: number): number {
  return Math.floor(atMs / 1000 / period);
}

/**
 * Kode yang berlaku pada `atMs`, kode berikutnya, dan sisa waktunya.
 * `null` = kunci rahasia tidak bisa diurai.
 */
export async function totpWindow(config: TotpConfig, atMs: number): Promise<TotpWindow | null> {
  const secret = decodeBase32(config.secret);
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;

  const period = clampPeriod(config.period);
  const counter = counterAt(atMs, period);
  const [code, next] = await Promise.all([
    hotpFromBytes(secret, counter, config.digits, config.algorithm),
    hotpFromBytes(secret, counter + 1, config.digits, config.algorithm),
  ]);
  secret.fill(0);
  const remainingMs = (counter + 1) * period * 1000 - atMs;
  return { code, next, remainingMs, period };
}

export function clampPeriod(period: number): number {
  if (!Number.isFinite(period)) return DEFAULT_PERIOD;
  return Math.min(PERIOD_MAX, Math.max(PERIOD_MIN, Math.trunc(period)));
}

// ----------------------------------------------------------------------------- validasi & parsing
const isDigits = (n: unknown): n is TotpDigits =>
  (TOTP_DIGITS as readonly number[]).includes(n as number);

const isAlgorithm = (v: unknown): v is TotpAlgorithm =>
  (TOTP_ALGORITHMS as readonly string[]).includes(v as string);

/**
 * Validasi nilai `totp` dari hasil dekripsi item. Dipakai `parsePayload` di `crypto.ts`, jadi
 * harus memaafkan bentuk lama/aneh: apa pun yang tidak masuk akal → `null` (item tetap terbuka,
 * hanya kodenya tidak ada).
 */
export function parseTotpConfig(value: unknown): TotpConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.secret !== 'string') return null;

  const secret = o.secret.toUpperCase().replace(/[\s-]/g, '');
  const bytes = decodeBase32(secret);
  if (!bytes || bytes.length < MIN_SECRET_BYTES) return null;

  return {
    secret,
    digits: isDigits(o.digits) ? o.digits : DEFAULT_DIGITS,
    period: clampPeriod(typeof o.period === 'number' ? o.period : DEFAULT_PERIOD),
    algorithm: isAlgorithm(o.algorithm) ? o.algorithm : DEFAULT_ALGORITHM,
  };
}

export interface TotpInput {
  config: TotpConfig;
  /** Nama dari URI `otpauth://` (issuer), kosong bila tidak ada. */
  name: string;
  /** Akun/email dari label URI, kosong bila tidak ada. */
  username: string;
}

/**
 * Terima dua bentuk tempelan:
 *   1. URI lengkap dari QR: `otpauth://totp/GitHub:rosyid?secret=...&issuer=GitHub&digits=6`
 *   2. kunci rahasia base32 saja: `JBSWY3DPEHPK3PXP`
 * `null` = tidak bisa dipakai (pesan untuk pengguna ada di `totpProblem`).
 */
export function parseTotpInput(text: string): TotpInput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^otpauth:/i.test(trimmed)) return parseOtpauth(trimmed);

  const config = parseTotpConfig({ secret: trimmed });
  return config ? { config, name: '', username: '' } : null;
}

function parseOtpauth(uri: string): TotpInput | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  // hotp:// berbasis penghitung, bukan waktu — tidak didukung.
  if (url.host.toLowerCase() !== 'totp') return null;

  const q = url.searchParams;
  const config = parseTotpConfig({
    secret: q.get('secret') ?? '',
    digits: Number(q.get('digits')),
    period: Number(q.get('period') ?? DEFAULT_PERIOD),
    algorithm: (q.get('algorithm') ?? DEFAULT_ALGORITHM).toUpperCase(),
  });
  if (!config) return null;

  // Label: "/Issuer:akun" atau "/akun". Parameter `issuer` menang bila ada.
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const sep = label.indexOf(':');
  const labelIssuer = sep >= 0 ? label.slice(0, sep).trim() : '';
  const account = (sep >= 0 ? label.slice(sep + 1) : label).trim();

  return {
    config,
    name: (q.get('issuer') ?? labelIssuer).trim(),
    username: account,
  };
}

/** Alasan tempelan ditolak, atau `null` bila bisa dipakai. */
export function totpProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Tempel kunci rahasia atau URI otpauth://.';

  if (/^otpauth:/i.test(trimmed)) {
    if (!/^otpauth:\/\/totp\//i.test(trimmed))
      return 'Hanya URI otpauth://totp/… yang didukung (hotp berbasis penghitung tidak).';
    return parseOtpauth(trimmed)
      ? null
      : 'URI otpauth:// tidak bisa dibaca atau kuncinya tidak valid.';
  }

  const clean = trimmed.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  const bytes = decodeBase32(clean);
  if (!bytes)
    return 'Kunci rahasia harus base32: hanya huruf A–Z dan angka 2–7 (tanpa 0, 1, dan 8).';
  if (bytes.length < MIN_SECRET_BYTES) return 'Kunci rahasia terlalu pendek. Periksa lagi.';
  return null;
}
