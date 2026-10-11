import { describe, expect, it } from 'vitest';
import {
  CONFIG_MAX_BYTES,
  configSizeProblem,
  diffEntries,
  guessFormat,
  hasBlockingProblem,
  isEmptyDiff,
  lineColAt,
  parseConfig,
  parseEnv,
  parseJson,
  summarizeDiff,
} from './config-parse';

const pairs = (text: string) =>
  Object.fromEntries(parseEnv(text).entries.map((e) => [e.key, e.value]));

describe('parseEnv', () => {
  it('membaca pasangan kunci-nilai, melewati komentar dan baris kosong', () => {
    const { entries, problems } = parseEnv(
      ['# komentar', '', 'API_URL=https://api.example.com', 'DEBUG=1', ''].join('\n'),
    );
    expect(entries.map((e) => [e.key, e.value, e.line])).toEqual([
      ['API_URL', 'https://api.example.com', 3],
      ['DEBUG', '1', 4],
    ]);
    expect(problems).toEqual([]);
  });

  it('menerima `export`, spasi di sekitar =, dan nilai kosong', () => {
    expect(pairs(['export TOKEN=abc', 'EMPTY=', 'SPACED = x'].join('\n'))).toEqual({
      TOKEN: 'abc',
      EMPTY: '',
      SPACED: 'x',
    });
  });

  it('melepas kutip, dan `#` di dalam kutip TETAP bagian nilai (sandi p#ss)', () => {
    expect(pairs(['A="satu dua"', "B='p#ss'", 'C=nilai # komentar', 'D=a#b'].join('\n'))).toEqual({
      A: 'satu dua',
      B: 'p#ss',
      C: 'nilai',
      // tanpa spasi sebelum # → bukan komentar (mis. fragmen URL)
      D: 'a#b',
    });
  });

  it('nilai berkutip boleh membentang beberapa baris (kunci privat)', () => {
    const { entries, problems } = parseEnv(
      ['KEY="-----BEGIN-----', 'baris2', '-----END-----"', 'AFTER=1'].join('\n'),
    );
    expect(entries.map((e) => e.key)).toEqual(['KEY', 'AFTER']);
    expect(entries[0]!.value).toBe('-----BEGIN-----\nbaris2\n-----END-----');
    expect(problems).toEqual([]);
  });

  it('kutip yang tidak ditutup adalah error yang memblokir simpan', () => {
    const { problems } = parseEnv('KEY="tidak ditutup\nLAIN=1');
    expect(hasBlockingProblem(problems)).toBe(true);
    expect(problems[0]!.message).toMatch(/tidak pernah ditutup/);
    expect(problems[0]!.line).toBe(1);
  });

  it('kunci dobel: peringatan (bukan error) dan yang TERAKHIR yang berlaku', () => {
    const { entries, problems } = parseEnv('A=satu\nB=x\nA=dua');
    expect(pairs('A=satu\nB=x\nA=dua')).toEqual({ A: 'dua', B: 'x' });
    expect(entries).toHaveLength(2);
    expect(hasBlockingProblem(problems)).toBe(false);
    expect(problems[0]!.message).toMatch(/baris 1/);
    expect(problems[0]!.line).toBe(3);
  });

  it('baris tanpa `=` diperingatkan beserta nomor barisnya, tidak menggagalkan', () => {
    const { entries, problems } = parseEnv('A=1\nbaris ngawur\nB=2');
    expect(entries).toHaveLength(2);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.line).toBe(2);
    expect(hasBlockingProblem(problems)).toBe(false);
  });

  it('teks kosong → tidak ada entri dan tidak ada masalah', () => {
    expect(parseEnv('')).toEqual({ entries: [], problems: [] });
  });

  it('CRLF (berkas dari Windows) ditangani', () => {
    expect(pairs('A=1\r\nB=2')).toEqual({ A: '1', B: '2' });
  });
});

describe('parseJson', () => {
  it('meratakan objek bersarang dan array menjadi path', () => {
    const { entries } = parseJson('{"db":{"pool":{"max":10}},"hosts":["a","b"],"on":true}');
    expect(Object.fromEntries(entries.map((e) => [e.key, e.value]))).toEqual({
      'db.pool.max': '10',
      'hosts.0': 'a',
      'hosts.1': 'b',
      on: 'true',
    });
  });

  it('null, objek kosong, dan array kosong tetap muncul sebagai entri', () => {
    const { entries } = parseJson('{"a":null,"b":{},"c":[]}');
    expect(Object.fromEntries(entries.map((e) => [e.key, e.value]))).toEqual({
      a: 'null',
      b: '{}',
      c: '[]',
    });
  });

  it('JSON tidak valid → error dengan baris & kolom', () => {
    const { entries, problems } = parseJson('{\n  "a": 1,\n}');
    expect(entries).toEqual([]);
    expect(hasBlockingProblem(problems)).toBe(true);
    expect(problems[0]!.message).toMatch(/baris 3/);
    expect(problems[0]!.line).toBe(3);
  });

  it('JSON valid tetapi bukan objek → peringatan, bukan error', () => {
    const { problems } = parseJson('[1,2,3]');
    expect(hasBlockingProblem(problems)).toBe(false);
    expect(problems[0]!.message).toMatch(/bukan objek/);
  });

  it('teks kosong → bersih (berkas baru belum diisi)', () => {
    expect(parseJson('   ')).toEqual({ entries: [], problems: [] });
  });
});

