/**
 * Kriptografi Sandi (password manager) — MURNI, hanya WebCrypto, tanpa DOM/database.
 *
 * Model: end-to-end. Semua isi item dienkripsi DI PERANGKAT sebelum ditulis ke SQLite, jadi
 * Supabase, backup pg_dump, dan ekspor JSON hanya melihat data acak.
 *
 *   master password ──PBKDF2-SHA256 (600 rb iterasi, salt acak)──► KEK ──AES-GCM──► membungkus DEK
 *   kunci pemulihan (128 bit acak) ──HKDF-SHA256──► KEK pemulihan ──AES-GCM──► membungkus DEK (salinan ke-2)
 *   DEK (256 bit acak, TIDAK pernah meninggalkan perangkat dalam bentuk polos)
 *        └─ AES-256-GCM, IV acak per item, AAD = user + id item ──► isi item
 *
 * Kenapa DEK terpisah dari master password: isi item tidak terikat pada sandi yang dipilih
 * manusia. Mengganti master password / kunci pemulihan SELALU membuat DEK baru dan mengenkripsi
 * ulang semua item (lihat `rewrap` dan `reencryptItems`), supaya kunci lama benar-benar tidak
 * bisa membuka data saat ini.
 *
 * Yang TIDAK dilindungi: metadata (jumlah item, waktu ubah), dan kunci yang sedang terbuka di
 * memori bila ada XSS. Lupa master password DAN kunci pemulihan = data tidak bisa dipulihkan siapa pun.
 */

// Relatif (bukan '@/'): berkas ini juga diimpor supabase/tests, yang tidak memakai alias
import { sha256Hex16 } from '../../lib/hash';
import { parseTotpConfig, type TotpConfig } from './totp';

export const KEY_RECORD_VERSION = 1;
export const ITEM_VERSION = 1;
export const DEFAULT_ITERATIONS = 600_000;
/**
 * Batas aman jumlah iterasi. Sama dengan CHECK di Postgres (pw_keys.iterations), TETAPI diperiksa
 * juga di klien: nilai itu datang dari server, jadi klien tidak boleh memercayainya begitu saja.
 * Terlalu rendah = brankas mudah ditebak; terlalu tinggi = peramban membeku (DoS).
 */
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 10_000_000;
/** Item dipadatkan ke kelipatan ini agar panjang ciphertext tidak membocorkan panjang sandi. */
const PAD_BLOCK = 256;
const IV_BYTES = 12;
const DEK_BYTES = 32;
const RECOVERY_BYTES = 16;

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

/** Terbaca dari baris `pw_keys` (nama kolom sama dengan database). */
export interface KeyRecord {
  version: number;
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string;
  wrapped_key: string;
  recovery_salt: string;
  recovery_wrapped_key: string;
}

/** Isi sebuah sandi. Semua field ikut terenkripsi (termasuk judul & URL). */
export interface ItemPayload {
  title: string;
  url: string;
  username: string;
  password: string;
  notes: string;
  favorite: boolean;
  /** Kunci TOTP (authenticator) untuk akun ini; null = tidak ada. */
  totp: TotpConfig | null;
}

export const EMPTY_PAYLOAD: ItemPayload = {
  title: '',
  url: '',
  username: '',
  password: '',
  notes: '',
  favorite: false,
  totp: null,
};

export class SandiError extends Error {
  readonly code: 'unsupported' | 'corrupt' | 'invalid';
  constructor(code: 'unsupported' | 'corrupt' | 'invalid', message: string) {
    super(message);
    this.name = 'SandiError';
    this.code = code;
  }
}

// ----------------------------------------------------------------------------- base64
export function toB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const randomBytes = (n: number): Uint8Array<ArrayBuffer> => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

