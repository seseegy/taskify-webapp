import { Check, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';

const RING: Record<number, string> = {
  0: 'border-muted/50',
  1: 'border-sky-500',
  2: 'border-amber-500',
  3: 'border-rose-500',
};

interface Props {
  checked: boolean;
  priority?: number;
  onToggle?: () => void;
  /** Kejadian virtual tugas berulang: tidak bisa dicentang langsung */
  virtual?: boolean;
  size?: 'sm' | 'md';
  label: string;
}

/** Lingkaran centang; warna tepi = prioritas. */
export function TaskCheckbox({
  checked,
  priority = 0,
  onToggle,
  virtual,
  size = 'md',
  label,
}: Props) {
  const box = size === 'sm' ? 'size-5' : 'size-6';
  if (virtual) {
    return (
      <span
        className={cn(
          box,
          'flex shrink-0 items-center justify-center rounded-full border-2 border-dashed',
          RING[priority],
        )}
        title="Kejadian berulang mendatang"
      >
        <Repeat className="size-3 text-muted" />
        {/* `title` saja tidak terjangkau sentuhan/keyboard/pembaca layar */}
        <span className="sr-only">Kejadian berulang mendatang</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      className={cn(
        box,
        // Lingkaran tetap kecil, tapi area ketuk diperluas via ::before: 44px (md) / 36px (sm,
        // = tinggi minimum baris ringkas agar tidak tumpang tindih). WCAG 2.5.8 butuh ≥ 24px.
        'group relative flex shrink-0 items-center justify-center rounded-full border-2 transition before:absolute before:content-[""] active:scale-90',
        size === 'sm' ? 'before:-inset-2' : 'before:-inset-2.5',
        checked
          ? 'shine border-transparent bg-gradient-tasks text-white shadow-md shadow-violet-500/30'
          : RING[priority],
        !checked && 'hover:bg-primary/10',
      )}
    >
      <Check
        className={cn(
          size === 'sm' ? 'size-3' : 'size-3.5',
          'transition',
          checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0 group-hover:opacity-40',
        )}
        strokeWidth={3.5}
      />
    </button>
  );
}
