import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

interface Props<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex rounded-xl p-1 glass', className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition [&_svg]:size-4',
              active
                ? 'shine bg-gradient-brand text-white shadow-md shadow-fuchsia-500/20'
                : 'text-muted hover:text-fg',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
