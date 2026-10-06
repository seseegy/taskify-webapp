import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 'side' = panel kanan di desktop / bottom sheet di HP. 'center' = dialog kecil. */
  variant?: 'side' | 'center' | 'palette';
  className?: string;
  /** Panel samping lebih lebar (editor kode, penampil zip) */
  wide?: boolean;
}

/**
 * Panel modal berbasis <dialog> native → fokus terkunci, Esc menutup, aksesibel.
 * Tandai input dengan `data-autofocus` agar difokuskan saat dibuka.
 * Klik di luar panel (backdrop) juga menutup.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'side',
  className,
  wide,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() memfokuskan elemen pertama (tombol Tutup). Pindahkan ke input yang ditandai.
      requestAnimationFrame(() => dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        'm-0 max-h-none max-w-none bg-transparent p-0 text-fg backdrop:bg-indigo-950/40 backdrop:backdrop-blur-sm',
        variant === 'side'
          ? cn(
              'inset-x-0 top-auto bottom-0 w-full sm:inset-y-0 sm:right-0 sm:left-auto sm:h-dvh',
              wide ? 'sm:w-[min(94vw,820px)]' : 'sm:w-[440px]',
            )
          : variant === 'palette'
            ? 'inset-x-0 top-[8dvh] mx-auto w-[min(94vw,640px)]'
            : 'inset-0 m-auto w-[min(92vw,420px)]',
      )}
    >
      {open && (
        <div
          className={cn(
            'flex animate-fade-up flex-col glass-strong',
            variant === 'side'
              ? 'max-h-[88dvh] rounded-t-3xl sm:m-3 sm:h-[calc(100dvh-1.5rem)] sm:max-h-none sm:rounded-3xl'
              : 'max-h-[85dvh] rounded-3xl',
            className,
          )}
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            {variant === 'side' && (
              <span className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" />
            )}
            <div className="min-w-0 text-base font-bold">{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-fg"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <div className="border-t border-line px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
