/**
 * Ekspor CSV ramah Excel versi Indonesia:
 *  - pemisah ';' (Excel locale id-ID memakai koma sebagai desimal)
 *  - BOM UTF-8 agar huruf non-ASCII tampil benar
 */
export type CsvCell = string | number | null | undefined;

/**
 * Teks yang diawali = + - @ (atau tab/CR) dieksekusi sebagai FORMULA oleh Excel/Sheets
 * ("CSV injection"), mis. judul transaksi `=HYPERLINK(...)` dari teks yang dibagikan aplikasi lain.
 * Penawarnya: awali dengan tanda kutip tunggal agar dibaca sebagai teks. Angka bertanda
 * (`-5000`) tidak diubah supaya tetap terbaca sebagai angka.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

export function toCsv(header: string[], rows: CsvCell[][], separator = ';'): string {
  const escape = (value: CsvCell) => {
    if (value === null || value === undefined) return '';
    let s = String(value);
    // Nominal bertipe number (termasuk negatif) tidak pernah dianggap formula
    if (typeof value === 'string' && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
    return /["\n\r;,]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(escape).join(separator)).join('\r\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
