import { useEffect, useId } from 'react';
import { Button } from './Button';
import { registerConfirmHost, useConfirmStore } from './confirm-store';
import { Sheet } from './Sheet';

/** Pasang SEKALI di AppShell. Menampilkan dialog untuk `confirmDialog()`. */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const settle = useConfirmStore((s) => s.settle);
  const descId = useId();

  useEffect(() => registerConfirmHost(), []);

  return (
    <Sheet
      open={pending !== null}
      onClose={() => settle(false)}
      variant="center"
      role="alertdialog"
      describedBy={descId}
      title={pending?.title ?? 'Konfirmasi'}
      footer={
        pending && (
          <div className="flex justify-end gap-2">
            {/* Fokus awal di Batal: menekan Enter tidak sengaja tidak menghapus apa pun */}
            <Button variant="secondary" data-autofocus onClick={() => settle(false)}>
              {pending.cancelLabel ?? 'Batal'}
            </Button>
            <Button
              variant={pending.destructive === false ? 'primary' : 'danger'}
              onClick={() => settle(true)}
            >
              {pending.confirmLabel ?? 'Ya, lanjutkan'}
            </Button>
          </div>
        )
      }
    >
      <p id={descId} className="text-sm leading-relaxed">
        {pending?.message}
      </p>
    </Sheet>
  );
}
