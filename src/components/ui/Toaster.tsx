import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToastStore } from './toast-store';

const ICONS = { default: Info, success: CircleCheck, danger: CircleAlert };

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm animate-fade-up items-center gap-3 rounded-2xl py-2.5 pr-2 pl-4 text-sm glass-strong"
          >
            <Icon
              className={cn(
                'size-5 shrink-0',
                t.tone === 'success' && 'text-success',
                t.tone === 'danger' && 'text-danger',
                t.tone === 'default' && 'text-primary',
              )}
            />
            <span className="flex-1 font-medium">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="rounded-lg px-2.5 py-1.5 font-bold text-primary transition hover:bg-surface"
                onClick={() => {
                  void t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Tutup"
              onClick={() => dismiss(t.id)}
              className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
