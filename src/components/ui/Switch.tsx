import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Saklar berbasis checkbox asli (role="switch"): keyboard, fokus, dan pembaca layar gratis. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 transition',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full bg-muted/35 transition-colors',
          'after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform',
          'peer-checked:bg-primary peer-checked:after:translate-x-5',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
        )}
      />
    </label>
  );
}
