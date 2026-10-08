import { Check } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

/**
 * Kotak centang dengan tampilan milik kita sendiri.
 *
 * Bentuknya custom tetapi elemennya tetap `<input type="checkbox">` asli (hanya
 * `appearance-none`), jadi fokus keyboard, spasi untuk mencentang, status bagi pembaca layar,
 * dan perilaku di dalam `<label>` semuanya tetap bawaan browser — tidak ada yang perlu
 * ditiru ulang. Ikon centang hanya hiasan di atasnya (`aria-hidden`).
 *
 * Untuk saklar hidup/mati pakai `features/sandi/components/Switch` (role="switch").
 * Yang ini untuk "ya/tidak" biasa, termasuk konfirmasi.
 */
export function Checkbox({ checked, onChange, className, disabled, ...props }: Props) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'peer size-5 cursor-pointer appearance-none rounded-md border border-line bg-surface transition',
          'checked:border-primary checked:bg-primary',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-3.5 scale-0 text-white transition-transform peer-checked:scale-100"
        strokeWidth={3}
      />
    </span>
  );
}
