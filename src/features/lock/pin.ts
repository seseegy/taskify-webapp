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
