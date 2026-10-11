/**
 * Parser & pembanding berkas konfigurasi (.env / JSON) — MURNI, tanpa DOM/database/crypto.
 *
 * Prinsip: **teks mentah adalah sumber kebenaran.** Parser ini TIDAK pernah dipakai untuk menulis
 * ulang berkas; hasilnya hanya untuk (1) menampilkan nilai per kunci agar bisa disembunyikan satu
 * per satu, (2) memvalidasi, dan (3) membandingkan versi. Dengan begitu komentar, urutan, dan
 * baris kosong milik pengguna tidak pernah hilang.
 */

export type ConfigFormat = 'env' | 'json';

export interface ConfigEntry {
  /** Nama kunci (`.env`) atau path (`db.pool.max` untuk JSON). */
  key: string;
  value: string;
  /** Baris pertama (1-based) tempat kunci ini muncul; 0 bila tidak diketahui. */
  line: number;
}

export type ProblemLevel = 'error' | 'warning';

export interface ConfigProblem {
  level: ProblemLevel;
  message: string;
  /** 1-based; 0 = tidak terkait baris tertentu. */
  line: number;
  column?: number;
}

export interface ParsedConfig {
  entries: ConfigEntry[];
  problems: ConfigProblem[];
}

/** `error` memblokir simpan; `warning` tidak. */
export const hasBlockingProblem = (p: ConfigProblem[]) => p.some((x) => x.level === 'error');

/**
 * Batas isi satu versi. Ditegakkan di klien karena CHECK Postgres berlaku pada CIPHERTEXT
 * (`config_versions.enc`), yang lebih panjang setelah padding + base64 — pesan 23514 dari server
 * tidak bisa menyebut batas yang dimengerti pengguna. Diukur dalam byte UTF-8 (bukan karakter),
 * karena itulah yang menentukan panjang ciphertext.
 */
export const CONFIG_MAX_BYTES = 256 * 1024;

export const configByteLength = (text: string) => new TextEncoder().encode(text).length;

/** `null` bila ukurannya masih aman. */
export function configSizeProblem(text: string): ConfigProblem | null {
  const bytes = configByteLength(text);
  if (bytes <= CONFIG_MAX_BYTES) return null;
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  return {
    level: 'error',
    message: `Isi ${kb(bytes)} melebihi batas ${kb(CONFIG_MAX_BYTES)} per versi.`,
    line: 0,
  };
}

// ----------------------------------------------------------------------------- .env
/** `KEY=...`, dengan `export ` opsional. Kunci gaya shell: huruf/angka/garis bawah/titik. */
const ENV_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=(.*)$/;

/**
 * Buang komentar di akhir nilai TANPA kutip. Nilai berkutip tidak disentuh, karena `#` di
 * dalamnya adalah bagian dari nilai (mis. sandi `p#ss`).
 */
function stripInlineComment(raw: string): string {
  const at = raw.search(/\s#/);
  return (at >= 0 ? raw.slice(0, at) : raw).trim();
}

/**
 * Nilai berkutip bisa membentang beberapa baris (kunci privat, sertifikat). Mengembalikan nilai
 * beserta indeks baris terakhir yang ikut terpakai.
 */
function readQuoted(
  lines: string[],
  start: number,
  firstChunk: string,
  quote: string,
): { value: string; endLine: number; unterminated: boolean } {
  // Kutip penutup di baris yang sama?
  const closeAt = firstChunk.indexOf(quote, 1);
  if (closeAt >= 0)
    return { value: firstChunk.slice(1, closeAt), endLine: start, unterminated: false };

  const parts = [firstChunk.slice(1)];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const at = line.indexOf(quote);
    if (at >= 0) {
      parts.push(line.slice(0, at));
      return { value: parts.join('\n'), endLine: i, unterminated: false };
    }
    parts.push(line);
  }
  return { value: parts.join('\n'), endLine: lines.length - 1, unterminated: true };
}

export function parseEnv(text: string): ParsedConfig {
  const lines = text.split(/\r?\n/);
  const entries: ConfigEntry[] = [];
  const problems: ConfigProblem[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const m = ENV_LINE.exec(trimmed);
    if (!m) {
      problems.push({
        level: 'warning',
        message: 'Baris ini bukan `KUNCI=nilai` dan akan diabaikan pembaca .env.',
        line: i + 1,
      });
      continue;
    }

    const key = m[1]!;
    const rest = m[2]!.trim();
    let value: string;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const q = readQuoted(lines, i, rest, rest[0]!);
      value = q.value;
      if (q.unterminated)
        problems.push({
          level: 'error',
          message: `Kutip pembuka pada \`${key}\` tidak pernah ditutup.`,
          line: i + 1,
        });
      i = q.endLine;
    } else {
      value = stripInlineComment(rest);
    }

    const before = seen.get(key);
    if (before !== undefined)
      problems.push({
        level: 'warning',
        message: `\`${key}\` muncul lagi (sudah ada di baris ${before}). Pembaca .env memakai yang terakhir.`,
        line: i + 1,
      });
    seen.set(key, i + 1);
    entries.push({ key, value, line: i + 1 });
  }

  // Kunci dobel: simpan hanya yang TERAKHIR, karena itu yang berlaku saat dibaca
  const lastByKey = new Map<string, ConfigEntry>();
  for (const e of entries) lastByKey.set(e.key, e);
  return { entries: [...lastByKey.values()], problems };
}

