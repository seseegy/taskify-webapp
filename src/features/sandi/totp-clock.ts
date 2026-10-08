/**
 * Koreksi jam untuk kode TOTP.
 *
 * TOTP sepenuhnya bergantung pada jam. Jam perangkat yang bergeser beberapa menit membuat SEMUA
 * kode ditolak, dan itu penyebab bingung yang paling sering pada authenticator. Di sini selisih
 * terhadap jam server diukur sekali lalu dipakai terus.
 *
 * Header `Date` hanya beresolusi 1 detik, jadi ketelitiannya ±1 detik. Itu jauh di dalam
 * toleransi periode 30 detik.
 */

const STORAGE_KEY = 'taskify-sandi-clock-offset';

/** Di atas ini kemungkinan besar kode akan ditolak server; pengguna perlu diberi tahu. */
export const SKEW_WARN_MS = 10_000;

/** Selisih yang mustahil benar (jam salah tahun, dsb.) — jangan dipakai. */
const MAX_PLAUSIBLE_OFFSET_MS = 86_400_000;

export interface ClockSample {
  /** Waktu server dari header `Date` (ms). */
  serverMs: number;
  /** `Date.now()` sebelum permintaan dikirim. */
  sentAtMs: number;
  /** `Date.now()` setelah jawaban diterima. */
  receivedAtMs: number;
}

/**
 * Selisih (server − perangkat) dengan kompensasi separuh waktu pulang-pergi.
 * `null` = sampel tidak masuk akal dan harus diabaikan.
 */
export function offsetFromSample({ serverMs, sentAtMs, receivedAtMs }: ClockSample): number | null {
  if (!Number.isFinite(serverMs) || receivedAtMs < sentAtMs) return null;
  const localAtServerInstant = (sentAtMs + receivedAtMs) / 2;
  const offset = serverMs - localAtServerInstant;
  if (Math.abs(offset) > MAX_PLAUSIBLE_OFFSET_MS) return null;
  return Math.round(offset);
}

let offsetMs = readStoredOffset();

function readStoredOffset(): number {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(raw) && Math.abs(raw) <= MAX_PLAUSIBLE_OFFSET_MS ? raw : 0;
  } catch {
    return 0;
  }
}

export function getClockOffset(): number {
  return offsetMs;
}

export function setClockOffset(value: number): void {
  offsetMs = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* penyimpanan diblokir: tetap berlaku untuk sesi ini */
  }
}

/** Waktu yang sudah dikoreksi — INI yang dipakai menghitung kode. */
export function totpNow(): number {
  return Date.now() + offsetMs;
}

/** Jam perangkat cukup jauh dari server sehingga kode berisiko ditolak? */
export function isClockSkewed(offset = offsetMs): boolean {
  return Math.abs(offset) >= SKEW_WARN_MS;
}

/**
 * Ukur selisih jam dari header `Date` sebuah respons server. Gagal (offline, CORS, header tidak
 * ada) → `null` dan selisih lama tetap dipakai; kode tetap bisa dibuat.
 */
export async function syncClockOffset(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const sentAtMs = Date.now();
    const res = await fetchImpl(endpoint, { method: 'HEAD', cache: 'no-store' });
    const receivedAtMs = Date.now();
    const header = res.headers.get('date');
    if (!header) return null;

    const offset = offsetFromSample({ serverMs: Date.parse(header), sentAtMs, receivedAtMs });
    if (offset === null) return null;
    setClockOffset(offset);
    return offset;
  } catch {
    return null;
  }
}
