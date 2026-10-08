import { Button } from './Button';
import { Sheet } from './Sheet';
import { useConfirmStore } from './confirm-store';

/**
 * Dialog konfirmasi aplikasi, pengganti `window.confirm`. Dipasang sekali di AppShell
 * (sebelah `<Toaster />`); dipanggil dari mana saja lewat `askConfirm()`.
 *
 * Fokus awal jatuh ke tombol **Batal** (`data-autofocus`), bukan tombol merah: hampir semua
 * konfirmasi di sini adalah penghapusan, jadi Enter yang refleks tidak langsung menghapus.
 * Esc dan klik di luar panel dihitung sebagai batal, sama seperti `window.confirm`.
 */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const settle = useConfirmStore((s) => s.settle);
  const danger = (request?.tone ?? 'danger') === 'danger';

  return (
    <Sheet
      open={request !== null}
      onClose={() => settle(false)}
      variant="center"
      title={request?.title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" data-autofocus onClick={() => settle(false)}>
            {request?.cancelLabel ?? 'Batal'}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {request?.confirmLabel ?? 'Lanjutkan'}
          </Button>
        </div>
      }
    >
      {request?.description ? (
        <p className="text-sm text-muted">{request.description}</p>
      ) : (
        <p className="text-sm text-muted">Tindakan ini tidak bisa dibatalkan.</p>
      )}
    </Sheet>
  );
}
