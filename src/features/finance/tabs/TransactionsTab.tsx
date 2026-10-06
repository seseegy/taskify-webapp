import { Download, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Field';
import { toast } from '@/components/ui/toast-store';
import type { TransactionKind } from '@/db/schema';
import { downloadCsv, toCsv } from '@/lib/csv';
import {
  monthEnd,
  relativeDayLabel,
  shortTime,
  todayLocal,
  formatLocalDate,
  type LocalDate,
} from '@/lib/date';
import { formatIDR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { TransactionRow } from '../components/TransactionRow';
import { txTitle } from '../finance-utils';
import { useCategories, useTransactions, useWallets, type TxRow } from '../finance-queries';

const KIND_LABEL: Record<TransactionKind, string> = {
  income: 'Pemasukan',
  expense: 'Pengeluaran',
  transfer: 'Transfer',
};

export function TransactionsTab({
  month,
  walletId,
  onWallet,
}: {
  month: LocalDate;
  walletId: string | null;
  onWallet: (id: string | null) => void;
}) {
  const today = todayLocal();
  const [kind, setKind] = useState<TransactionKind | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const { wallets } = useWallets();
  const categories = useCategories();

  const { rows, isLoading } = useTransactions({
    from: month,
    to: monthEnd(month),
    kind: kind || null,
    walletId,
    categoryId: categoryId || null,
    search,
  });

  const groups = useMemo(() => {
    const map = new Map<LocalDate, TxRow[]>();
    for (const r of rows) map.set(r.occurred_on, [...(map.get(r.occurred_on) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  const exportCsv = () => {
    if (rows.length === 0) return toast('Tidak ada transaksi untuk diekspor');
    const csv = toCsv(
      [
        'Tanggal',
        'Jam',
        'Jenis',
        'Keterangan',
        'Kategori',
        'Dompet',
        'Dompet tujuan',
        'Nominal',
        'Catatan',
      ],
      rows.map((r) => [
        r.occurred_on,
        shortTime(r.occurred_time),
        KIND_LABEL[r.kind],
        txTitle(r),
        r.category_name,
        r.wallet_name,
        r.to_wallet_name,
        r.kind === 'expense' ? -r.amount : r.amount,
        r.note,
      ]),
    );
    downloadCsv(`taskify-transaksi-${month.slice(0, 7)}.csv`, csv);
  };

  const filtered = Boolean(kind || categoryId || walletId || search);

  return (
    <Card className="animate-fade-up p-3 sm:p-5">
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <label className="col-span-2 flex h-11 items-center gap-2 rounded-xl px-3 glass sm:col-span-1">
          <Search className="size-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari keterangan, catatan, kategori…"
            aria-label="Cari transaksi"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
          />
        </label>
        <Select
          aria-label="Jenis"
          value={kind}
          onChange={(e) => setKind(e.target.value as TransactionKind | '')}
        >
          <option value="">Semua jenis</option>
          <option value="expense">Pengeluaran</option>
          <option value="income">Pemasukan</option>
          <option value="transfer">Transfer</option>
        </Select>
        <Select
          aria-label="Dompet"
          value={walletId ?? ''}
          onChange={(e) => onWallet(e.target.value || null)}
        >
          <option value="">Semua dompet</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Kategori"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kind === 'income' ? '↓ ' : '↑ '}
              {c.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={exportCsv} className="h-11">
          <Download /> CSV
        </Button>
      </div>

      {filtered && (
        <button
          type="button"
          onClick={() => {
            setKind('');
            setCategoryId('');
            setSearch('');
            onWallet(null);
          }}
          className="mb-3 inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted hover:text-fg"
        >
          <X className="size-3" /> Hapus filter · {rows.length} transaksi
        </button>
      )}

      {!isLoading && rows.length === 0 && (
        <EmptyState
          icon={Search}
          gradient="bg-gradient-finance"
          title={filtered ? 'Tidak ada yang cocok' : 'Belum ada transaksi'}
          description={
            filtered
              ? 'Coba ubah filter.'
              : `Tidak ada transaksi di ${formatLocalDate(month, 'MMMM yyyy')}.`
          }
        />
      )}

      <div className="space-y-5">
        {groups.map(([day, items]) => {
          const net = items.reduce(
            (s, t) => s + (t.kind === 'income' ? t.amount : t.kind === 'expense' ? -t.amount : 0),
            0,
          );
          return (
            <section key={day}>
              <h3 className="mb-1 flex items-center justify-between px-3 text-xs font-bold tracking-wide text-muted uppercase">
                <span>
                  {relativeDayLabel(day, today)} · {formatLocalDate(day, 'd MMM')}
                </span>
                <span
                  className={cn(
                    'normal-case tabular-nums',
                    net > 0 ? 'text-success' : net < 0 ? 'text-danger' : '',
                  )}
                >
                  {net > 0 ? '+' : net < 0 ? '−' : ''}
                  {formatIDR(Math.abs(net))}
                </span>
              </h3>
              <div className="space-y-0.5">
                {items.map((t) => (
                  <TransactionRow key={t.id} tx={t} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
