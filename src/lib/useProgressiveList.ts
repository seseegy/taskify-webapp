import { useCallback, useState } from 'react';

/**
 * Render daftar panjang secara bertahap: `initial` item dulu, lalu `step` item lagi setiap kali
 * penanda di bawah daftar mendekati layar. Membuka Jurnal dengan 365 entri dulu merender semuanya
 * sekaligus (±400–500 ms satu tugas panjang dengan CPU 4× lebih lambat) padahal yang terlihat ±8.
 *
 * Batas kembali ke `initial` setiap `resetKey` berubah (mis. kata pencarian / filter).
 * Pasang `watchEnd` (callback ref) pada elemen kosong setelah daftar; render elemen itu hanya bila `hasMore`.
 */
export function useProgressiveLimit(total: number, resetKey: unknown, initial = 40, step = 80) {
  const [limit, setLimit] = useState(initial);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    // Menyesuaikan state saat props berubah, langsung saat render (tanpa efek)
    setLastKey(resetKey);
    setLimit(initial);
  }

  // Callback ref dengan fungsi pembersih (React 19): observer dilepas saat elemen dilepas
  const watchEnd = useCallback(
    (el: HTMLElement | null) => {
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + step);
        },
        { rootMargin: '600px 0px' },
      );
      io.observe(el);
      return () => io.disconnect();
    },
    [step],
  );

  return { limit, hasMore: total > limit, watchEnd };
}

/** Potong daftar berkelompok (urutan tampil) sehingga total item ≤ `limit`. */
export function limitGroups<K, T>(groups: [K, T[]][], limit: number): [K, T[]][] {
  const out: [K, T[]][] = [];
  let left = limit;
  for (const [key, items] of groups) {
    if (left <= 0) break;
    out.push([key, items.length > left ? items.slice(0, left) : items]);
    left -= items.length;
  }
  return out;
}

export const countGrouped = <K, T>(groups: [K, T[]][]) =>
  groups.reduce((n, [, items]) => n + items.length, 0);
