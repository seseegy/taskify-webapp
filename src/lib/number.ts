const formatters = new Map<number, Intl.NumberFormat>();

/**
 * Angka desimal berlokal Indonesia: 3.5 → "3,5". Jangan pakai `toFixed()` untuk teks tampilan
 * (hasilnya memakai titik dan tidak mengikuti locale). `toFixed` tetap dipakai untuk koordinat SVG.
 */
export function formatDecimal(value: number, maxFractionDigits = 1): string {
  let f = formatters.get(maxFractionDigits);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: maxFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    });
    formatters.set(maxFractionDigits, f);
  }
  return f.format(value);
}
