/**
 * Generator sandi — MURNI (tanpa DOM/database), diuji di Vitest.
 *
 * Keacakan hanya dari `crypto.getRandomValues` (CSPRNG). Jangan pernah `Math.random`.
 * Memilih indeks dengan `x % n` menghasilkan BIAS (nilai kecil sedikit lebih sering muncul);
 * di sini dipakai rejection sampling sehingga setiap indeks benar-benar sama peluangnya.
 */

/** Sumber acak yang bisa diganti di tes. */
export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => void;

const defaultRng: RandomSource = (bytes) => {
  // getRandomValues dibatasi 65.536 byte per panggilan; kita hanya meminta 4.
  globalThis.crypto.getRandomValues(bytes);
};

const TWO_32 = 0x1_0000_0000;

/** Bilangan bulat seragam di [0, max). `max` 1..2^32. */
export function randomInt(max: number, rng: RandomSource = defaultRng): number {
  if (!Number.isInteger(max) || max < 1 || max > TWO_32)
    throw new RangeError(`randomInt: max harus bilangan bulat 1..2^32 (dapat ${max})`);
  if (max === 1) return 0;
  // Buang nilai di ekor yang tidak habis dibagi `max` → tanpa bias modulo
  const limit = TWO_32 - (TWO_32 % max);
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  for (;;) {
    rng(buf);
    const x = view.getUint32(0);
    if (x < limit) return x % max;
  }
}

function shuffle<T>(items: T[], rng: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

// ----------------------------------------------------------------------------- karakter
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITS = '0123456789';
/** Tanpa tanda kutip, backslash, spasi, <>|~ — sering ditolak situs atau merusak penempelan. */
export const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
/** Mudah tertukar saat dibaca/diketik ulang. */
export const AMBIGUOUS = 'Il1O0o';

export const LENGTH_MIN = 8;
export const LENGTH_MAX = 128;
export const LENGTH_DEFAULT = 20;

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: LENGTH_DEFAULT,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

/** Kelompok karakter yang dipilih, setelah menyingkirkan yang ambigu. */
export function charClasses(o: PasswordOptions): string[] {
  const strip = (s: string) =>
    o.avoidAmbiguous ? [...s].filter((c) => !AMBIGUOUS.includes(c)).join('') : s;
  const classes: string[] = [];
  if (o.lower) classes.push(strip(LOWER));
  if (o.upper) classes.push(strip(UPPER));
  if (o.digits) classes.push(strip(DIGITS));
  if (o.symbols) classes.push(strip(SYMBOLS));
  return classes;
}

export const clampLength = (n: number) =>
  Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, Math.round(Number.isFinite(n) ? n : LENGTH_DEFAULT)));

/**
 * Sandi acak. Setiap kelompok yang dipilih DIJAMIN muncul minimal sekali (banyak situs
 * mewajibkannya), sisanya diisi dari gabungan semua kelompok, lalu seluruhnya diacak.
 */
export function generatePassword(opts: PasswordOptions, rng: RandomSource = defaultRng): string {
  const classes = charClasses(opts);
  if (classes.length === 0) throw new RangeError('Pilih minimal satu jenis karakter.');
  const length = clampLength(opts.length);
  const pool = classes.join('');

  const chars: string[] = classes.map((c) => c[randomInt(c.length, rng)]!);
  while (chars.length < length) chars.push(pool[randomInt(pool.length, rng)]!);
  return shuffle(chars, rng).join('');
}

// ----------------------------------------------------------------------------- frasa sandi
export const WORDS_MIN = 4;
export const WORDS_MAX = 10;
export const WORDS_DEFAULT = 5;
export const SEPARATORS = ['-', ' ', '.', '_', ''] as const;
export type Separator = (typeof SEPARATORS)[number];

export interface PassphraseOptions {
  words: number;
  separator: Separator;
  capitalize: boolean;
  /** Tambah satu angka di akhir salah satu kata (untuk situs yang mewajibkan angka). */
  includeNumber: boolean;
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: WORDS_DEFAULT,
  separator: '-',
  capitalize: false,
  includeNumber: false,
};

export const clampWords = (n: number) =>
  Math.min(WORDS_MAX, Math.max(WORDS_MIN, Math.round(Number.isFinite(n) ? n : WORDS_DEFAULT)));

export function generatePassphrase(
  opts: PassphraseOptions,
  wordlist: readonly string[],
  rng: RandomSource = defaultRng,
): string {
  if (wordlist.length < 2) throw new RangeError('Daftar kata kosong.');
  const count = clampWords(opts.words);
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = wordlist[randomInt(wordlist.length, rng)]!;
    if (opts.capitalize) w = w.charAt(0).toUpperCase() + w.slice(1);
    words.push(w);
  }
  if (opts.includeNumber) words[randomInt(count, rng)] += String(randomInt(10, rng));
  return words.join(opts.separator);
}

// ----------------------------------------------------------------------------- entropi
const log2 = (n: number) => Math.log2(n);