// ----------------------------------------------------------------------------- label kunci
/**
 * Label kunci: 16 hex pertama SHA-256 dari `pw_keys.wrapped_key`. Setiap DEK punya `wrapped_key`
 * yang berbeda (DEK baru + IV acak tiap rotasi), jadi label ini menandai GENERASI kunci data.
 *
 * Ciphertext disimpan sebagai `<label>.<base64>` agar SERVER bisa menolak tulisan yang dienkripsi
 * dengan kunci yang sudah dirotasi (trigger `vault_enc_guard`, fungsi SQL `vault_key_ref` yang
 * menghitung label yang sama). Tanpa itu, perangkat yang offline saat master password diganti
 * di perangkat lain akan mengunggah item dengan DEK lama — dan item itu tidak bisa dibuka lagi.
 *
 * Label bukan rahasia (wrapped_key sendiri sudah tersinkron) dan tidak ikut AAD: ia hanya
 * penunjuk, dan menukarnya tidak membuka apa pun.
 */
export async function keyRef(wrappedKey: string): Promise<string> {
  return sha256Hex16(wrappedKey);
}

const REF_RE = /^[0-9a-f]{16}$/;
const FRAMED_RE = /^([0-9a-f]{16})\.(.+)$/s;

/** Pisahkan label dari ciphertext. Baris lama (sebelum label ada) → `ref: null`. */
export function splitEnc(enc: string): { ref: string | null; body: string } {
  const m = FRAMED_RE.exec(enc);
  return m ? { ref: m[1]!, body: m[2]! } : { ref: null, body: enc };
}

function frame(ref: string, sealed: Uint8Array): string {
  if (!REF_RE.test(ref))
    throw new SandiError('invalid', 'Label kunci brankas tidak valid. Buka brankas lagi.');
  return `${ref}.${toB64(sealed)}`;
}

// ----------------------------------------------------------------------------- AES-GCM
async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string) {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, plaintext),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

/** null = gagal diautentikasi (kunci salah, data diubah, atau AAD tidak cocok). */
async function open(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>, aad: string) {
  if (sealed.length <= IV_BYTES + 16) return null;
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: sealed.subarray(0, IV_BYTES), additionalData: te.encode(aad) },
        key,
        sealed.subarray(IV_BYTES),
      ),
    );
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------- turunan kunci
/** NFKC: "ｐａｓｓ" (lebar penuh) dan "pass" menghasilkan kunci yang sama di semua perangkat. */
const normalize = (password: string) => password.normalize('NFKC');

