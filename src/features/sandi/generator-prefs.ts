import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  SEPARATORS,
  clampLength,
  clampWords,
  type PassphraseOptions,
  type PasswordOptions,
  type Separator,
} from './generator';

export type GeneratorMode = 'password' | 'passphrase';

export interface GeneratorPrefs {
  mode: GeneratorMode;
  password: PasswordOptions;
  passphrase: PassphraseOptions;
}

export const GENERATOR_PREFS_KEY = 'taskify-sandi-generator';

export const DEFAULT_PREFS: GeneratorPrefs = {
  mode: 'password',
  password: DEFAULT_PASSWORD_OPTIONS,
  passphrase: DEFAULT_PASSPHRASE_OPTIONS,
};

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Terima apa pun dari penyimpanan; nilai tidak valid diganti bawaan. Tidak pernah melempar. */
export function sanitizePrefs(raw: unknown): GeneratorPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const p = (typeof o.password === 'object' && o.password !== null ? o.password : {}) as Record<
    string,
    unknown
  >;
  const w = (
    typeof o.passphrase === 'object' && o.passphrase !== null ? o.passphrase : {}
  ) as Record<string, unknown>;

  const password: PasswordOptions = {
    length: clampLength(typeof p.length === 'number' ? p.length : DEFAULT_PASSWORD_OPTIONS.length),
    lower: bool(p.lower, true),
    upper: bool(p.upper, true),
    digits: bool(p.digits, true),
    symbols: bool(p.symbols, true),
    avoidAmbiguous: bool(p.avoidAmbiguous, false),
  };
  // Minimal satu jenis karakter harus aktif, kalau tidak generator tidak bisa menghasilkan apa pun
  if (!password.lower && !password.upper && !password.digits && !password.symbols)
    password.lower = true;

  const separator = SEPARATORS.includes(w.separator as Separator)
    ? (w.separator as Separator)
    : DEFAULT_PASSPHRASE_OPTIONS.separator;
  const passphrase: PassphraseOptions = {
    words: clampWords(typeof w.words === 'number' ? w.words : DEFAULT_PASSPHRASE_OPTIONS.words),
    separator,
    capitalize: bool(w.capitalize, false),
    includeNumber: bool(w.includeNumber, false),
  };

  return { mode: o.mode === 'passphrase' ? 'passphrase' : 'password', password, passphrase };
}

export function readPrefs(): GeneratorPrefs {
  try {
    const raw = localStorage.getItem(GENERATOR_PREFS_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Hanya PENGATURAN yang disimpan (per perangkat), tidak pernah sandi yang dihasilkan. */
export function writePrefs(prefs: GeneratorPrefs) {
  try {
    localStorage.setItem(GENERATOR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* penyimpanan penuh/diblokir: tetap jalan */
  }
}
