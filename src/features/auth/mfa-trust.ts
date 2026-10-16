/**
 * "Ingat perangkat ini selama 30 hari" untuk verifikasi dua langkah.
 *
 * APA YANG SEBENARNYA DIINGAT: sesi Supabase yang sudah aal2 tetap aal2 selama sesinya hidup
 * (refresh token mempertahankan level). Jadi tanpa fitur ini pun, kode hanya diminta saat login.
 * Fitur ini menambah PILIHAN di atasnya:
 *   - dicentang (bawaan)  → perangkat dipercaya 30 hari: aplikasi dibuka tanpa kode. Setelah
 *                           30 hari, kode diminta sekali lagi saat aplikasi dibuka.
 *   - tidak dicentang     → kode diminta lagi SETIAP kali aplikasi dibuka (perangkat bersama).
 *
 * BATAS YANG TIDAK BISA DILEWATI: login baru dengan password (setelah Keluar, sesi kedaluwarsa,
 * atau "Lupa PIN") selalu menghasilkan sesi aal1 dari server, dan server (RLS, PowerSync, Edge
 * Function) menolak aal1. Kepercayaan perangkat tidak bisa menggantikan kode di situ — kalau
 * bisa, password saja kembali cukup untuk membobol akun dari perangkat ini.
 *
 * Konfirmasi ulang untuk sesi yang sudah aal2 ("reverify") adalah kunci di sisi aplikasi, setara
 * PIN: server sudah menerima sesi ini. Karena itu, saat offline aplikasi tidak memblokir (kode
 * tidak bisa diperiksa tanpa internet); konfirmasi diminta pada pembukaan berikutnya yang online.
 */
import type { MfaStatus } from './mfa';

export const TRUST_DAYS = 30;
const TRUST_KEY = 'taskify-mfa-trust';

/** Status gerbang: status MFA server + konfirmasi ulang perangkat (lihat atas). */
export type GateStatus = MfaStatus | 'reverify';

export interface DeviceTrust {
  userId: string;
  /** Epoch ms */
  until: number;
}

export function readTrust(): DeviceTrust | null {
  try {
    const v = JSON.parse(localStorage.getItem(TRUST_KEY) ?? 'null') as Partial<DeviceTrust> | null;
    return v && typeof v.userId === 'string' && typeof v.until === 'number'
      ? { userId: v.userId, until: v.until }
      : null;
  } catch {
    return null;
  }
}

function writeTrust(trust: DeviceTrust | null) {
  try {
    if (trust) localStorage.setItem(TRUST_KEY, JSON.stringify(trust));
    else localStorage.removeItem(TRUST_KEY);
  } catch {
    /* penyimpanan diblokir: perangkat tidak diingat, kode diminta tiap aplikasi dibuka */
  }
}

/** "Lupakan perangkat ini" & saat Keluar. */
export const clearTrust = () => writeTrust(null);

export const trustValid = (trust: DeviceTrust | null, userId: string, now: number) =>
  trust !== null && trust.userId === userId && now < trust.until;

/**
 * Status gerbang, MURNI.
 * `launchUser` = user yang sudah lolos gerbang sejak aplikasi dibuka (halaman dimuat): sekali
 * lolos, tidak dikunci lagi di tengah pemakaian walau masa 30 hari habis saat itu.
 */
export function gateStatus(
  mfa: MfaStatus,
  userId: string,
  ctx: { now: number; online: boolean; trust: DeviceTrust | null; launchUser: string | null },
): GateStatus {
  if (mfa !== 'ok') return mfa;
  if (ctx.launchUser === userId) return 'ok';
  if (trustValid(ctx.trust, userId, ctx.now)) return 'ok';
  return ctx.online ? 'reverify' : 'ok';
}

// ----------------------------------------------------------------------------- keadaan sesi halaman
let launchUser: string | null = null;
/** Pilihan centang yang menunggu verifikasi berikutnya; null = jangan ubah kepercayaan. */
let pendingRemember: boolean | null = null;

/** Dipanggil layar kode SEBELUM verifikasi: pilihan "Ingat perangkat ini" (null = batalkan). */
export function setRememberChoice(remember: boolean | null) {
  pendingRemember = remember;
}

/**
 * Dipanggil AuthProvider pada event MFA_CHALLENGE_VERIFIED (kode baru saja benar).
 * Verifikasi dari Pengaturan (tambah authenticator cadangan) tidak menyetel pilihan, jadi
 * kepercayaan perangkat tidak berubah.
 */
export function recordVerification(userId: string, now = Date.now()) {
  launchUser = userId;
  if (pendingRemember === null) return;
  writeTrust(pendingRemember ? { userId, until: now + TRUST_DAYS * 86400_000 } : null);
  pendingRemember = null;
}

/** Gerbang saat ini untuk sesi ini (membaca penyimpanan & status online). */
export function resolveGate(mfa: MfaStatus, userId: string): GateStatus {
  const status = gateStatus(mfa, userId, {
    now: Date.now(),
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    trust: readTrust(),
    launchUser,
  });
  if (status === 'ok') launchUser = userId;
  return status;
}

/** Lewati konfirmasi ulang untuk pembukaan ini (kode tidak bisa diperiksa: tidak ada internet). */
export function skipReverifyOffline(userId: string) {
  launchUser = userId;
}

/** Hanya untuk tes. */
export function resetTrustStateForTests() {
  launchUser = null;
  pendingRemember = null;
}