async function passwordKek(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await subtle().importKey('raw', te.encode(normalize(password)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Kunci pemulihan sudah acak 128 bit → HKDF cukup, tidak perlu KDF lambat. */
async function recoveryKek(recovery: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>) {
  const base = await subtle().importKey('raw', recovery, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('taskify-sandi/recovery/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const aadPassword = (userId: string) => `taskify-sandi/key/v1/${userId}`;
const aadRecovery = (userId: string) => `taskify-sandi/recovery/v1/${userId}`;
const aadItem = (userId: string, itemId: string) => `taskify-sandi/item/v1/${userId}/${itemId}`;
// Domain terpisah: baris riwayat tidak bisa ditukar menjadi item, dan sebaliknya.
const aadTotpLog = (userId: string, rowId: string) =>
  `taskify-sandi/totp-log/v1/${userId}/${rowId}`;
/**
 * Versi konfigurasi (Vault). Mengikat ke BERKAS-nya juga, bukan hanya ke barisnya: ciphertext
 * versi `.env` production tidak bisa dipindah menjadi versi berkas staging.
 */
const aadConfig = (userId: string, fileId: string, versionId: string) =>
  `taskify-sandi/config/v1/${userId}/${fileId}/${versionId}`;

/** DEK polos hanya sesaat di memori: dipakai membungkus/mengimpor, lalu dinolkan. */
async function importDek(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const key = await subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return key;
}

function assertIterations(iterations: number) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS)
    throw new SandiError(
      'invalid',
      'Pengaturan keamanan brankas tidak valid (iterasi di luar batas aman). Brankas tidak dibuka.',
    );
}

function assertSupported(record: KeyRecord) {
  if (record.version > KEY_RECORD_VERSION || record.kdf !== 'pbkdf2-sha256')
    throw new SandiError(
      'unsupported',
      'Versi brankas tidak didukung aplikasi ini. Perbarui aplikasi.',
    );
  assertIterations(record.iterations);
}

// ----------------------------------------------------------------------------- kunci pemulihan
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 byte → 26 karakter Crockford base32, dikelompokkan 4: "ABCD-EFGH-…-YZ". */
export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

/** Toleran terhadap huruf kecil, spasi, tanda hubung, dan salah baca O/0, I/L/1. null = tidak valid. */
export function parseRecoveryKey(text: string): Uint8Array<ArrayBuffer> | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 26) return null;
  let bits = 0;
  let value = 0;
  const out = new Uint8Array(RECOVERY_BYTES);
  let n = 0;
  for (const ch of clean) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      if (n < RECOVERY_BYTES) out[n++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return n === RECOVERY_BYTES ? out : null;
}

// ----------------------------------------------------------------------------- siklus brankas
export interface NewVault {
  record: KeyRecord;
  /** Kunci terbuka, siap dipakai (non-extractable). */
  dek: CryptoKey;
  /** Tampilkan SEKALI ke pengguna. Tidak disimpan di mana pun. */
  recoveryKey: string;
}

export interface KdfOptions {
  /** Hanya untuk tes (minimal MIN_ITERATIONS). Produksi selalu DEFAULT_ITERATIONS. */
  iterations?: number;
}

async function wrapBoth(
  rawDek: Uint8Array<ArrayBuffer>,
  password: string,
  userId: string,
  opts: KdfOptions,
): Promise<{ record: KeyRecord; recoveryKey: string }> {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  assertIterations(iterations); // jangan pernah membuat brankas lemah, apa pun penyebabnya
  const salt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const recovery = randomBytes(RECOVERY_BYTES);

  const kek = await passwordKek(password, salt, iterations);
  const rkek = await recoveryKek(recovery, recoverySalt);
  const record: KeyRecord = {
    version: KEY_RECORD_VERSION,
    kdf: 'pbkdf2-sha256',
    iterations,
    salt: toB64(salt),
    wrapped_key: toB64(await seal(kek, rawDek, aadPassword(userId))),
    recovery_salt: toB64(recoverySalt),
    recovery_wrapped_key: toB64(await seal(rkek, rawDek, aadRecovery(userId))),
  };
  const recoveryKey = formatRecoveryKey(recovery);
  recovery.fill(0);
  return { record, recoveryKey };
}

/** Buat brankas baru: DEK acak, dibungkus oleh master password dan kunci pemulihan. */
export async function createVault(
  password: string,
  userId: string,
  opts: KdfOptions = {},
): Promise<NewVault> {
  const raw = randomBytes(DEK_BYTES);
  try {
    const { record, recoveryKey } = await wrapBoth(raw, password, userId, opts);
    return { record, recoveryKey, dek: await importDek(raw) };
  } finally {
    raw.fill(0);
  }
}

async function unwrapWithPassword(record: KeyRecord, password: string, userId: string) {
  assertSupported(record);
  const kek = await passwordKek(password, fromB64(record.salt), record.iterations);
  return open(kek, fromB64(record.wrapped_key), aadPassword(userId));
}

async function unwrapWithRecovery(record: KeyRecord, recoveryText: string, userId: string) {
  assertSupported(record);
  const recovery = parseRecoveryKey(recoveryText);
  if (!recovery) return null;
  const rkek = await recoveryKek(recovery, fromB64(record.recovery_salt));
  recovery.fill(0);
  return open(rkek, fromB64(record.recovery_wrapped_key), aadRecovery(userId));
}

/** null = master password salah. */
export async function unlockWithPassword(
  record: KeyRecord,
  password: string,
  userId: string,
): Promise<CryptoKey | null> {
  const raw = await unwrapWithPassword(record, password, userId);
  if (!raw) return null;
  try {
    return await importDek(raw);
  } finally {
    raw.fill(0);
  }
}

/** null = kunci pemulihan salah atau salah format. */
export async function unlockWithRecoveryKey(
  record: KeyRecord,
  recoveryText: string,
  userId: string,
): Promise<CryptoKey | null> {
  const raw = await unwrapWithRecovery(record, recoveryText, userId);
  if (!raw) return null;
  try {
    return await importDek(raw);
  } finally {
    raw.fill(0);
  }
}

/**
 * Hasil mengganti master password / kunci pemulihan. `dek` adalah kunci data BARU (selalu dibuat
 * ulang) dan `previousDek` yang lama: semua item HARUS dienkripsi ulang dari `previousDek` ke `dek`
 * (lihat `reencryptItems`) sebelum record baru dianggap berlaku. Tanpa itu, kunci/sandi lama
 * bersama salinan `pw_keys` lama (backup, ekspor) tetap bisa membuka seluruh isi brankas.
 */
export interface RewrittenVault extends NewVault {
  previousDek: CryptoKey;
  /**
   * `wrapped_key` record yang DIROTASI (asal `previousDek`). Server hanya menerima rotasi bila
   * kunci di server masih yang ini (compare-and-swap di `apply_vault_rotation`): dua perangkat
   * yang merotasi bersamaan tidak bisa saling menimpa diam-diam.
   */
  previousWrappedKey: string;
}

/**
 * Ganti master password. DEK ikut DIBUAT BARU (lihat `rewrap`), jadi semua item harus dienkripsi
 * ulang dari `previousDek` ke `dek` (`reencryptItems`) dalam transaksi yang sama dengan record baru.
 * Kunci pemulihan IKUT DIPERBARUI (yang lama tidak berlaku lagi) dan harus ditampilkan ke pengguna.
 * null = master password lama salah.
 */
export async function changePassword(
  record: KeyRecord,
  oldPassword: string,
  newPassword: string,
  userId: string,
  opts: KdfOptions = {},
): Promise<RewrittenVault | null> {
  const raw = await unwrapWithPassword(record, oldPassword, userId);
  return rewrap(raw, record, newPassword, userId, opts);
}

/** Lupa master password: pulihkan dengan kunci pemulihan, atur master password baru + kunci pemulihan baru. */
export async function resetPasswordWithRecovery(
  record: KeyRecord,
  recoveryText: string,
  newPassword: string,
  userId: string,
  opts: KdfOptions = {},
): Promise<RewrittenVault | null> {
  const raw = await unwrapWithRecovery(record, recoveryText, userId);
  return rewrap(raw, record, newPassword, userId, opts);
}

/** Buat kunci pemulihan baru (yang lama dicabut). Butuh master password. null = password salah. */
export async function rotateRecoveryKey(
  record: KeyRecord,
  password: string,
  userId: string,
  opts: KdfOptions = {},
): Promise<RewrittenVault | null> {
  const raw = await unwrapWithPassword(record, password, userId);
  return rewrap(raw, record, password, userId, opts);
}

/** Membuka DEK lama dengan `oldRaw`, lalu membungkus DEK BARU (acak) dengan sandi/kunci pemulihan baru. */
async function rewrap(
  oldRaw: Uint8Array<ArrayBuffer> | null,
  from: KeyRecord,
  newPassword: string,
  userId: string,
  opts: KdfOptions,
): Promise<RewrittenVault | null> {
  if (!oldRaw) return null;
  const newRaw = randomBytes(DEK_BYTES);
  try {
    const previousDek = await importDek(oldRaw);
    const { record, recoveryKey } = await wrapBoth(newRaw, newPassword, userId, opts);
    return {
      record,
      recoveryKey,
      dek: await importDek(newRaw),
      previousDek,
      previousWrappedKey: from.wrapped_key,
    };
  } finally {
    oldRaw.fill(0);
    newRaw.fill(0);
  }
}

// ----------------------------------------------------------------------------- item
function pad(plain: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const framed = 4 + plain.length;
  const total = Math.ceil(framed / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, plain.length);
  out.set(plain, 4);
  return out;
}

function unpad(padded: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (padded.length < 4) return null;
  const len = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (len > padded.length - 4) return null;
  return padded.slice(4, 4 + len);
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Validasi hasil dekripsi; field yang hilang diberi nilai bawaan (kompatibel ke depan). */
export function parsePayload(value: unknown): ItemPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SandiError('corrupt', 'Isi item tidak valid.');
  const o = value as Record<string, unknown>;
  return {
    title: str(o.title),
    url: str(o.url),
    username: str(o.username),
    password: str(o.password),
    notes: str(o.notes),
    favorite: o.favorite === true,
    totp: parseTotpConfig(o.totp),
  };
}

/**
 * Hasil: `<label kunci>.<base64(IV ‖ ciphertext)>` untuk kolom `pw_items.enc`.
 * `ref` = `keyRef(wrapped_key)` milik record kunci yang membuka `dek` (lihat `keyRef`).
 */
export async function encryptItem(
  dek: CryptoKey,
  userId: string,
  itemId: string,
  payload: ItemPayload,
  ref: string,
): Promise<string> {
  const plain = te.encode(JSON.stringify(payload));
  const sealed = await seal(dek, pad(plain), aadItem(userId, itemId));
  return frame(ref, sealed);
}

/** Melempar SandiError('corrupt') bila gagal diautentikasi (data diubah, kunci lain, atau ditukar antar baris). */
export async function decryptItem(
  dek: CryptoKey,
  userId: string,
  itemId: string,
  enc: string,
): Promise<ItemPayload> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromB64(splitEnc(enc).body);
  } catch {
    throw new SandiError('corrupt', 'Data item rusak.');
  }
  const padded = await open(dek, bytes, aadItem(userId, itemId));
  const plain = padded && unpad(padded);
  if (!plain) throw new SandiError('corrupt', 'Item tidak bisa dibuka dengan kunci ini.');
  try {
    return parsePayload(JSON.parse(td.decode(plain)));
  } catch (e) {
    if (e instanceof SandiError) throw e;
    throw new SandiError('corrupt', 'Isi item tidak valid.');
  }
}

// ----------------------------------------------------------------------------- enkripsi ulang
export interface EncryptedRow {
  id: string;
  enc: string;
}

/**
 * Enkripsi ulang semua baris dari `from` ke `to`. Baris yang TIDAK bisa dibuka dengan `from`
 * (dibuat dengan kunci lain / rusak) tidak diubah dan dicatat di `skipped`: sudah tidak terbaca
 * sebelumnya, dan menimpanya hanya akan menghilangkan satu-satunya salinannya.
 */
export async function reencryptItems(
  rows: EncryptedRow[],
  from: CryptoKey,
  to: CryptoKey,
  userId: string,
  toRef: string,
): Promise<{ updated: EncryptedRow[]; skipped: string[] }> {
  return reencryptRows(
    rows,
    (id, enc) => decryptItem(from, userId, id, enc),
    (id, payload) => encryptItem(to, userId, id, payload, toRef),
  );
}

/** Seperti `reencryptItems`, untuk baris riwayat kode TOTP (`pw_totp_log`). */
export async function reencryptTotpLog(
  rows: EncryptedRow[],
  from: CryptoKey,
  to: CryptoKey,
  userId: string,
  toRef: string,
): Promise<{ updated: EncryptedRow[]; skipped: string[] }> {
  return reencryptRows(
    rows,
    (id, enc) => decryptTotpLog(from, userId, id, enc),
    (id, entry) => encryptTotpLog(to, userId, id, entry, toRef),
  );
}

async function reencryptRows<T>(
  rows: EncryptedRow[],
  decrypt: (id: string, enc: string) => Promise<T>,
  encrypt: (id: string, value: T) => Promise<string>,
): Promise<{ updated: EncryptedRow[]; skipped: string[] }> {
  const updated: EncryptedRow[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    let value: T;
    try {
      value = await decrypt(row.id, row.enc);
    } catch {
      skipped.push(row.id);
      continue;
    }
    updated.push({ id: row.id, enc: await encrypt(row.id, value) });
  }
  return { updated, skipped };
}

// ----------------------------------------------------------------------------- riwayat TOTP
export interface TotpLogEntry {
  /** Item Sandi asal kode ini. */
  itemId: string;
  /** Nama akun saat kode dipakai — tetap terbaca walau itemnya sudah dihapus. */
  name: string;
  /** Angka kode yang dipakai (kedaluwarsa dalam hitungan detik). */
  code: string;
  /** Waktu pemakaian (ISO). */
  usedAt: string;
}

export function parseTotpLogEntry(value: unknown): TotpLogEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SandiError('corrupt', 'Isi riwayat tidak valid.');
  const o = value as Record<string, unknown>;
  return {
    itemId: str(o.itemId),
    name: str(o.name),
    code: str(o.code),
    usedAt: str(o.usedAt),
  };
}

