import {
  CheckCircle2,
  HandCoins,
  Pause,
  PiggyBank,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Tags,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Field';
import { Label } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import type { Category, CategoryKind } from '@/db/schema';
import { describeRule } from '@/features/tasks/recurrence';
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
import { budgetLevel } from '../finance-utils';
import { CategoryIcon } from '../components/CategoryIcon';
import { BudgetDialog, DebtDialog, RecurringDialog } from '../components/PlanningDialogs';
import { CategoryDialog, WalletDialog } from '../components/WalletCategoryDialogs';
import { useFinanceActions } from '../finance-actions';
import { iconOf, WALLET_TYPES } from '../finance-icons';
import {
  useBudgets,
  useCategories,
  useDebts,
  usePeriodTotals,
  useRecurringTransactions,
  useWallets,
  type BudgetStatus,
  type DebtRow,
  type RecurringRow,
  type WalletWithBalance,
} from '../finance-queries';
import { DueRecurring } from './OverviewTab';

// ============================================================================ Anggaran
export function BudgetTab({ month }: { month: LocalDate }) {
  const last = monthEnd(month);
  const budgets = useBudgets(month, last);
  const totals = usePeriodTotals(month, last);
  const [dialog, setDialog] = useState<{ open: boolean; budget: BudgetStatus | null }>({
    open: false,
    budget: null,
  });
  const used = useMemo(() => new Set(budgets.map((b) => b.category_id ?? '')), [budgets]);
  const warn = budgets.filter((b) => budgetLevel(b) !== 'ok').length;

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div>
          <CardTitle>Anggaran {formatLocalDate(month, 'MMMM')}</CardTitle>
          <CardDescription>
            Total pengeluaran {formatIDR(totals.expense)}
            {warn > 0 && <span className="text-warning"> · {warn} perlu perhatian</span>}
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true, budget: null })}>
          <Plus /> Anggaran
        </Button>
      </CardHeader>
      {budgets.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          gradient="bg-gradient-finance"
          title="Belum ada anggaran"
          description="Tetapkan batas belanja bulanan per kategori. Kamu akan diberi tanda saat mendekati batas."
        />
      ) : (
        <div className="space-y-1">
          {budgets.map((b) => (
            <BudgetBar key={b.id} budget={b} onClick={() => setDialog({ open: true, budget: b })} />
          ))}
        </div>
      )}
      <BudgetDialog
        open={dialog.open}
        budget={dialog.budget}
        month={month}
        usedCategoryIds={used}
        onClose={() => setDialog({ open: false, budget: null })}
      />
    </Card>
  );
}

