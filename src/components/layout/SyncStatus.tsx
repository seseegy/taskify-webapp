import { formatDistanceToNow } from 'date-fns';
import { CloudCheck, CloudOff, CloudUpload, RefreshCw } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { localeId } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useSyncState, type SyncState } from './sync-state';

const META: Record<SyncState, { label: string; icon: typeof CloudCheck; className: string }> = {
  synced: { label: 'Tersinkron', icon: CloudCheck, className: 'text-success' },
  uploading: { label: 'Mengunggah…', icon: CloudUpload, className: 'text-primary' },
  syncing: { label: 'Menyinkron…', icon: RefreshCw, className: 'text-primary' },
  connecting: { label: 'Menghubungkan…', icon: RefreshCw, className: 'text-muted' },
  offline: { label: 'Offline', icon: CloudOff, className: 'text-warning' },
};

/** Indikator kecil status sync. `compact` = ikon saja (header HP). */
export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const { state, lastSyncedAt } = useSyncState();
  const meta = META[state];
  const Icon = meta.icon;
  const spinning = state === 'syncing' || state === 'connecting';

  const detail =
    state === 'offline'
      ? 'Perubahan disimpan di perangkat & dikirim saat online'
      : lastSyncedAt
        ? `Terakhir ${formatDistanceToNow(lastSyncedAt, { addSuffix: true, locale: localeId })}`
        : undefined;

  const full = detail ? `${meta.label}. ${detail}` : meta.label;

  return (
    // Tombol: bisa difokuskan (keyboard) dan diketuk (sentuhan) untuk membaca detail,
    // tidak hanya lewat tooltip hover. Status berubah tetap diumumkan lewat live region tersembunyi.
    <>
      <button
        type="button"
        onClick={() => toast(full)}
        title={full}
        aria-label={`Status sinkronisasi: ${full}`}
        className={cn(
          'flex items-center gap-2 rounded-full text-xs font-semibold glass',
          compact ? 'size-10 justify-center' : 'min-h-9 px-3 py-1.5',
          meta.className,
        )}
      >
        <Icon className={cn('size-4', spinning && 'animate-spin')} aria-hidden="true" />
        {!compact && <span>{meta.label}</span>}
      </button>
      <span role="status" className="sr-only">
        {meta.label}
      </span>
    </>
  );
}