export async function encryptTotpLog(
  dek: CryptoKey,
  userId: string,
  rowId: string,
  entry: TotpLogEntry,
  ref: string,
): Promise<string> {
  const plain = te.encode(JSON.stringify(entry));
  return frame(ref, await seal(dek, pad(plain), aadTotpLog(userId, rowId)));
}

/** Melempar SandiError('corrupt') bila dibuat dengan kunci lain atau datanya diubah. */
export async function decryptTotpLog(
  dek: CryptoKey,
  userId: string,
  rowId: string,
  enc: string,
): Promise<TotpLogEntry> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromB64(splitEnc(enc).body);
  } catch {
    throw new SandiError('corrupt', 'Data riwayat rusak.');
  }
  const padded = await open(dek, bytes, aadTotpLog(userId, rowId));
  const plain = padded && unpad(padded);
  if (!plain) throw new SandiError('corrupt', 'Riwayat tidak bisa dibuka dengan kunci ini.');
  try {
    return parseTotpLogEntry(JSON.parse(td.decode(plain)));
  } catch (e) {
    if (e instanceof SandiError) throw e;
    throw new SandiError('corrupt', 'Isi riwayat tidak valid.');
  }
}

// ----------------------------------------------------------------------------- konfigurasi (Vault)
/**
 * Isi satu versi berkas konfigurasi. `text` adalah teks MENTAH apa adanya (komentar, urutan, dan
 * baris kosong ikut tersimpan), karena itulah yang dilihat dan ditempel pengguna.
 */