// ============================================================================ Berulang
export function RecurringTab() {
  const today = todayLocal();
  const items = useRecurringTransactions();
  const actions = useFinanceActions();
  const [dialog, setDialog] = useState<{ open: boolean; item: RecurringRow | null }>({
    open: false,
    item: null,
  });
  const monthly = items
    .filter((r) => r.is_active && r.kind !== 'transfer' && /FREQ=MONTHLY;INTERVAL=1/.test(r.rrule))
    .reduce((s, r) => s + (r.kind === 'expense' ? -r.amount : r.amount), 0);

  return (
    <div className="space-y-5">
      <DueRecurring today={today} />
      <Card className="animate-fade-up">
        <CardHeader>
          <div>
            <CardTitle>Transaksi berulang</CardTitle>
            <CardDescription>
              Langganan, tagihan, dan gaji
              {monthly !== 0 &&
                ` · bulanan bersih ${monthly > 0 ? '+' : '−'}${formatIDR(Math.abs(monthly))}`}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setDialog({ open: true, item: null })}>
            <Plus /> Baru
          </Button>
        </CardHeader>
        {items.length === 0 ? (
          <EmptyState
            icon={Repeat}
            gradient="bg-gradient-finance"
            title="Belum ada transaksi berulang"
            description="Contoh: Netflix tiap tgl 5, listrik tiap tgl 20, gaji tiap tgl 25."
          />
        ) : (
          <ul className="space-y-1">
            {items.map((r) => (
              <li
                key={r.id}
                className={cn(
                  'flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface',
                  !r.is_active && 'opacity-60',
                )}
              >
                <button
                  type="button"
                  onClick={() => setDialog({ open: true, item: r })}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <CategoryIcon
                    icon={r.category_icon}
                    color={r.category_color}
                    size="md"
                    special={r.kind === 'transfer' ? 'transfer' : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{r.title}</span>
                      {r.auto_post === 1 && <Badge tone="brand">Otomatis</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {describeRule(r.rrule, r.start_on)} · {r.wallet_name}
                    </span>
                    <span className="block text-xs font-semibold text-primary">
                      {!r.is_active
                        ? 'Dijeda'
                        : r.next_run_on
                          ? `Berikutnya ${relativeDayLabel(r.next_run_on, today).toLowerCase()}`
                          : 'Seri selesai'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-bold tabular-nums',
                      r.kind === 'income'
                        ? 'text-success'
                        : r.kind === 'expense'
                          ? 'text-danger'
                          : 'text-muted',
                    )}
                  >
                    {formatIDR(r.amount)}
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={r.is_active ? 'Jeda' : 'Lanjutkan'}
                  onClick={() => void actions.setRecurringActive(r, !r.is_active)}
                >
                  {r.is_active ? <Pause /> : <Play />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RecurringDialog
        open={dialog.open}
        item={dialog.item}
        onClose={() => setDialog({ open: false, item: null })}
      />
    </div>
  );
}

// ============================================================================ Hutang
export function DebtTab() {
  const today = todayLocal();
  const debts = useDebts();
  const actions = useFinanceActions();
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState<DebtRow | null>(null);
  const active = debts.filter((d) => !d.settled_at);
  const lent = active.filter((d) => d.direction === 'lent').reduce((s, d) => s + d.amount, 0);
  const borrowed = active
    .filter((d) => d.direction === 'borrowed')
    .reduce((s, d) => s + d.amount, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Card className="animate-fade-up p-4">
          <p className="text-xs font-semibold text-muted">Piutang (orang berutang ke saya)</p>
          <p className="text-lg font-extrabold text-success tabular-nums">{formatIDR(lent)}</p>
        </Card>
        <Card className="animate-fade-up p-4">
          <p className="text-xs font-semibold text-muted">Hutang saya</p>
          <p className="text-lg font-extrabold text-danger tabular-nums">{formatIDR(borrowed)}</p>
        </Card>
      </div>
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>Hutang & piutang</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Catat
          </Button>
        </CardHeader>
        {debts.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            gradient="bg-gradient-finance"
            title="Tidak ada catatan"
            description="Catat uang yang kamu pinjamkan atau pinjam agar tidak lupa."
          />
        ) : (
          <ul className="space-y-1">
            {debts.map((d) => {
              const overdue = !d.settled_at && d.due_date && d.due_date < today;
              return (
                <li
                  key={d.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface',
                    d.settled_at && 'opacity-60',
                  )}
                >
                  <CategoryIcon icon={null} color={null} special="debt" size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {d.direction === 'lent'
                        ? `${d.counterparty} berutang ke saya`
                        : `Saya berutang ke ${d.counterparty}`}
                    </span>
                    <span className={cn('block text-xs', overdue ? 'text-danger' : 'text-muted')}>
                      {d.settled_at
                        ? 'Lunas'
                        : d.due_date
                          ? `Jatuh tempo ${relativeDayLabel(d.due_date, today).toLowerCase()}`
                          : 'Tanpa jatuh tempo'}
                      {d.note && ` · ${d.note}`}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      d.direction === 'lent' ? 'text-success' : 'text-danger',
                    )}
                  >
                    {formatIDR(d.amount)}
                  </span>
                  <span className="flex gap-1">
                    {d.settled_at ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void actions.unsettleDebt(d)}
                      >
                        <RotateCcw /> Batal lunas
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setSettling(d)}>
                        <CheckCircle2 /> Lunas
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Hapus"
                      className="text-danger"
                      onClick={() => {
                        if (window.confirm('Hapus catatan ini beserta transaksi dompet terkait?'))
                          void actions.removeDebt(d);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <DebtDialog open={open} onClose={() => setOpen(false)} />
      <SettleDialog debt={settling} onClose={() => setSettling(null)} />
    </div>
  );
}

function SettleDialog({ debt, onClose }: { debt: DebtRow | null; onClose: () => void }) {
  const { wallets } = useWallets(false);
  const actions = useFinanceActions();
  const [walletId, setWalletId] = useState('');
  return (
    <Sheet open={debt !== null} onClose={onClose} variant="center" title="Tandai lunas">
      {debt && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {debt.direction === 'lent'
              ? `${debt.counterparty} mengembalikan`
              : `Saya membayar ${debt.counterparty}`}{' '}
            <b className="text-fg">{formatIDR(debt.amount)}</b>.
          </p>
          <div>
            <Label htmlFor="s-wallet">
              {debt.direction === 'lent' ? 'Uang masuk ke' : 'Dibayar dari'}
            </Label>
            <Select id="s-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              <option value="">Tidak dicatat di dompet</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void actions.settleDebt(debt, walletId || null);
                setWalletId('');
                onClose();
              }}
            >
              <CheckCircle2 /> Lunas
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ============================================================================ Kelola
export function ManageTab() {
  const { wallets } = useWallets();
  const categories = useCategories();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [walletDialog, setWalletDialog] = useState<{
    open: boolean;
    wallet: WalletWithBalance | null;
  }>({ open: false, wallet: null });
  const [catDialog, setCatDialog] = useState<{
    open: boolean;
    category: (Category & { tx_count: number }) | null;
  }>({
    open: false,
    category: null,
  });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-mod-finance" /> Dompet
          </CardTitle>
          <Button size="sm" onClick={() => setWalletDialog({ open: true, wallet: null })}>
            <Plus /> Dompet
          </Button>
        </CardHeader>
        <ul className="space-y-1">
          {wallets.map((w) => {
            const Icon = iconOf(w.icon, 'wallet');
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setWalletDialog({ open: true, wallet: w })}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface',
                    w.is_archived && 'opacity-60',
                  )}
                >
                  <CategoryIcon icon={w.icon} color={w.color} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {w.name} {w.is_archived ? <Badge>Arsip</Badge> : null}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Icon className="size-3" />{' '}
                      {WALLET_TYPES.find((t) => t.value === w.type)?.label} · {w.tx_count} transaksi
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">{formatIDR(w.balance)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="size-4 text-mod-finance" /> Kategori
          </CardTitle>
          <Button size="sm" onClick={() => setCatDialog({ open: true, category: null })}>
            <Plus /> Kategori
          </Button>
        </CardHeader>
        <SegmentedControl<CategoryKind>
          label="Jenis kategori"
          className="mb-3"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Pengeluaran' },
            { value: 'income', label: 'Pemasukan' },
          ]}
        />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {categories
            .filter((c) => c.kind === kind)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCatDialog({ open: true, category: c })}
                className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center text-xs font-semibold hover:bg-surface"
              >
                <CategoryIcon icon={c.icon} color={c.color} size="md" />
                <span className="line-clamp-2">{c.name}</span>
              </button>
            ))}
        </div>
      </Card>

      <WalletDialog
        open={walletDialog.open}
        wallet={walletDialog.wallet}
        onClose={() => setWalletDialog({ open: false, wallet: null })}
      />
      <CategoryDialog
        open={catDialog.open}
        category={catDialog.category}
        defaultKind={kind}
        onClose={() => setCatDialog({ open: false, category: null })}
      />
    </div>
  );
}
