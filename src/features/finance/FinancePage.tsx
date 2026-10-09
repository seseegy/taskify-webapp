import {
  BarChart3,
  HandCoins,
  List,
  PiggyBank,
  Plus,
  Repeat,
  Settings2,
  Wallet,
} from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { monthStart, type LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { MonthSwitcher } from './components/Pickers';
import { usePeriodTotals } from './finance-queries';
import { OverviewTab } from './tabs/OverviewTab';
import { BudgetTab, DebtTab, ManageTab, RecurringTab } from './tabs/PlanningTabs';
import { TransactionsTab } from './tabs/TransactionsTab';
import { useTxSheet } from './tx-sheet-store';
import { formatIDR } from '@/lib/money';
import { monthEnd } from '@/lib/date';
import { useToday } from '@/lib/useToday';

export type FinanceTab = 'ringkasan' | 'transaksi' | 'anggaran' | 'berulang' | 'hutang' | 'kelola';

const TABS: { value: FinanceTab; label: string; icon: typeof Wallet; monthly?: boolean }[] = [
  { value: 'ringkasan', label: 'Ringkasan', icon: BarChart3, monthly: true },
  { value: 'transaksi', label: 'Transaksi', icon: List, monthly: true },
  { value: 'anggaran', label: 'Anggaran', icon: PiggyBank, monthly: true },
  { value: 'berulang', label: 'Berulang', icon: Repeat },
  { value: 'hutang', label: 'Hutang', icon: HandCoins },
  { value: 'kelola', label: 'Kelola', icon: Settings2 },
];

export function FinancePage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get('tab'))?.value ?? 'ringkasan';
  const today = useToday();
  const rawMonth = params.get('bulan');
  const month: LocalDate =
    rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? `${rawMonth}-01` : monthStart(today);
  const walletId = params.get('dompet');
  const createTx = useTxSheet((s) => s.create);
  const totals = usePeriodTotals(month, monthEnd(month));

  /**
   * Memberi tahu tumpukan bawah bahwa halaman ini punya tombol melayang, supaya Toaster &
   * UpdatePrompt menyingkir ke atasnya (lihat `--fab-h` di styles/index.css).
   *
   * Penandanya di `documentElement`, BUKAN di body: `--stack-bottom-overlay` dideklarasikan
   * di `:root`, dan `var()` di dalam nilai custom property memakai nilai pada elemen tempat
   * ia dideklarasikan — penanda di body tidak akan terbaca. Berapa tinggi yang dipakai (dan
   * kapan jadi nol di layar lebar) diputuskan CSS, bukan di sini.
   */
  useEffect(() => {
    document.documentElement.dataset.fab = 'finance';
    return () => {
      delete document.documentElement.dataset.fab;
    };
  }, []);

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true },
    );

  const goTab = (t: FinanceTab, extra: Record<string, string> = {}) =>
    update({ tab: t, dompet: null, ...extra });
  const current = TABS.find((t) => t.value === tab)!;

  return (
    <>
      <PageHeader
        title="Keuangan"
        subtitle={`Bulan ini: keluar ${formatIDR(totals.expense)} · masuk ${formatIDR(totals.income)}`}
        icon={Wallet}
        gradient="bg-gradient-finance"
        actions={
          <Button
            className="hidden sm:inline-flex"
            onClick={() => createTx({ walletId: walletId ?? undefined })}
          >
            <Plus /> Transaksi
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Bagian keuangan"
          className="-mx-1 flex max-w-full gap-1 overflow-x-auto rounded-2xl p-1 glass"
        >
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-current={tab === t.value ? 'page' : undefined}
              onClick={() => goTab(t.value)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap transition',
                tab === t.value
                  ? 'shine bg-gradient-finance text-white shadow-md'
                  : 'text-muted hover:text-fg',
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </nav>
        {current.monthly && (
          <MonthSwitcher month={month} onChange={(m) => update({ bulan: m.slice(0, 7) })} />
        )}
      </div>

      {tab === 'ringkasan' && <OverviewTab month={month} goTab={goTab} />}
      {tab === 'transaksi' && (
        <TransactionsTab
          month={month}
          walletId={walletId}
          onWallet={(id) => update({ dompet: id })}
        />
      )}
      {tab === 'anggaran' && <BudgetTab month={month} />}
      {tab === 'berulang' && <RecurringTab />}
      {tab === 'hutang' && <DebtTab />}
      {tab === 'kelola' && <ManageTab />}

      {/* Tombol tambah melayang (HP). Posisinya dari `--stack-bottom` (styles/index.css),
          jadi ia otomatis naik saat bilah musik terlihat. */}
      <button
        type="button"
        aria-label="Catat transaksi"
        onClick={() => createTx({ walletId: walletId ?? undefined })}
        className="shine fixed right-5 bottom-[var(--stack-bottom)] z-20 flex size-14 items-center justify-center rounded-2xl bg-gradient-finance text-white shadow-xl shadow-emerald-500/30 transition active:scale-95 sm:hidden"
      >
        <Plus className="size-6" />
      </button>
    </>
  );
}
