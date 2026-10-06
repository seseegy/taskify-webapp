import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Field';
import { Input, Label } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/toast-store';
import type { TransactionKind } from '@/db/schema';
import { RecurrenceEditor } from '@/features/tasks/components/RecurrenceEditor';
import { buildRule, describeRule } from '@/features/tasks/recurrence';
import { todayLocal, type LocalDate } from '@/lib/date';
import { useFinanceActions } from '../finance-actions';
import {
  useCategories,
  useWallets,
  type BudgetStatus,
  type RecurringRow,
} from '../finance-queries';
import { MoneyInput } from './MoneyInput';

const errorToast = (e: unknown) =>
  toast(e instanceof Error ? e.message : String(e), { tone: 'danger' });

// ------------------------------------------------------------------ Anggaran
export function BudgetDialog({
  open,
  budget,
  month,
  usedCategoryIds,
  onClose,
}: {
  open: boolean;
  budget: BudgetStatus | null;
  month: LocalDate;
  usedCategoryIds: Set<string>;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      title={budget ? 'Ubah anggaran' : 'Anggaran baru'}
    >
      {open && (
        <BudgetForm
          key={budget?.id ?? 'new'}
          budget={budget}
          month={month}
          used={usedCategoryIds}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function BudgetForm({
  budget,
  month,
  used,
  onClose,
}: {
  budget: BudgetStatus | null;
  month: LocalDate;
  used: Set<string>;
  onClose: () => void;
}) {
  const actions = useFinanceActions();
  const categories = useCategories('expense');
  const [categoryId, setCategoryId] = useState(budget ? (budget.category_id ?? '') : '');
  const [amount, setAmount] = useState<number | null>(budget?.amount ?? null);
  const [alertPct, setAlertPct] = useState(budget?.alert_pct ?? 80);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await actions.saveBudget({
        id: budget?.id,
        category_id: categoryId || null,
        amount: amount ?? 0,
        alert_pct: alertPct,
        start_month: month,
      });
      onClose();
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="b-cat">Untuk</Label>
        <Select
          id="b-cat"
          value={categoryId}
          disabled={!!budget}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="" disabled={!budget && used.has('')}>
            Total semua pengeluaran
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id} disabled={!budget && used.has(c.id)}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="b-amount">Batas per bulan</Label>
        <MoneyInput id="b-amount" value={amount} onChange={setAmount} autoFocus />
      </div>
      <div>
        <Label htmlFor="b-alert">Peringatan saat terpakai {alertPct}%</Label>
        <input
          id="b-alert"
          type="range"
          min={50}
          max={100}
          step={5}
          value={alertPct}
          onChange={(e) => setAlertPct(Number(e.target.value))}
          className="w-full accent-violet-500"
        />
      </div>
      <p className="text-xs text-muted">Berlaku mulai bulan ini dan seterusnya.</p>
      <div className="flex items-center justify-between gap-2">
        {budget ? (
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => {
              void actions.removeBudget(budget.id);
              onClose();
            }}
          >
            <Trash2 /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!amount}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ Berulang
export function RecurringDialog({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: RecurringRow | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item ? 'Ubah transaksi berulang' : 'Transaksi berulang baru'}
    >
      {open && <RecurringForm key={item?.id ?? 'new'} item={item} onClose={onClose} />}
    </Sheet>
  );
}

function RecurringForm({ item, onClose }: { item: RecurringRow | null; onClose: () => void }) {
  const actions = useFinanceActions();
  const { wallets: all } = useWallets(true);
  const wallets = all.filter(
    (w) => w.is_archived === 0 || w.id === item?.wallet_id || w.id === item?.to_wallet_id,
  );
  const [kind, setKind] = useState<TransactionKind>(item?.kind ?? 'expense');
  const categories = useCategories(kind === 'income' ? 'income' : 'expense');
  const [title, setTitle] = useState(item?.title ?? '');
  const [amount, setAmount] = useState<number | null>(item?.amount ?? null);
  const [walletChoice, setWalletId] = useState(item?.wallet_id ?? '');
  const walletId = walletChoice || wallets[0]?.id || '';
  const [toWalletId, setToWalletId] = useState(item?.to_wallet_id ?? '');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '');
  const [startOn, setStartOn] = useState<LocalDate>(item?.start_on ?? todayLocal());
  const [rrule, setRrule] = useState<string | null>(
    item?.rrule ??
      buildRule({ freq: 'monthly', interval: 1, byDay: [], until: null }, todayLocal()),
  );
  const [autoPost, setAutoPost] = useState(item ? item.auto_post === 1 : false);
  const [note, setNote] = useState(item?.note ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rrule) return toast('Pilih pola pengulangan', { tone: 'danger' });
    if (!title.trim()) return toast('Isi nama', { tone: 'danger' });
    const until = rrule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/);
    try {
      await actions.saveRecurring({
        id: item?.id,
        kind,
        amount: amount ?? 0,
        wallet_id: walletId,
        to_wallet_id: kind === 'transfer' ? toWalletId || null : null,
        category_id: kind === 'transfer' ? null : categoryId || null,
        title,
        note,
        rrule,
        start_on: startOn,
        end_on: until ? `${until[1]}-${until[2]}-${until[3]}` : null,
        auto_post: autoPost,
      });
      toast('Tersimpan', { tone: 'success' });
      onClose();
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <SegmentedControl<TransactionKind>
        label="Jenis"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategoryId('');
        }}
        options={[
          { value: 'expense', label: 'Keluar' },
          { value: 'income', label: 'Masuk' },
          { value: 'transfer', label: 'Transfer' },
        ]}
      />
      <div>
        <Label htmlFor="r-title">Nama</Label>
        <Input
          id="r-title"
          value={title}
          maxLength={120}
          placeholder="mis. Netflix, Listrik, Gaji"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="r-amount">Nominal</Label>
        <MoneyInput id="r-amount" value={amount} onChange={setAmount} tone={kind} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="r-wallet">{kind === 'transfer' ? 'Dari' : 'Dompet'}</Label>
          <Select id="r-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        {kind === 'transfer' ? (
          <div>
            <Label htmlFor="r-to">Ke</Label>
            <Select id="r-to" value={toWalletId} onChange={(e) => setToWalletId(e.target.value)}>
              <option value="">Pilih…</option>
              {wallets
                .filter((w) => w.id !== walletId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
          </div>
        ) : (
          <div>
            <Label htmlFor="r-cat">Kategori</Label>
            <Select id="r-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Tanpa kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="r-start">Mulai</Label>
        <Input
          id="r-start"
          type="date"
          value={startOn}
          onChange={(e) => {
            if (!e.target.value) return;
            setStartOn(e.target.value);
            // Bulanan/tahunan ikut tanggal mulai
            if (rrule && /FREQ=(MONTHLY|YEARLY)/.test(rrule)) {
              setRrule(
                buildRule(
                  {
                    freq: rrule.includes('MONTHLY') ? 'monthly' : 'yearly',
                    interval: Number(rrule.match(/INTERVAL=(\d+)/)?.[1] ?? 1),
                    byDay: [],
                    until: null,
                  },
                  e.target.value,
                ),
              );
            }
          }}
        />
      </div>
      <div>
        <Label>Pengulangan</Label>
        <RecurrenceEditor rule={rrule} anchor={startOn} onChange={setRrule} />
        {!rrule && <p className="mt-1 text-xs text-danger">Pilih pola pengulangan.</p>}
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 glass">
        <input
          type="checkbox"
          checked={autoPost}
          onChange={(e) => setAutoPost(e.target.checked)}
          className="mt-0.5 size-4 accent-violet-500"
        />
        <span className="text-sm">
          <span className="font-semibold">Catat otomatis</span>
          <span className="block text-xs text-muted">
            Aktif: langsung tercatat saat jatuh tempo (cocok untuk gaji, langganan tetap). Nonaktif:
            muncul di &ldquo;Jatuh tempo&rdquo; untuk dikonfirmasi dulu.
          </span>
        </span>
      </label>
      <div>
        <Label htmlFor="r-note">Catatan</Label>
        <Textarea
          id="r-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-16"
        />
      </div>
      {rrule && (
        <p className="text-xs font-semibold text-primary">{describeRule(rrule, startOn)}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        {item ? (
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => {
              if (
                !window.confirm(`Hapus "${item.title}"? Transaksi yang sudah tercatat tetap ada.`)
              )
                return;
              void actions.removeRecurring(item.id);
              onClose();
            }}
          >
            <Trash2 /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!amount || !title.trim()}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ Hutang / piutang
export function DebtDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} variant="center" title="Catat hutang / piutang">
      {open && <DebtForm onClose={onClose} />}
    </Sheet>
  );
}

function DebtForm({ onClose }: { onClose: () => void }) {
  const actions = useFinanceActions();
  const { wallets: all } = useWallets(false);
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [counterparty, setCounterparty] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [walletId, setWalletId] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await actions.createDebt({
        direction,
        counterparty,
        amount: amount ?? 0,
        due_date: dueDate || null,
        note,
        wallet_id: walletId || null,
      });
      toast('Tercatat', { tone: 'success' });
      onClose();
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <SegmentedControl<'lent' | 'borrowed'>
        label="Arah"
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'lent', label: 'Saya meminjamkan' },
          { value: 'borrowed', label: 'Saya meminjam' },
        ]}
      />
      <div>
        <Label htmlFor="d-who">{direction === 'lent' ? 'Dipinjam oleh' : 'Pinjam dari'}</Label>
        <Input
          id="d-who"
          value={counterparty}
          maxLength={100}
          autoFocus
          onChange={(e) => setCounterparty(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="d-amount">Nominal</Label>
        <MoneyInput id="d-amount" value={amount} onChange={setAmount} />
      </div>
      <div>
        <Label htmlFor="d-due">Jatuh tempo (opsional)</Label>
        <Input
          id="d-due"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="d-wallet">Catat perpindahan uang di dompet</Label>
        <Select id="d-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
          <option value="">Tidak (hanya catatan)</option>
          {all.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="d-note">Catatan</Label>
        <Textarea
          id="d-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-16"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!amount || !counterparty.trim()}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
