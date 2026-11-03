import { cn } from '@/lib/utils';

const SIZES = {
  sm: { box: 'size-9 rounded-xl', icon: 'size-5', text: 'text-lg' },
  md: { box: 'size-11 rounded-2xl', icon: 'size-6', text: 'text-xl' },
  lg: { box: 'size-16 rounded-3xl', icon: 'size-9', text: 'text-3xl' },
} as const;

export function Logo({
  size = 'md',
  withText = false,
  className,
  textClassName,
}: {
  size?: keyof typeof SIZES;
  withText?: boolean;
  className?: string;
  /** Tambahan kelas untuk teks "Taskify" (mis. sembunyikan di layar sangat sempit) */
  textClassName?: string;
}) {
  const s = SIZES[size];
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        className={cn(
          'shine flex items-center justify-center bg-gradient-brand text-white shadow-lg shadow-fuchsia-500/30',
          s.box,
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className={s.icon} aria-hidden>
          <path
            d="M5.5 12.5l4 4 9-10"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {withText && (
        <span
          className={cn('text-gradient-brand font-semibold tracking-tight', s.text, textClassName)}
        >
          Taskify
        </span>
      )}
    </div>
  );
}
