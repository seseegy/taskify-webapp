import type { Strength } from './generator';
import { strengthFromBits } from './generator';

/**
 * Gerbang master password. Satu-satunya penghalang antara penyerang yang memegang data server /
 * file ekspor (salt + wrapped key) dan seluruh brankas, jadi penilaiannya memakai zxcvbn-ts
 * (kamus Inggris + Indonesia + pola tanggal/urutan/keyboard), bukan heuristik panjang × karakter.
 *
 * Dimuat LAZY (kamusnya ±5 MB mentah) dan GAGAL TERTUTUP: bila pemeriksa tidak bisa dimuat,
 * master password ditolak, tidak diloloskan dengan penilaian yang lebih longgar.
 */
export const MASTER_MIN_LENGTH = 12;
export const MASTER_MIN_BITS = 50;

/** zxcvbn lambat untuk masukan sangat panjang; sandi sepanjang ini sudah pasti kuat. */
const MAX_CHECKED_LENGTH = 128;

export const ENGINE_LOAD_ERROR =
  'Pemeriksa kekuatan sandi gagal dimuat. Periksa koneksi lalu coba lagi.';

/** Kata yang pasti ditebak lebih dulu pada akun ini. */
const APP_WORDS = ['taskify', 'sandi', 'katasandi', 'kata sandi', 'rahasia', 'brankas', 'master'];

type Engine = { check: (pw: string, userInputs: string[]) => EngineResult };
interface EngineResult {
  guesses: number;
  sequence: { pattern: string; token: string }[];
}

let enginePromise: Promise<void> | null = null;
let engine: Engine | null = null;

async function loadEngine(): Promise<Engine> {
  const [core, common, en, id] = await Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en'),
    import('@zxcvbn-ts/language-id'),
  ]);
  const z = new core.ZxcvbnFactory({
    translations: en.translations,
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary, ...id.dictionary, app: APP_WORDS },
  });
  return { check: (pw, userInputs) => z.check(pw, userInputs) };
}

/** Muat pemeriksa (sekali). Melempar bila gagal; panggilan berikutnya mencoba lagi. */
export function ensureStrengthEngine(): Promise<void> {
  enginePromise ??= loadEngine()
    .then((e) => {
      engine = e;
    })
    .catch((err: unknown) => {
      enginePromise = null;
      throw err;
    });
  return enginePromise;
}

/** Sudah dimuat? (untuk meter yang menunggu) */
export function isStrengthEngineReady(): boolean {
  return engine !== null;
}

/** Potongan email / nama yang tidak boleh menjadi bagian sandi. */
export function userInputsFromEmail(email: string | null | undefined): string[] {
  if (!email) return [];
  const local = email.split('@')[0] ?? '';
  return [local, ...local.split(/[^\p{L}\p{N}]+/u)].filter((s) => s.length >= 3);
}

export type MasterStrength = Strength & { issues: string[] };

/** Batas per kata BERBEDA pada frasa kata-kata (daftar 7.776 kata ≈ 12,9 bit; ada kelonggaran). */
const MAX_BITS_PER_DISTINCT_WORD = 17;

/**
 * Penilaian sinkron; WAJIB `ensureStrengthEngine()` selesai dulu (kalau belum, melempar).
 *
 * Angka `guesses` zxcvbn dipakai apa adanya. Konsekuensinya karakter acak hanya dihitung
 * ±3,3 bit/karakter (10^panjang), jadi sandi acak baru lolos di sekitar 16 karakter ke atas;
 * ini sengaja konservatif karena potongan tanpa pola tidak bisa dibedakan dari kata pribadi
 * yang tidak ada di kamus mana pun (nama anak, nama hewan). Jalur utama adalah frasa 5 kata.
 *
 * zxcvbn hanya mengenali pengulangan yang berurutan, jadi frasa kata-kata ("kopi kuda kopi kuda
 * kopi") dibatasi tambahan menurut jumlah kata yang berbeda.
 */
export function evaluateMasterPassword(
  password: string,
  userInputs: string[] = [],
): MasterStrength {
  if (!engine) throw new Error('Pemeriksa kekuatan sandi belum dimuat.');
  const pw = password.normalize('NFKC').slice(0, MAX_CHECKED_LENGTH);
  if (!pw) return { ...strengthFromBits(0), issues: [] };

  const r = engine.check(pw, userInputs);
  const chars = [...pw];
  let bits = Math.log2(Math.max(r.guesses, 1));

  const words = pw.split(/[\s\-._]+/).filter(Boolean);
  if (words.length >= 3 && words.every((w) => /^\p{L}+$/u.test(w))) {
    const distinct = new Set(words.map((w) => w.toLowerCase())).size;
    bits = Math.min(bits, distinct * MAX_BITS_PER_DISTINCT_WORD);
  }

  const patterns = new Set(r.sequence.map((m) => m.pattern));
  const issues: string[] = [];
  // Petunjuk pola hanya berguna selama sandinya belum kuat; jangan membebani yang sudah kuat.
  if (bits < 60) addPatternIssues(patterns, issues);
  if (chars.length < MASTER_MIN_LENGTH) issues.push(`Minimal ${MASTER_MIN_LENGTH} karakter.`);

  return { ...strengthFromBits(bits), issues };
}

function addPatternIssues(patterns: Set<string>, issues: string[]): void {
  if (patterns.has('dictionary'))
    issues.push('Mengandung kata atau nama yang umum dipakai (juga dengan huruf diganti angka).');
  if (patterns.has('date') || patterns.has('regex'))
    issues.push('Mengandung tahun atau tanggal. Itu mudah ditebak.');
  if (patterns.has('sequence') || patterns.has('spatial'))
    issues.push('Mengandung urutan mudah ditebak (abcd, 1234, qwer).');
  if (patterns.has('repeat')) issues.push('Mengandung pengulangan karakter.');
}

/** Saran yang selalu menyertai penolakan karena lemah: menghapus satu pola saja belum tentu cukup. */
export const MASTER_ADVICE = 'Pakai frasa 5 kata, atau sandi acak minimal 16 karakter.';

/**
 * Alasan master password ditolak, atau `null` bila boleh dipakai. Async karena memuat pemeriksa;
 * bila gagal dimuat mengembalikan `ENGINE_LOAD_ERROR` (gagal tertutup).
 *
 * Penolakan karena lemah = pola pertama yang ditemukan (bila ada) + `MASTER_ADVICE`. Sandi acak
 * pendek bisa kebetulan memuat kata umum ("love", "sun"); tanpa saran, pengguna hanya diberi tahu
 * kata itu, padahal masalah utamanya panjang sandi.
 */
export async function masterPasswordProblem(
  password: string,
  userInputs: string[] = [],
): Promise<string | null> {
  if ([...password].length < MASTER_MIN_LENGTH) return `Minimal ${MASTER_MIN_LENGTH} karakter.`;
  try {
    await ensureStrengthEngine();
  } catch {
    return ENGINE_LOAD_ERROR;
  }
  const s = evaluateMasterPassword(password, userInputs);
  if (s.bits < MASTER_MIN_BITS)
    return `${s.issues[0] ?? 'Terlalu mudah ditebak.'} ${MASTER_ADVICE}`;
  return null;
}
