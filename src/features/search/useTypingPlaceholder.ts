import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion, typingSteps } from '@/lib/typewriter';

/**
 * Contoh yang diketik bergantian di kotak cari, sekaligus mengajarkan sintaks catat cepat
 * (nominal → transaksi, waktu → tugas, `j:` jurnal, `c:` catatan, `#tag`).
 *
 * Panjangnya DIBATASI: placeholder tidak membungkus baris, dan di layar 320px lebar area isi input
 * hanya ±201px (diukur di browser). Awalan "Coba: " + contoh terpanjang harus ≤ ~190px, kalau
 * tidak huruf di ujung terpotong — dulu 'besok rapat jam 9 #kerja' (221px) memotong justru bagian
 * #kerja yang mengajarkan tag. Ubah daftar ini → ukur ulang di 320px.
 *
 * Setiap contoh HARUS benar-benar diurai sesuai yang diajarkannya: dikunci oleh
 * useTypingPlaceholder.test.ts (contoh yang tidak dikenali parser lebih buruk daripada terpotong).
 */
export const PLACEHOLDER_PREFIX = 'Coba: ';
export const PLACEHOLDER_EXAMPLES = [
  'makan siang 25rb',
  'rapat 09.00 #kerja',
  'c: ide fitur baru',
  '+5jt gaji oktober',
  'j: hari ini puas',
] as const;

/**
 * Efek ketik pada atribut `placeholder`.
 *
 * Diubah LANGSUNG di elemen DOM, bukan lewat state React: PaletteBody berat (pencarian, daftar
 * hasil, perintah), dan render ulang tiap huruf membuat palet terasa patah-patah.
 *
 * - `active` false (pengguna sudah mengetik) → berhenti; placeholder memang tidak terlihat lagi.
 * - Reduced motion → statis (aturan CSS di index.css tidak menjangkau timer JS).
 * - Tab di latar belakang → ditahan.
 * - Nama aksesibel input tetap dari `aria-label`, jadi placeholder yang berubah tidak dibacakan
 *   sebagai label.
 */
export function useTypingPlaceholder(ref: RefObject<HTMLInputElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fallback = PLACEHOLDER_PREFIX + PLACEHOLDER_EXAMPLES[0];
    if (!active || prefersReducedMotion()) {
      el.placeholder = fallback;
      return;
    }
    const steps = typingSteps(PLACEHOLDER_EXAMPLES);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(tick, 500);
        return;
      }
      const next = steps.next();
      if (next.done) return;
      el.placeholder = PLACEHOLDER_PREFIX + next.value.text;
      timer = setTimeout(tick, next.value.delay);
    };
    timer = setTimeout(tick, 400); // beri waktu palet selesai membuka sebelum bergerak
    return () => clearTimeout(timer);
  }, [ref, active]);
}
