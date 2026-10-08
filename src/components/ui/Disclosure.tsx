import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Bagian yang bisa dibuka-tutup, dengan chevron milik kita sendiri.
 *
 * Tetap memakai `<details>`/`<summary>` asli, bukan tombol + state React. Alasannya: buka-tutup,
 * fokus keyboard, dan pengumuman ke pembaca layar sudah ditangani browser, dan tetap berfungsi
 * walaupun JavaScript gagal dimuat. Yang diganti hanya tampilannya — marker ▶ bawaan
 * disembunyikan di `index.css`, lalu chevron ini yang berputar saat terbuka.
 */
export function Disclosure({
  summary,
  children,
  className,
  summaryClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  return (
    <details className={className}>
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg py-1 transition hover:text-fg',
          summaryClassName,
        )}
      >
        <ChevronRight
          className="disclosure-chevron size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
        {summary}
      </summary>
      {children}
    </details>
  );
}
