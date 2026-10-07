import { cn } from '@/lib/utils';

interface Props {
  value: number;
  max?: number;
  /** Nama bar untuk pembaca layar (wajib bila tidak `decorative`). */
  label?: string;
  /** Teks yang dibacakan menggantikan angka mentah, mis. "1 dari 3 subtask selesai". */
  valueText?: string;
  /**
   * Bar hanya pelengkap visual karena angkanya sudah tertulis di dekatnya atau bar berada di dalam
   * tombol (isi tombol dibacakan sebagai teks, jadi `role="progressbar"` di dalamnya tidak terbaca).
   */
  decorative?: boolean;
  /** Kelas track (tinggi/lebar/margin). Default h-1.5. */
  className?: string;
  /** Kelas isi bar (warna/gradasi). */
  barClassName?: string;
}

/** Bar progres. Memakai <span> agar valid di dalam <button>/<p> (phrasing content). */
export function Progress({
  value,
  max = 100,
  label,
  valueText,
  decorative = false,
  className,
  barClassName,
}: Props) {
  const ratio = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-valuenow': Math.round(Math.min(max, Math.max(0, value))),
        'aria-valuetext': valueText,
      } as const);

  return (
    <span
      className={cn('block h-1.5 overflow-hidden rounded-full bg-surface', className)}
      {...a11y}
    >
      <span
        className={cn('block h-full rounded-full transition-all', barClassName)}
        style={{ width: `${ratio * 100}%` }}
      />
    </span>
  );
}
