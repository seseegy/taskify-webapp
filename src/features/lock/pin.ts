/**
 * Kunci aplikasi dengan PIN (per perangkat, tidak disinkron).
 *
 * ⚠️ Ini kunci TAMPILAN (privasi dari orang yang memegang HP-mu), bukan enkripsi data.
 *    Data di SQLite lokal & Supabase tetap tidak terenkripsi oleh PIN ini.
 *
 * PIN di-hash dengan PBKDF2-SHA256 (WebCrypto) + salt acak; PIN asli tidak pernah disimpan.
 */

const STORAGE_KEY = 'taskify-lock';
const ITERATIONS = 210_000;

export interface LockConfig {
  salt: string; // base64
  hash: string; // base64
  iterations: number;
  length: number; // panjang PIN → verifikasi otomatis saat digit terakhir dimasukkan
  autoLockMinutes: number; // 0 = kunci setiap kali aplikasi ditinggalkan
}

export const AUTO_LOCK_OPTIONS = [0, 1, 5, 15, 60] as const;

// ----------------------------------------------------------------------------- percobaan gagal
export const ATTEMPTS_KEY = 'taskify-lock-attempts';
/** Jeda setelah 5 percobaan gagal. Juga batas atas nilai tersimpan (lihat readLockAttempts). */
export const COOLDOWN_MS = 30_000;

export interface LockAttempts {
  failedAttempts: number;
  /** epoch ms; null = tidak sedang dijeda */
  cooldownUntil: number | null;
}

/**
 * Hitungan percobaan PIN disimpan agar reload halaman tidak mereset batas 5 percobaan & jeda
 * (kalau hanya di memori, penyerang cukup memuat ulang tab). Jeda yang sudah lewat dibuang.
 */
export function readLockAttempts(now = Date.now()): LockAttempts {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<LockAttempts>) : {};
    const failedAttempts =
      typeof v.failedAttempts === 'number' && v.failedAttempts > 0
        ? Math.floor(v.failedAttempts)
        : 0;
    // Dijepit ke now + COOLDOWN_MS: jika jam perangkat sempat maju jauh lalu dikoreksi, nilai
    // tersimpan bisa berbulan-bulan di depan dan mengunci pengguna di luar aplikasi.
    const cooldownUntil =
      typeof v.cooldownUntil === 'number' && v.cooldownUntil > now
        ? Math.min(v.cooldownUntil, now + COOLDOWN_MS)
        : null;
    return { failedAttempts, cooldownUntil };
  } catch {
    return { failedAttempts: 0, cooldownUntil: null };
  }
}

export function writeLockAttempts(attempts: LockAttempts) {
  try {
    if (attempts.failedAttempts === 0 && attempts.cooldownUntil === null)
      localStorage.removeItem(ATTEMPTS_KEY);
    else localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    /* penyimpanan penuh/diblokir: tetap berjalan dengan hitungan di memori */
  }
}

export function readLockConfig(): LockConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LockConfig) : null;
  } catch {
    return null;
  }
}

export function writeLockConfig(config: LockConfig | null) {
  if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  else localStorage.removeItem(STORAGE_KEY);
}

export async function createLockConfig(pin: string, autoLockMinutes = 5): Promise<LockConfig> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  return {
    salt: toB64(salt),
    hash: toB64(hash),
    iterations: ITERATIONS,
    length: pin.length,
    autoLockMinutes,
  };
}

export async function verifyPin(pin: string, config: LockConfig): Promise<boolean> {
  const hash = await derive(pin, fromB64(config.salt), config.iterations);
  return constantTimeEqual(hash, fromB64(config.hash));
}

export const isValidPin = (pin: string) => /^\d{4,8}$/.test(pin);

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