export interface ConfigPayload {
  text: string;
  /** Catatan perubahan, mis. "ganti URL Supabase". Ikut dienkripsi: bisa menyebut hal sensitif. */
  note: string;
}

export function parseConfigPayload(value: unknown): ConfigPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SandiError('corrupt', 'Isi konfigurasi tidak valid.');
  const o = value as Record<string, unknown>;
  return { text: str(o.text), note: str(o.note) };
}

/** Hasil: `<label kunci>.<base64(IV ‖ ciphertext)>` untuk kolom `config_versions.enc`. */
export async function encryptConfig(
  dek: CryptoKey,
  userId: string,
  fileId: string,
  versionId: string,
  payload: ConfigPayload,
  ref: string,
): Promise<string> {
  const plain = te.encode(JSON.stringify(payload));
  return frame(ref, await seal(dek, pad(plain), aadConfig(userId, fileId, versionId)));
}

/** Melempar SandiError('corrupt') bila dibuat dengan kunci lain, diubah, atau dipindah berkas. */
export async function decryptConfig(
  dek: CryptoKey,
  userId: string,
  fileId: string,
  versionId: string,
  enc: string,
): Promise<ConfigPayload> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromB64(splitEnc(enc).body);
  } catch {
    throw new SandiError('corrupt', 'Data konfigurasi rusak.');
  }
  const padded = await open(dek, bytes, aadConfig(userId, fileId, versionId));
  const plain = padded && unpad(padded);
  if (!plain) throw new SandiError('corrupt', 'Versi ini tidak bisa dibuka dengan kunci ini.');
  try {
    return parseConfigPayload(JSON.parse(td.decode(plain)));
  } catch (e) {
    if (e instanceof SandiError) throw e;
    throw new SandiError('corrupt', 'Isi konfigurasi tidak valid.');
  }
}

/** Baris `config_versions` untuk enkripsi ulang: AAD butuh `file_id`, jadi ikut dibawa. */
export interface EncryptedConfigRow extends EncryptedRow {
  file_id: string;
}

/**
 * Seperti `reencryptItems`, untuk versi konfigurasi. WAJIB dipanggil saat kunci brankas dirotasi;
 * tanpa itu seluruh konfigurasi tidak bisa dibuka lagi setelah ganti master password.
 */
export async function reencryptConfigVersions(
  rows: EncryptedConfigRow[],
  from: CryptoKey,
  to: CryptoKey,
  userId: string,
  toRef: string,
): Promise<{ updated: EncryptedRow[]; skipped: string[] }> {
  const byId = new Map(rows.map((r) => [r.id, r.file_id]));
  const fileOf = (id: string) => byId.get(id)!;
  return reencryptRows(
    rows,
    (id, enc) => decryptConfig(from, userId, fileOf(id), id, enc),
    (id, payload) => encryptConfig(to, userId, fileOf(id), id, payload, toRef),
  );
}
