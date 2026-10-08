/**
 * "Ingat perangkat ini" — membuka brankas tanpa master password selama beberapa hari.
 *
 * CARA KERJA: DEK disimpan di IndexedDB sebagai `CryptoKey` apa adanya. Spesifikasi WebCrypto
 * membuat `CryptoKey` bisa di-structured-clone, dan DEK dibuat dengan `extractable: false`
 * (lihat `importDek` di crypto.ts), sehingga browser menyimpannya sebagai objek BURAM: byte
 * kuncinya tidak pernah bisa dibaca JavaScript, tidak oleh kode ini maupun oleh XSS.
 *
 * Master password TIDAK pernah disimpan, dan tidak ada teks terang yang ditulis ke disk.
 *
 * YANG BERUBAH dari sisi keamanan: siapa pun yang bisa membuka browser di perangkat ini bisa
 * membaca brankas tanpa master password sampai kepercayaan kedaluwarsa. Penjaga sebenarnya
 * menjadi PIN aplikasi dan kunci layar perangkat. XSS juga bisa MEMAKAI kunci (walau tidak bisa
 * mencurinya) selama masa itu — risikonya berubah dari pencurian kunci menjadi pemakaian kunci.
 *
 * Kepercayaan otomatis batal bila: kedaluwarsa, record kunci brankas berubah (master password
 * atau kunci pemulihan diganti, di perangkat mana pun — karena DEK ikut dirotasi), atau akun
 * keluar.
 */

export const TRUST_DAYS = 30;

const DB_NAME = 'taskify-sandi-trust';
const STORE = 'trust';
const RECORD_KEY = 'current';

export interface TrustMeta {
  /** `pw_keys.wrapped_key` saat kepercayaan dibuat — penanda versi kunci brankas. */
  stamp: string;
  /** Epoch ms. */
  expiresAt: number;
}

interface TrustRecord extends TrustMeta {
  dek: CryptoKey;
}

export function trustExpiresAt(nowMs: number, days = TRUST_DAYS): number {
  return nowMs + days * 86400_000;
}

export type TrustState = 'ok' | 'expired' | 'stale';

/**
 * Apakah kepercayaan yang tersimpan masih boleh dipakai?
 *   expired = sudah lewat masanya
 *   stale   = kunci brankas sudah diganti/dirotasi, jadi DEK ini tidak cocok lagi
 */
export function trustState(meta: TrustMeta, currentStamp: string, nowMs: number): TrustState {
  if (nowMs >= meta.expiresAt) return 'expired';
  if (meta.stamp !== currentStamp) return 'stale';
  return 'ok';
}

/** Sisa hari (dibulatkan ke atas) untuk ditampilkan di Pengaturan. */
export function trustDaysLeft(meta: TrustMeta, nowMs: number): number {
  return Math.max(0, Math.ceil((meta.expiresAt - nowMs) / 86400_000));
}

// ----------------------------------------------------------------------------- IndexedDB
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB tidak bisa dibuka'));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = body(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB gagal'));
        tx.oncomplete = () => db.close();
      }),
  );
}

/**
 * Mulai memercayai perangkat ini. `stamp` harus `pw_keys.wrapped_key` yang sedang berlaku.
 * Gagal (mode privat, penyimpanan diblokir) tidak dianggap fatal: pengguna hanya akan diminta
 * master password lagi nanti.
 */
export async function rememberDevice(
  dek: CryptoKey,
  stamp: string,
  nowMs = Date.now(),
): Promise<boolean> {
  try {
    const record: TrustRecord = { dek, stamp, expiresAt: trustExpiresAt(nowMs) };
    await run('readwrite', (s) => s.put(record, RECORD_KEY));
    return true;
  } catch {
    return false;
  }
}

/** Buang kepercayaan perangkat ini. Aman dipanggil walau tidak ada apa-apa. */
export async function forgetDevice(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(RECORD_KEY));
  } catch {
    /* tidak ada yang bisa dilakukan; kepercayaan akan kedaluwarsa sendiri */
  }
}

async function readRecord(): Promise<TrustRecord | null> {
  try {
    const raw = await run<TrustRecord | undefined>('readonly', (s) => s.get(RECORD_KEY));
    if (!raw || typeof raw.stamp !== 'string' || typeof raw.expiresAt !== 'number') return null;
    // `dek` harus benar-benar CryptoKey (data lama/rusak diabaikan)
    return raw.dek instanceof CryptoKey ? raw : null;
  } catch {
    return null;
  }
}

/** Info kepercayaan untuk ditampilkan di Pengaturan (tanpa menyentuh kuncinya). */
export async function readTrustMeta(): Promise<TrustMeta | null> {
  const rec = await readRecord();
  return rec ? { stamp: rec.stamp, expiresAt: rec.expiresAt } : null;
}

/**
 * DEK yang dipercaya untuk perangkat ini, atau `null` bila tidak ada / tidak berlaku lagi.
 * Record yang kedaluwarsa atau basi langsung dibuang.
 */
export async function loadTrustedDek(
  currentStamp: string,
  nowMs = Date.now(),
): Promise<CryptoKey | null> {
  const rec = await readRecord();
  if (!rec) return null;
  if (trustState(rec, currentStamp, nowMs) !== 'ok') {
    await forgetDevice();
    return null;
  }
  return rec.dek;
}
