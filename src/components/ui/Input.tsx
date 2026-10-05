import type { InputHTMLAttributes, LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-xl px-3.5 text-sm text-fg glass transition outline-none placeholder:text-muted/70',
        'focus:border-primary/60 focus:ring-4 focus:ring-primary/15',
        'disabled:opacity-60 aria-invalid:border-danger/70',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-semibold', className)} {...props} />;
}