// ----------------------------------------------------------------------------- JSON
/** Posisi karakter → baris & kolom (1-based), untuk pesan error yang bisa ditindaklanjuti. */
export function lineColAt(text: string, position: number): { line: number; column: number } {
  const upto = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const lines = upto.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1] ?? '').length + 1 };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Objek bersarang → satu entri per path (`db.pool.max`, `hosts.0`). Nilai dasar jadi teks. */
function flatten(value: unknown, prefix: string, out: ConfigEntry[]): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out.push({ key: prefix, value: '{}', line: 0 });
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0 && prefix) out.push({ key: prefix, value: '[]', line: 0 });
    value.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
    return;
  }
  out.push({ key: prefix, value: value === null ? 'null' : String(value), line: 0 });
}

export function parseJson(text: string): ParsedConfig {
  if (text.trim() === '') return { entries: [], problems: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'JSON tidak valid.';
    // Pesan V8: "… in JSON at position 42"; hitung baris/kolom sendiri agar tidak tergantung engine
    const at = /position (\d+)/.exec(message);
    const where = at ? lineColAt(text, Number(at[1])) : null;
    return {
      entries: [],
      problems: [
        {
          level: 'error',
          message: where
            ? `JSON tidak valid di baris ${where.line}, kolom ${where.column}.`
            : 'JSON tidak valid.',
          line: where?.line ?? 0,
          column: where?.column,
        },
      ],
    };
  }

  if (!isPlainObject(parsed))
    return {
      entries: [],
      problems: [
        {
          level: 'warning',
          message: 'JSON ini bukan objek, jadi tidak ada kunci yang bisa dibandingkan.',
          line: 1,
        },
      ],
    };

  const entries: ConfigEntry[] = [];
  flatten(parsed, '', entries);
  return { entries, problems: [] };
}

export function parseConfig(text: string, format: ConfigFormat): ParsedConfig {
  return format === 'json' ? parseJson(text) : parseEnv(text);
}

/** Tebak format dari nama berkas, lalu dari isinya. Dipakai sebagai USULAN, bisa diganti. */
export function guessFormat(name: string, text = ''): ConfigFormat {
  if (/\.json$/i.test(name.trim())) return 'json';
  if (/(^|\/|\.)env(\.|$)/i.test(name.trim())) return 'env';
  return text.trim().startsWith('{') ? 'json' : 'env';
}

// ----------------------------------------------------------------------------- perbandingan
export interface ConfigDiff {
  added: ConfigEntry[];
  removed: ConfigEntry[];
  /** Kunci yang ada di keduanya tetapi nilainya berbeda. */
  changed: { key: string; from: string; to: string }[];
  same: ConfigEntry[];
}

/**
 * Bandingkan PER KUNCI, bukan per baris: memindahkan satu baris atau mengubah komentar tidak
 * dihitung sebagai perubahan. Inilah yang membuat "kunci apa yang belum ada di staging?" bisa
 * dijawab, termasuk saat membandingkan dua berkas yang berbeda.
 */
export function diffEntries(from: ConfigEntry[], to: ConfigEntry[]): ConfigDiff {
  const before = new Map(from.map((e) => [e.key, e]));
  const after = new Map(to.map((e) => [e.key, e]));
  const diff: ConfigDiff = { added: [], removed: [], changed: [], same: [] };

  for (const e of to) {
    const old = before.get(e.key);
    if (!old) diff.added.push(e);
    else if (old.value !== e.value) diff.changed.push({ key: e.key, from: old.value, to: e.value });
    else diff.same.push(e);
  }
  for (const e of from) if (!after.has(e.key)) diff.removed.push(e);
  return diff;
}

export const isEmptyDiff = (d: ConfigDiff) =>
  d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;

/** Ringkasan untuk label: "+2 · 1 berubah · −1". `null` bila tidak ada perubahan. */
export function summarizeDiff(d: ConfigDiff): string | null {
  if (isEmptyDiff(d)) return null;
  const parts: string[] = [];
  if (d.added.length) parts.push(`+${d.added.length}`);
  if (d.changed.length) parts.push(`${d.changed.length} berubah`);
  if (d.removed.length) parts.push(`−${d.removed.length}`);
  return parts.join(' · ');
}
