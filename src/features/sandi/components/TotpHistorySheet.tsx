import { History, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { isoToLocal, relativeDayLabel } from '@/lib/date';
import { TOTP_LOG_RETENTION_DAYS } from '../totp-log';
import type { TotpLogItem } from '../sandi-data';

/**
 * Riwayat pemakaian kode TOTP: nama akun, angka kodenya, dan waktunya. Tersinkron antar
 * perangkat dan terenkripsi — server hanya melihat waktunya.
 */
export function TotpHistorySheet({
  open,
  onClose,
  entries,
  loading,
  onDelete,
  onClearAll,
}: {
  open: boolean;
  onClose: () => void;
  entries: TotpLogItem[];
  loading: boolean;
  onDelete: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const clearAll = async () => {
    setBusy(true);
    try {
      await onClearAll();
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Riwayat kode">
      {loading ? (
        <ul aria-busy="true" aria-label="Memuat riwayat" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-2xl glass" />
          ))}
        </ul>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={History}
          gradient="bg-gradient-sandi"
          title="Belum ada riwayat"
          description="Setiap kode yang kamu salin akan tercatat di sini."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Tercatat saat kode disalin. Otomatis dibuang setelah {TOTP_LOG_RETENTION_DAYS} hari.
          </p>

          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-2xl p-2.5 glass">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {e.entry.name || 'Tanpa nama'}
                  </span>
                  <span className="block text-xs text-muted">{when(e)}</span>
                </span>
                <span className="font-mono text-sm font-bold text-muted tabular-nums">
                  {e.entry.code}
                </span>
                <button
                  type="button"
                  onClick={() => void onDelete(e.id)}
                  aria-label={`Hapus catatan ${e.entry.name || 'tanpa nama'}`}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface hover:text-danger"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          {confirming ? (
            <div role="alert" className="space-y-2 rounded-2xl bg-danger/10 p-3.5">
              <p className="text-sm font-medium">Hapus seluruh riwayat kode?</p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" loading={busy} onClick={() => void clearAll()}>
                  Ya, hapus semua
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Batal
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden="true" /> Hapus seluruh riwayat
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** "Hari ini 14:02" / "7 Okt 14:02" — mengikuti zona waktu aplikasi. */
function when(e: TotpLogItem): string {
  const { date, time } = isoToLocal(e.entry.usedAt || e.created_at);
  return `${relativeDayLabel(date)} ${time}`;
}
