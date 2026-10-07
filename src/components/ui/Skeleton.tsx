import { cn } from '@/lib/utils';

/**
 * Penanda "sedang memuat" untuk daftar. Muncul dengan jeda (animate-delayed-in) supaya pemuatan
 * singkat tidak berkedip; sebelum itu area dibiarkan kosong — bukan empty state palsu.
 * Pembaca layar diberi tahu lewat `role="status"` + `aria-busy`; barisnya `aria-hidden`.
 */
export function LoadingRows({
  label = 'Memuat…',
  rows = 4,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn('animate-delayed-in space-y-2', className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3 rounded-2xl px-3 py-3">
            <div className="size-6 shrink-0 rounded-full bg-surface-strong" />
            <div className="min-w-0 flex-1 space-y-2">
              <div
                className="h-3.5 rounded-full bg-surface-strong"
                style={{ width: `${70 - i * 9}%` }}
              />
              <div className="h-2.5 w-1/3 rounded-full bg-surface" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
