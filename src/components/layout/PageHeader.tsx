import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  gradient?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, icon: Icon, gradient, actions }: Props) {
  return (
    <header className="mb-6 flex animate-fade-up items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        {Icon && (
          <div
            className={cn(
              'shine flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg',
              gradient ?? 'bg-gradient-brand',
            )}
          >
            <Icon className="size-6" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
