import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, Scale } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  formatLocalDate,
  monthEnd,
  relativeDayLabel,
  todayLocal,
  type LocalDate,
} from '@/lib/date';
import { formatIDR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { BudgetBar } from '../components/BudgetBar';
import { CategoryDonut, DailyBars } from '../components/Charts';
import { CategoryIcon } from '../components/CategoryIcon';
import { TransactionRow } from '../components/TransactionRow';
import { WalletStrip } from '../components/WalletStrip';
import { useFinanceActions } from '../finance-actions';
import {
  useBudgets,
  useCategoryBreakdown,
  useDailyTotals,
  usePeriodTotals,
  useRecurringTransactions,
  useTransactions,
  useWallets,
} from '../finance-queries';
import type { FinanceTab } from '../FinancePage';

export function OverviewTab({
  month,
  goTab,
}: {
  month: LocalDate;
  goTab: (t: FinanceTab, extra?: Record<string, string>) => void;
}) {
  const today = todayLocal();
  const last = monthEnd(month);
  const navigate = useNavigate();
  const { wallets } = useWallets();
  const totals = usePeriodTotals(month, last);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const slices = useCategoryBreakdown(month, last, kind);
  const daily = useDailyTotals(month, last);
  const budgets = useBudgets(month, last);
  const { rows: recent } = useTransactions({ from: month, to: last, limit: 6 });
  const totalBalance = wallets.reduce((s, w) => s + w.balance, 0);
  const net = totals.income - totals.expense;

  return (
    <div className="space-y-5">
      <Card className="animate-fade-up">
        <CardHeader className="mb-3">
          <div>
            <CardTitle>Saldo total</CardTitle>
            <CardDescription>
              {wallets.filter((w) => !w.is_archived).length} dompet aktif
            </CardDescription>
          </div>
          <p className="text-gradient-brand text-2xl font-extrabold tracking-tight tabular-nums sm:text-3xl">
            {formatIDR(totalBalance)}
          </p>
        </CardHeader>
        <WalletStrip wallets={wallets} onSelect={(id) => goTab('transaksi', { dompet: id })} />
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Pemasukan" value={totals.income} icon={ArrowDownLeft} tone="success" />
        <Stat label="Pengeluaran" value={totals.expense} icon={ArrowUpRight} tone="danger" />
        <Stat
          label="Selisih"
          value={net}
          icon={Scale}
          tone={net >= 0 ? 'success' : 'danger'}
          signed
        />
      </div>

      <DueRecurring today={today} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card className="animate-fade-up">
          <CardHeader>
            <div>
              <CardTitle>Per kategori</CardTitle>
              <CardDescription className="capitalize">
                {formatLocalDate(month, 'MMMM yyyy')}
              </CardDescription>
            </div>
            <SegmentedControl<'expense' | 'income'>
              label="Jenis"
              value={kind}
              onChange={setKind}
              className="w-48"
              options={[
                { value: 'expense', label: 'Keluar' },
                { value: 'income', label: 'Masuk' },
              ]}
            />
          </CardHeader>
          {slices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Belum ada data bulan ini.</p>
          ) : (
            <CategoryDonut
              slices={slices}
              total={kind === 'expense' ? totals.expense : totals.income}
              label={kind === 'expense' ? 'Pengeluaran' : 'Pemasukan'}
            />
          )}
        </Card>

        <div className="space-y-5">
          <Card className="animate-fade-up">
            <CardHeader className="mb-3">
              <div>
                <CardTitle>Pengeluaran harian</CardTitle>
                <CardDescription>
                  Rata-rata{' '}
                  {formatIDR(
                    Math.round(
                      totals.expense /
                        Math.max(
                          1,
                          month.slice(0, 7) === today.slice(0, 7)
                            ? Number(today.slice(8))
                            : Number(last.slice(8)),
                        ),
                    ),
                  )}
                  /hari
                </CardDescription>
              </div>
            </CardHeader>
            <DailyBars
              month={month}
              totals={daily}
              today={today}
              onSelect={(d) => navigate(`/kalender?tanggal=${d}`)}
            />
          </Card>

          <Card className="animate-fade-up">
            <CardHeader className="mb-2">
              <CardTitle>Anggaran</CardTitle>
              <button
                type="button"
                onClick={() => goTab('anggaran')}
                className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                Kelola <ArrowRight className="size-4" />
              </button>
            </CardHeader>
            {budgets.length === 0 ? (
              <p className="text-sm text-muted">
                Belum ada anggaran. Atur batas belanja per kategori di tab Anggaran.
              </p>
            ) : (
              budgets
                .slice(0, 4)
                .map((b) => <BudgetBar key={b.id} budget={b} onClick={() => goTab('anggaran')} />)
            )}
          </Card>
        </div>
      </div>

      <Card className="animate-fade-up">
        <CardHeader className="mb-2">
          <CardTitle>Transaksi terbaru</CardTitle>
          <button
            type="button"
            onClick={() => goTab('transaksi')}
            className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            Semua <ArrowRight className="size-4" />
          </button>
        </CardHeader>
        {recent.length === 0 ? (
          <EmptyState
            icon={ArrowUpRight}
            gradient="bg-gradient-finance"
            title="Belum ada transaksi bulan ini"
            description='Tekan tombol + untuk mencatat. Nominal bisa ditulis "25rb" atau "1,5jt".'
            className="py-6"
          />
        ) : (
          recent.map((t) => <TransactionRow key={t.id} tx={t} />)
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
  signed,
}: {
  label: string;
  value: number;
  icon: typeof Scale;
  tone: 'success' | 'danger';
  signed?: boolean;
}) {
  return (
    <Card className="flex animate-fade-up items-center gap-3 p-4">
      <span
        className={cn(
          'shine flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md',
          tone === 'success'
            ? 'bg-gradient-finance'
            : 'bg-linear-to-br from-rose-500 to-orange-500',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-muted">{label}</span>
        <span
          className={cn(
            'block truncate text-lg font-extrabold tracking-tight tabular-nums',
            tone === 'success' ? 'text-success' : 'text-danger',
          )}
        >
          {signed && value > 0 ? '+' : ''}
          {formatIDR(value)}
        </span>
      </span>
    </Card>
  );
}

/** Tagihan berulang manual (auto_post = 0) yang sudah jatuh tempo. */
export function DueRecurring({ today }: { today: LocalDate }) {
  const items = useRecurringTransactions().filter(
    (r) =>
      r.is_active === 1 && r.auto_post === 0 && r.next_run_on !== null && r.next_run_on <= today,
  );
  const actions = useFinanceActions();
  if (items.length === 0) return null;

  return (
    <Card className="animate-fade-up border-warning/40">
      <CardHeader className="mb-2">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-warning" /> Jatuh tempo
        </CardTitle>
        <CardDescription>{items.length} tagihan menunggu konfirmasi</CardDescription>
      </CardHeader>
      <ul className="space-y-1">
        {items.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface"
          >
            <CategoryIcon
              icon={r.category_icon}
              color={r.category_color}
              size="sm"
              special={r.kind === 'transfer' ? 'transfer' : undefined}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{r.title}</span>
              <span
                className={cn('text-xs', r.next_run_on! < today ? 'text-danger' : 'text-muted')}
              >
                {relativeDayLabel(r.next_run_on!, today)} · {formatIDR(r.amount)}
              </span>
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => void actions.skipOccurrence(r)}>
                Lewati
              </Button>
              <Button size="sm" onClick={() => void actions.postOccurrence(r)}>
                Catat
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
