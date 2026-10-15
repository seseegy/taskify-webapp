import type { ElementType, ReactNode } from 'react';
import { splitTyped } from '@/lib/typewriter';
import { useTypewriter } from '@/lib/useTypewriter';

interface Props {
  /** Kalimat lengkap. Bagian `accent` HARUS akhiran kalimat. */
  text: string;
  /** Akhiran kalimat yang diberi `accentClassName` (mis. nama atau "Taskify"). */
  accent?: string;
  accentClassName?: string;
  /** Mulai hanya saat true (mis. menunggu data). Sebelum itu, ruang sudah dipesan (tak terlihat). */
  enabled?: boolean;
  /** Kunci sesi: sekali terketik, selanjutnya langsung utuh (lihat useTypewriter). */
  onceKey?: string;
  /** Dipanggil sekali saat seluruh kalimat tampil. */
  onDone?: () => void;
  as?: ElementType;
  className?: string;
  /** Elemen setelah teks (mis. ikon), selalu tampil. */
  after?: ReactNode;
}

/**
 * Teks dengan efek ketik, aman untuk aksesibilitas dan tata letak:
 *  - Pembaca layar membaca teks LENGKAP sekali (`sr-only`); salinan animasinya `aria-hidden`,
 *    jadi tidak dibacakan huruf demi huruf.
 *  - Setelah `enabled`, seluruh teks dirender sejak awal (sisa huruf `invisible`), jadi tinggi
 *    blok tetap dan elemen di bawahnya tidak bergeser setiap huruf bertambah. Sebelum `enabled`
 *    hanya satu baris kosong yang dirender (lihat komentar di bawah).
 *  - Reduced motion / kunjungan ulang → langsung utuh (lihat useTypewriter).
 */
export function TypedText({
  text,
  accent,
  accentClassName,
  enabled = true,
  onceKey,
  onDone,
  as: Tag = 'span',
  className,
  after,
}: Props) {
  const { n } = useTypewriter(text, { enabled, onceKey, onDone });
  const p = splitTyped(text, n, accent);

  // Data belum siap → `text` masih sementara (mis. tanpa nama / "Belum ada tugas"). Merender
  // teks sementara itu, walau tak terlihat, memesan ruang yang SALAH: begitu data tiba dan teks
  // membungkus ke baris lain, blok tumbuh dan semua di bawahnya terdorong. Jadi sebelum siap,
  // jangan render apa pun selain satu baris kosong (`&nbsp;`) agar blok tidak runtuh.
  if (!enabled) {
    return (
      <Tag className={className} aria-hidden="true">
        &nbsp;
      </Tag>
    );
  }

  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {p.plain}
        <span className="invisible">{p.plainRest}</span>
        {(p.accent || p.accentRest) && (
          <span className={accentClassName}>
            {p.accent}
            <span className="invisible">{p.accentRest}</span>
          </span>
        )}
      </span>
      {after}
    </Tag>
  );
}
