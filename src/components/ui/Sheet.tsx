import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { askConfirm } from './confirm-store';
import { SheetDirtyContext } from './sheet-dirty';

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
 *
 * ## Sisi tajam: `onClose` juga terpanggil saat ditutup secara TERPROGRAM
 *
 * `onClose` dipasang pada event `close` native, dan event itu terpicu oleh `dialog.close()`
 * di efek di bawah — bukan hanya oleh Esc, backdrop, atau tombol Tutup. Jadi `onClose`
 * berarti "dialog ini tertutup", **bukan** "pengguna menutupnya".
 *
 * Untuk satu dialog yang menyetel `open`-nya sendiri jadi `false`, itu tidak terasa: aksinya
 * idempoten. Tapi kalau DUA `Sheet` berbagi satu keadaan (mis. satu field yang menentukan
 * panel mana yang terbuka), menutup yang satu akan memanggil `onClose`-nya dan menghapus
 * keadaan yang baru saja dipasang untuk yang lain — hasilnya kedua panel tertutup. Itu sudah
 * pernah terjadi; lihat catatan di `features/music/MusicSheet.tsx`.
 *
 * Jadi: untuk beberapa panel yang saling eksklusif, pakai **satu** `Sheet` lalu ganti
 * isinya — jangan beberapa `Sheet` yang dikendalikan satu keadaan.
 *
 * ## Isian belum disimpan
 *
 * Form di dalamnya memanggil `useSheetDirty(dirty)` (./sheet-dirty.ts). Selama dirty, Esc,
 * klik backdrop, atau tombol Tutup menanyakan "Buang perubahan?" dulu, baru memanggil `onClose`.
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
  // Judul dipakai sebagai nama aksesibel dialog (dibacakan pembaca layar saat dibuka)
  const titleId = useId();
  const hasTitle = title !== undefined && title !== null && title !== '';

  // Ref, bukan state: perubahan dirty tidak perlu merender ulang panel.
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const asking = useRef(false);
  /** Penutupan oleh pengguna — ditanya dulu bila ada isian yang belum disimpan. */
  const requestClose = async () => {
    if (!dirtyRef.current) return onClose();
    if (asking.current) return;
    asking.current = true;
    try {
      const discard = await askConfirm({
        title: 'Buang perubahan?',
        description: 'Isian yang belum disimpan akan hilang.',
        confirmLabel: 'Buang',
        cancelLabel: 'Lanjut mengisi',
      });
      if (discard) {
        dirtyRef.current = false;
        onClose();
      }
    } finally {
      asking.current = false;
    }
  };

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
      aria-labelledby={open && hasTitle ? titleId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        void requestClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) void requestClose();
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
            <div id={hasTitle ? titleId : undefined} className="min-w-0 text-base font-bold">
              {title}
            </div>
            <button
              type="button"
              onClick={() => void requestClose()}
              aria-label="Tutup"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-fg"
            >
              <X className="size-5" />
            </button>
          </div>
          <SheetDirtyContext.Provider value={setDirty}>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && (
              <div className="border-t border-line px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
                {footer}
              </div>
            )}
          </SheetDirtyContext.Provider>
        </div>
      )}
    </dialog>
  );
}
