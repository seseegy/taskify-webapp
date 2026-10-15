import { Check, CircleAlert, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

/** Status simpan otomatis editor (Jurnal, Catatan). */
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'idle') return <span className="text-xs text-muted">Draf</span>;
  if (state === 'error') {
    return (
      <span className="flex items-center gap-2">
        <span role="alert" className="flex items-center gap-1 text-xs font-semibold text-danger">
          <CircleAlert className="size-3.5" />
          Gagal menyimpan
        </span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RotateCcw /> Coba lagi
        </Button>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-xs font-semibold',
        state === 'saved' ? 'text-success' : 'text-muted',
      )}
      role="status"
    >
      {state === 'saved' ? (
        <Check className="size-3.5" />
      ) : (
        <Loader2 className="size-3.5 animate-spin" />
      )}
      {state === 'saved' ? 'Tersimpan' : 'Menyimpan…'}
    </span>
  );
}
