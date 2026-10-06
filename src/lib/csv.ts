/**
 * Ekspor CSV ramah Excel versi Indonesia:
 *  - pemisah ';' (Excel locale id-ID memakai koma sebagai desimal)
 *  - BOM UTF-8 agar huruf non-ASCII tampil benar
 */
export type CsvCell = string | number | null | undefined;

export function toCsv(header: string[], rows: CsvCell[][], separator = ';'): string {
  const escape = (value: CsvCell) => {
    if (value === null || value === undefined) return '';
    const s = String(value);
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
