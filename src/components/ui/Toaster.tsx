import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToastStore } from './toast-store';

const ICONS = { default: Info, success: CircleCheck, danger: CircleAlert };

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);

  return (
    // Satu live region permanen (polite). Item TIDAK diberi role="status" lagi agar tidak
    // diumumkan ganda. Posisinya memakai `--stack-bottom-overlay` (lihat styles/index.css):
    // satu nilai yang sudah menghitung navigasi bawah, bilah musik, dan FAB halaman — jadi
    // tidak ada lagi angka literal per breakpoint yang harus dicocokkan dengan tangan.
    <div
      role="region"
      aria-label="Notifikasi"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[var(--stack-bottom-overlay)] z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            // Tahan hitung mundur saat dibaca: kursor mouse (bukan sentuhan) atau fokus keyboard
            onPointerEnter={(e) => e.pointerType === 'mouse' && pause(t.id)}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse' && !e.currentTarget.contains(document.activeElement))
                resume(t.id);
            }}
            onFocus={() => pause(t.id)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(t.id);
            }}
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
                className="min-h-9 rounded-lg px-2.5 py-1.5 font-bold text-primary transition hover:bg-surface"
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
              className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
