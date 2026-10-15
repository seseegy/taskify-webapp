/**
 * Logika murni efek ketik (tanpa DOM/React) — diuji di typewriter.test.ts.
 * Hook & komponennya: `useTypewriter.ts` dan `components/ui/TypedText.tsx`.
 */

/** Jumlah KARAKTER (code point), bukan unit UTF-16: nama berisi emoji/aksen tidak terbelah. */
export const charCount = (text: string) => Array.from(text).length;

/** Ambil `n` karakter pertama. */
export function sliceChars(text: string, n: number): string {
  if (n <= 0) return '';
  const chars = Array.from(text);
  return n >= chars.length ? text : chars.slice(0, n).join('');
}

/**
 * `aria-hidden` saja tidak cukup untuk pengguna yang mematikan animasi. Aturan
 * `prefers-reduced-motion` di index.css hanya menjangkau animasi/transisi CSS, sedangkan efek
 * ketik digerakkan timer JavaScript — jadi harus memeriksa sendiri.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface TypedParts {
  /** Bagian biasa yang sudah terketik */
  plain: string;
  /** Sisa bagian biasa; dirender TAK TERLIHAT supaya tata letak tidak bergeser */
  plainRest: string;
  /** Bagian aksen (akhiran kalimat, mis. nama) yang sudah terketik */
  accent: string;
  /**
   * Sisa aksen. Dirender tak terlihat DI DALAM elemen aksen yang sama, supaya lebar elemen
   * (dan gradasi `text-gradient-brand` di atasnya) sudah penuh sejak awal: warna huruf yang
   * sudah tampil tidak bergeser setiap huruf bertambah.
   */
  accentRest: string;
  done: boolean;
}

/**
 * Pecah `text` setelah `n` karakter terketik. `accent` (opsional) harus berupa AKHIRAN kalimat;
 * bila bukan, diabaikan (seluruh teks diperlakukan sebagai bagian biasa).
 */
export function splitTyped(text: string, n: number, accent?: string): TypedParts {
  const chars = Array.from(text);
  const total = chars.length;
  const accentLen = accent && text.endsWith(accent) ? charCount(accent) : 0;
  const plainEnd = total - accentLen;
  const shown = Math.min(Math.max(n, 0), total);
  const plainShown = Math.min(shown, plainEnd);
  const accentShown = Math.max(shown - plainEnd, 0);
  return {
    plain: chars.slice(0, plainShown).join(''),
    plainRest: chars.slice(plainShown, plainEnd).join(''),
    accent: chars.slice(plainEnd, plainEnd + accentShown).join(''),
    accentRest: chars.slice(plainEnd + accentShown).join(''),
    done: shown >= total,
  };
}

export interface TypingStep {
  /** Teks yang ditampilkan SEKARANG */
  text: string;
  /** Berapa lama (ms) teks ini ditahan sebelum langkah berikutnya */
  delay: number;
}

export interface TypingOptions {
  typeMs?: number;
  holdMs?: number;
  eraseMs?: number;
  /** Jeda setelah terhapus habis, sebelum contoh berikutnya mulai diketik */
  gapMs?: number;
}

/**
 * Urutan tak berujung: ketik tiap contoh huruf demi huruf → tahan → hapus cepat → contoh
 * berikutnya. Dipakai placeholder kotak cari. Generator berhenti hanya bila `examples` kosong.
 */
export function* typingSteps(
  examples: readonly string[],
  { typeMs = 45, holdMs = 1800, eraseMs = 18, gapMs = 300 }: TypingOptions = {},
): Generator<TypingStep, void, void> {
  if (examples.length === 0) return;
  for (;;) {
    for (const example of examples) {
      const chars = Array.from(example);
      for (let i = 1; i < chars.length; i++)
        yield { text: chars.slice(0, i).join(''), delay: typeMs };
      yield { text: example, delay: holdMs };
      for (let i = chars.length - 1; i >= 1; i--)
        yield { text: chars.slice(0, i).join(''), delay: eraseMs };
      yield { text: '', delay: gapMs };
    }
  }
}
