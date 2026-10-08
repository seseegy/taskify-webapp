import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'glass w-full rounded-xl px-3.5 text-sm text-fg transition outline-none placeholder:text-muted/70 focus:border-primary/60 focus:ring-4 focus:ring-primary/15 disabled:opacity-60';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'min-h-24 resize-y py-2.5', className)} {...props} />;
}
