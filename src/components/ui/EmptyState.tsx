import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Kelas gradasi modul, mis. 'bg-gradient-tasks' */
  gradient?: string;
  children?: ReactNode;
  className?: string;
  /** Tingkat judul; pakai 'h1' bila ini isi utama halaman (mis. 404, error). */
  as?: 'h1' | 'h2' | 'h3';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  gradient = 'bg-gradient-brand',
  children,
  className,
  as: Heading = 'h3',
}: Props) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="relative mb-5">
        <div className={cn('absolute inset-0 rounded-3xl opacity-50 blur-2xl', gradient)} />
        <div
          className={cn(
            'shine relative flex size-16 items-center justify-center rounded-3xl text-white shadow-xl',
            gradient,
          )}
        >
          <Icon className="size-8" />
        </div>
      </div>
      <Heading className="text-lg font-bold">{title}</Heading>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
