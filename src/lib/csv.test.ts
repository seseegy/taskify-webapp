import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

const lines = (csv: string) => csv.split('\r\n');

describe('toCsv', () => {
  it('format dasar: pemisah ;, kutip untuk sel berpemisah/kutip/baris baru', () => {
    expect(
      lines(
        toCsv(
          ['a', 'b'],
          [
            ['x;y', 'baris\nbaru'],
            ['"q"', null],
          ],
        ),
      ),
    ).toEqual(['a;b', '"x;y";"baris\nbaru"', '"""q""";']);
  });

  it('angka (termasuk negatif) dibiarkan sebagai angka', () => {
    expect(lines(toCsv(['n'], [[-25000], [1500000]]))[1]).toBe('-25000');
    expect(lines(toCsv(['n'], [[-25000], [1500000]]))[2]).toBe('1500000');
  });

  it('teks yang diawali = + - @ (formula spreadsheet) dinetralkan', () => {
    const out = lines(
      toCsv(
        ['t'],
        [
          ['=1+1'],
          ['+1+1'],
          ['-2+3'],
          ['@SUM(A1)'],
          ['\t=cmd'],
          ['=HYPERLINK("http://x.test","klik")'],
        ],
      ),
    ).slice(1);
    expect(out).toEqual([
      "'=1+1",
      "'+1+1",
      "'-2+3",
      "'@SUM(A1)",
      "'\t=cmd",
      '"\'=HYPERLINK(""http://x.test"",""klik"")"',
    ]);
    for (const cell of out) expect(cell.replace(/^"/, '')).toMatch(/^'/);
  });

  it('teks berupa angka bertanda tidak diberi awalan (mis. "-5000" dari input pengguna)', () => {
    // "+12,5" tetap dikutip karena memuat koma, tetapi tanpa awalan '
    expect(lines(toCsv(['t'], [['-5000'], ['+12,5']]))).toEqual(['t', '-5000', '"+12,5"']);
  });

  it('teks biasa tidak diubah', () => {
    expect(lines(toCsv(['t'], [['makan siang'], ['a-b'], ['x=y']])).slice(1)).toEqual([
      'makan siang',
      'a-b',
      'x=y',
    ]);
  });
});