describe('lineColAt', () => {
  it('menghitung baris & kolom 1-based, dan aman di luar rentang', () => {
    expect(lineColAt('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    expect(lineColAt('ab', 999)).toEqual({ line: 1, column: 3 });
    expect(lineColAt('ab', -5)).toEqual({ line: 1, column: 1 });
  });
});

describe('guessFormat', () => {
  it('dari nama berkas, lalu dari isi', () => {
    expect(guessFormat('wrangler.json')).toBe('json');
    expect(guessFormat('.env')).toBe('env');
    expect(guessFormat('.env.production')).toBe('env');
    expect(guessFormat('config')).toBe('env');
    expect(guessFormat('config', '{ "a": 1 }')).toBe('json');
  });
});

describe('diffEntries', () => {
  const from = parseEnv('A=1\nB=2\nC=3').entries;
  const to = parseEnv('A=1\nB=9\nD=4').entries;

  it('mengelompokkan ditambah / diubah / dihapus / sama', () => {
    const d = diffEntries(from, to);
    expect(d.added.map((e) => e.key)).toEqual(['D']);
    expect(d.removed.map((e) => e.key)).toEqual(['C']);
    expect(d.changed).toEqual([{ key: 'B', from: '2', to: '9' }]);
    expect(d.same.map((e) => e.key)).toEqual(['A']);
  });

  it('memindahkan baris atau mengubah komentar BUKAN perubahan (dibanding per kunci)', () => {
    const a = parseEnv('A=1\nB=2').entries;
    const b = parseEnv('# catatan baru\nB=2\nA=1').entries;
    expect(isEmptyDiff(diffEntries(a, b))).toBe(true);
  });

  it('ringkasan untuk label, dan null bila tidak ada perubahan', () => {
    expect(summarizeDiff(diffEntries(from, to))).toBe('+1 · 1 berubah · −1');
    expect(summarizeDiff(diffEntries(from, from))).toBeNull();
    expect(summarizeDiff(diffEntries([], to))).toBe('+3');
  });

  it('bisa membandingkan dua LINGKUNGAN: kunci yang belum ada di staging', () => {
    const prod = parseEnv('API_URL=a\nREDIS_URL=b\nDEBUG=0').entries;
    const staging = parseEnv('API_URL=c\nDEBUG=0').entries;
    const d = diffEntries(prod, staging);
    expect(d.removed.map((e) => e.key)).toEqual(['REDIS_URL']); // ada di prod, belum di staging
    expect(d.changed.map((c) => c.key)).toEqual(['API_URL']);
  });

  it('lintas format: path JSON dibandingkan seperti kunci biasa', () => {
    const a = parseJson('{"db":{"max":1}}').entries;
    const b = parseJson('{"db":{"max":2}}').entries;
    expect(diffEntries(a, b).changed).toEqual([{ key: 'db.max', from: '1', to: '2' }]);
  });
});

describe('batas ukuran', () => {
  it('diukur dalam byte UTF-8, bukan jumlah karakter', () => {
    // 'é' = 2 byte: 200 ribu karakter = 400 ribu byte → melebihi batas walau karakternya < 256 ribu
    const text = 'é'.repeat(200_000);
    expect(text.length).toBeLessThan(CONFIG_MAX_BYTES);
    const p = configSizeProblem(text);
    expect(p?.level).toBe('error');
    expect(p?.message).toMatch(/melebihi batas/);
  });

  it('tepat di batas diterima, satu byte di atasnya ditolak', () => {
    expect(configSizeProblem('x'.repeat(CONFIG_MAX_BYTES))).toBeNull();
    expect(configSizeProblem('x'.repeat(CONFIG_MAX_BYTES + 1))?.level).toBe('error');
  });
});

describe('parseConfig', () => {
  it('memilih parser sesuai format', () => {
    expect(parseConfig('{"a":1}', 'json').entries[0]).toMatchObject({ key: 'a', value: '1' });
    expect(parseConfig('A=1', 'env').entries[0]).toMatchObject({ key: 'A', value: '1' });
  });
});
