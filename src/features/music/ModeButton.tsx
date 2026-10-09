import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tombol mode pemutaran (ulang, acak, lanjut otomatis, bisu).
 *
 * Dipakai di tab Antrean dan di layar "Sedang diputar". Dua hal yang dikunci di sini supaya
 * tidak menyimpang di salah satu tempat:
 *
 *  - **`aria-pressed` wajib.** Ini tombol berkeadaan, bukan aksi sekali jalan; tanpa itu
 *    pembaca layar tidak bisa tahu mode mana yang sedang menyala.
 *  - **`size-11` (44px), bukan 40px.** `Button size="icon"` di repo ini 40px, di bawah target
 *    sentuh minimum.
 *
 * Keadaan menyala ditandai **latar bergradasi + teks putih**, bukan sekadar perubahan warna
 * ikon — supaya terbaca tanpa bergantung pada persepsi warna. Namanya juga ikut berubah
 * ("Acak: menyala" / "Acak: mati"), jadi keadaannya tersampaikan dua kali.
 */
export function ModeButton({
  label,
  pressed,
  onClick,
  children,
  className,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl transition active:scale-95',
        pressed ? 'shine bg-gradient-music text-white shadow-md' : 'text-muted glass hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}
