/**
 * Uang disimpan sebagai INTEGER dalam satuan terkecil mata uang.
 * Untuk IDR satuannya rupiah utuh (tanpa sen), jadi Rp25.000 → 25000.
 * Jangan pernah memakai float untuk nilai uang.
 */

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const compactFormatter = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 25000 → "Rp 25.000" */
export function formatIDR(amount: number): string {
  return idrFormatter.format(amount);
}

/** 1500000 → "1,5 jt" (untuk grafik & ringkasan sempit) */
export function formatIDRCompact(amount: number): string {
  return compactFormatter.format(amount);
}

const SUFFIX: Record<string, number> = {
  rb: 1_000,
  ribu: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
  m: 1_000_000,
  mil: 1_000_000_000,
  miliar: 1_000_000_000,
};

/**
 * Parse input bebas ala orang Indonesia → integer rupiah, atau null jika tidak valid.
 *   "25000" | "25.000" | "Rp 25.000" | "25rb" | "25k" | "1,5jt" | "1.5 juta" → angka
 */
export function parseIDR(input: string): number | null {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/^rp\.?\s*/, '');
  const match = raw.match(/^([\d.,\s]+)\s*([a-z]*)$/);
  if (!match) return null;

  const [, numPart = '', suffix = ''] = match;
  const multiplier = suffix ? SUFFIX[suffix] : 1;
  if (multiplier === undefined) return null;

  let normalized = numPart.replace(/\s/g, '');
  if (multiplier === 1) {
    // Tanpa sufiks: titik/koma dianggap pemisah ribuan ("25.000" = 25000)
    normalized = normalized.replace(/[.,]/g, '');
  } else {
    // Dengan sufiks: koma/titik terakhir adalah desimal ("1,5jt" = 1.5 juta)
    normalized = normalized.replace(',', '.');
    const lastDot = normalized.lastIndexOf('.');
    if (lastDot !== -1) {
      normalized =
        normalized.slice(0, lastDot).replace(/\./g, '') + '.' + normalized.slice(lastDot + 1);
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * multiplier);
}

/**
 * True jika input tampak sedang diketik menuju format valid, mis. "25r" (→ "25rb") atau
 * "1,5ju" (→ "1,5juta"). Dipakai agar error tidak berkedip/diumumkan di tengah mengetik.
 */
export function isIncompleteIDR(input: string): boolean {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/^rp\.?\s*/, '');
  const match = raw.match(/^[\d.,\s]*\d[\d.,\s]*\s*([a-z]+)$/);
  if (!match) return false;
  const typed = match[1]!;
  return Object.keys(SUFFIX).some((s) => s !== typed && s.startsWith(typed));
}
