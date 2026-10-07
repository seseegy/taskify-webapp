import { Plus } from 'lucide-react';
import type { LocalDate } from '@/lib/date';
import { useTransactions } from '../finance-queries';
import { useTxSheet } from '../tx-sheet-store';
import { TransactionRow } from './TransactionRow';

/** Transaksi pada satu tanggal + tombol catat (dipakai panel hari di Kalender). */
export function DayTransactions({ date }: { date: LocalDate }) {
  const { rows } = useTransactions({ from: date, to: date, limit: 50 });
  const create = useTxSheet((s) => s.create);

  return (
    <div>
      {/* Tombol di luar <h3>: kalau di dalam, teks tombol ikut menjadi nama heading */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Keuangan</h3>
        <button
          type="button"
          onClick={() => create({ date })}
          className="flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-primary hover:bg-surface"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Catat
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted">Tidak ada transaksi.</p>
      ) : (
        <div className="space-y-0.5">
          {rows.map((t) => (
            <TransactionRow key={t.id} tx={t} compact />
          ))}
        </div>
      )}
    </div>
  );
}