/**
 * Perkiraan entropi dalam bit = panjang × log2(ukuran kumpulan karakter). Sedikit melebih-lebihkan
 * karena tiap kelompok dijamin muncul, selisihnya < 1 bit untuk panjang ≥ 8.
 */
export function passwordEntropy(opts: PasswordOptions): number {
  const pool = charClasses(opts).join('').length;
  return pool < 2 ? 0 : clampLength(opts.length) * log2(pool);
}

export function passphraseEntropy(opts: PassphraseOptions, wordlistSize: number): number {
  const words = clampWords(opts.words);
  let bits = words * log2(wordlistSize);
  if (opts.includeNumber) bits += log2(words) + log2(10); // kata mana + angka berapa
  return bits;
}

export type StrengthLabel = 'Lemah' | 'Cukup' | 'Kuat' | 'Sangat kuat';

export interface Strength {
  bits: number;
  label: StrengthLabel;
  /** 0–4, untuk meter */
  score: 0 | 1 | 2 | 3 | 4;
}

export function strengthFromBits(bits: number): Strength {
  if (bits < 40) return { bits, label: 'Lemah', score: bits < 28 ? 0 : 1 };
  if (bits < 60) return { bits, label: 'Cukup', score: 2 };
  if (bits < 80) return { bits, label: 'Kuat', score: 3 };
  return { bits, label: 'Sangat kuat', score: 4 };
}

// ----------------------------------------------------------------------------- sandi buatan pengguna
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  'abc123',
  'iloveyou',
  'admin',
  'admin123',
  'welcome',
  'letmein',
  'monkey',
  'dragon',
  'sandi',
  'kata sandi',
  'katasandi',
  'rahasia',
  'bismillah',
  'indonesia',
  'sayangku',
  'taskify',
]);

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiopasdfghjklzxcvbnm'];

function hasSequence(lower: string, run = 4): boolean {
  for (const seq of SEQUENCES) {
    for (const s of [seq, [...seq].reverse().join('')]) {
      for (let i = 0; i + run <= s.length; i++)
        if (lower.includes(s.slice(i, i + run))) return true;
    }
  }
  return false;
}

/**
 * Perkiraan kekuatan sandi BUATAN MANUSIA (master password). Heuristik konservatif tanpa kamus
 * besar: sengaja lebih pelit daripada hitungan "panjang × kumpulan karakter" mentah, karena
 * manusia memilih pola. Frasa kata-kata dihitung per kata (±11 bit), bukan per huruf.
 * Bukan jaminan — hanya untuk menolak pilihan yang jelas lemah dan memberi umpan balik.
 */
export function estimatePasswordStrength(password: string): Strength & { issues: string[] } {
  const pw = password.normalize('NFKC');
  const issues: string[] = [];
  if (!pw) return { ...strengthFromBits(0), issues };

  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) {
    issues.push('Terlalu umum dipakai.');
    return { ...strengthFromBits(8), issues };
  }

  // Frasa kata-kata ("kuda biru minum kopi pagi"): ±11 bit per kata, bukan per huruf
  const parts = pw.split(/[\s\-._]+/).filter(Boolean);
  if (parts.length >= 3 && parts.every((p) => /^\p{L}+$/u.test(p))) {
    const bits =
      parts.length * 11 - (new Set(parts.map((p) => p.toLowerCase())).size < parts.length ? 11 : 0);
    if (parts.length < 4) issues.push('Pakai minimal 4 kata.');
    return { ...strengthFromBits(bits), issues };
  }

  let pool = 0;
  if (/\p{Ll}/u.test(pw)) pool += 26;
  if (/\p{Lu}/u.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^\p{L}\d]/u.test(pw)) pool += 33;
  pool = Math.max(pool, 10);

  // Karakter berulang hampir tidak menambah keacakan
  const unique = new Set(lower).size;
  const effectiveLength = Math.min([...pw].length, unique * 1.5);
  let bits = effectiveLength * log2(pool);

  if (hasSequence(lower)) {
    issues.push('Mengandung urutan mudah ditebak (abcd, 1234, qwer).');
    bits *= 0.6;
  }
  if (unique <= 3 && pw.length > 4) issues.push('Terlalu banyak karakter berulang.');
  if (/^\p{L}+\d{1,4}$/u.test(pw)) {
    issues.push('Kata diikuti angka adalah pola yang paling sering ditebak.');
    bits = Math.min(bits, 30);
  }
  if ([...pw].length < 12) issues.push('Minimal 12 karakter.');

  return { ...strengthFromBits(bits), issues };
}

/** Syarat master password: tidak boleh lemah. Minimal 12 karakter dan ≥ 50 bit perkiraan. */
export const MASTER_MIN_LENGTH = 12;
export const MASTER_MIN_BITS = 50;

export function masterPasswordProblem(password: string): string | null {
  if ([...password].length < MASTER_MIN_LENGTH) return `Minimal ${MASTER_MIN_LENGTH} karakter.`;
  const s = estimatePasswordStrength(password);
  if (s.bits < MASTER_MIN_BITS)
    return s.issues[0] ?? 'Terlalu mudah ditebak. Panjangkan atau pakai frasa 5 kata.';
  return null;
}
