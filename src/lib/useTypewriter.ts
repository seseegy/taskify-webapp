import { useEffect, useRef, useState } from 'react';
import { charCount, prefersReducedMotion } from './typewriter';

const CHAR_MS = 32;

interface Options {
  /** Mulai hanya bila true (mis. menunggu data sync siap). */
  enabled: boolean;
  /** Kunci sesi (`sessionStorage`): sekali terketik, kunjungan berikutnya langsung utuh. */
  onceKey?: string;
  charMs?: number;
  /** Dipanggil SEKALI saat seluruh kalimat tampil (juga bila langsung utuh karena dilewati). */
  onDone?: () => void;
}

function seen(key?: string): boolean {
  if (!key) return false;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function remember(key?: string) {
  if (!key) return;
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* mode privat: abaikan, efek hanya mungkin berulang */
  }
}

/**
 * Efek ketik untuk satu kalimat. Mengembalikan `n` = jumlah karakter yang boleh tampil.
 *
 * Aturan (sengaja, lihat percakapan desain):
 *  - Menunggu `enabled` (data sync) supaya yang terketik tidak berubah di tengah jalan.
 *  - Sekali per sesi (`onceKey`); kunjungan berikutnya langsung utuh.
 *  - `prefers-reduced-motion` → langsung utuh. Aturan CSS di index.css TIDAK menjangkau timer JS.
 *  - Tab di latar belakang: ketikan ditahan, dilanjutkan saat tab terlihat lagi.
 *  - Setelah selesai, teks yang berubah (mis. angka tugas bertambah) tampil utuh seketika dan
 *    tidak diketik ulang; `n` selalu dibatasi `total` sehingga teks yang menyusut tidak error.
 *
 * Semua yang memengaruhi tampilan adalah STATE (bukan ref), supaya render selalu sesuai kenyataan.
 */
export function useTypewriter(
  text: string,
  { enabled, onceKey, charMs = CHAR_MS, onDone }: Options,
) {
  const total = charCount(text);
  // Diputuskan SEKALI saat mount: kunjungan ulang / reduced motion → langsung utuh tanpa kedip.
  const [skip] = useState(() => prefersReducedMotion() || seen(onceKey));
  const [typed, setTyped] = useState(0);
  const [finished, setFinished] = useState(false);

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // Ketik bertahap. Bergantung pada `total` yang STABIL selama teks tidak berubah panjang.
  useEffect(() => {
    if (skip || !enabled || finished) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(tick, 250); // tahan selama tab tak terlihat
        return;
      }
      i += 1;
      setTyped(i);
      if (i >= total) {
        remember(onceKey);
        setFinished(true);
        return;
      }
      timer = setTimeout(tick, charMs);
    };
    timer = setTimeout(tick, 180); // jeda singkat setelah halaman muncul
    return () => clearTimeout(timer);
  }, [skip, enabled, finished, total, onceKey, charMs]);

  const done = skip || finished;

  // Kabari SEKALI: saat selesai mengetik, atau saat dilewati dan sudah boleh jalan.
  const notified = useRef(false);
  useEffect(() => {
    if (done && enabled && !notified.current) {
      notified.current = true;
      onDoneRef.current?.();
    }
  }, [done, enabled]);

  // Sebelum `enabled` (data belum siap), tampil 0 karakter walau `skip`: ruangnya sudah dipesan
  // oleh bagian tak terlihat, jadi tata letak tidak bergeser saat teks sebenarnya tiba.
  const n = done ? (enabled ? total : 0) : Math.min(typed, total);
  return { n, done };
}
