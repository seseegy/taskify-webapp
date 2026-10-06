import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Field';
import { Input, Label } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/toast-store';
import type { TransactionKind } from '@/db/schema';
import { shortTime, todayLocal } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useFinanceActions } from '../finance-actions';
import { useCategories, useTransaction, useWallets, type TxRow } from '../finance-queries';
import { useTxSheet, type TxSheetDefaults } from '../tx-sheet-store';
import { CategoryIcon } from './CategoryIcon';
import { MoneyInput } from './MoneyInput';

const LAST_WALLET_KEY = 'taskify-last-wallet';

/** Form tambah/ubah transaksi (dipasang sekali di AppShell). */
export function TransactionSheet() {
  const { open, txId, defaults, nonce, close } = useTxSheet();
  const tx = useTransaction(txId);
  const loading = txId !== null && !tx;

  return (
    <Sheet
      open={open && !loading}
      onClose={close}
      title={txId ? 'Ubah transaksi' : 'Transaksi baru'}
    >
      {open && !loading && (
        <TxForm key={`${nonce}-${tx?.id ?? 'new'}`} tx={tx} defaults={defaults} onDone={close} />
      )}
    </Sheet>
  );
}

function TxForm({
  tx,
  defaults,
  onDone,
}: {
  tx?: TxRow;
  defaults: TxSheetDefaults;
  onDone: () => void;
}) {
  const actions = useFinanceActions();
  const { wallets: all } = useWallets(true);
  const wallets = all.filter((w) => w.is_archived === 0);
  // Saat mengedit, dompet arsip yang dipakai transaksi tetap muncul di pilihan
  const walletOptions = all.filter(
    (w) => w.is_archived === 0 || w.id === tx?.wallet_id || w.id === tx?.to_wallet_id,
  );
  const lastWallet = localStorage.getItem(LAST_WALLET_KEY);
  const defaultWallet =
    defaults.walletId ?? (wallets.find((w) => w.id === lastWallet) ?? wallets[0])?.id ?? '';

  const [kind, setKind] = useState<TransactionKind>(tx?.kind ?? defaults.kind ?? 'expense');
  const [amount, setAmount] = useState<number | null>(tx?.amount ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(
    tx?.category_id ?? defaults.categoryId ?? null,
  );
  const [walletChoice, setWalletId] = useState(tx?.wallet_id ?? '');
  // Dompet default dihitung tiap render (data dompet bisa baru dimuat setelah form terbuka)
  const walletId = walletChoice || defaultWallet;
  const [toWalletId, setToWalletId] = useState(tx?.to_wallet_id ?? '');
  const [date, setDate] = useState(tx?.occurred_on ?? defaults.date ?? todayLocal());
  const [time, setTime] = useState(shortTime(tx?.occurred_time));
  const [title, setTitle] = useState(tx?.title ?? '');
  const [note, setNote] = useState(tx?.note ?? '');
  const [saving, setSaving] = useState(false);

  const categoryList = useCategories(kind === 'income' ? 'income' : 'expense');
  const categories = kind === 'transfer' ? [] : categoryList;

  const changeKind = (k: TransactionKind) => {
    setKind(k);
    setCategoryId(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0) return toast('Isi nominal terlebih dahulu', { tone: 'danger' });
    if (!walletId) return toast('Pilih dompet', { tone: 'danger' });
    setSaving(true);
    try {
      const input = {
        kind,
        amount,
        wallet_id: walletId,
        to_wallet_id: toWalletId || null,
        category_id: categoryId,
        occurred_on: date,
        occurred_time: time || null,
        title,
        note,
      };
      if (tx) await actions.updateTx(tx.id, input);
      else await actions.createTx(input);
      localStorage.setItem(LAST_WALLET_KEY, walletId);
      toast(tx ? 'Transaksi diperbarui' : 'Transaksi dicatat', { tone: 'success' });
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  if (wallets.length === 0 && !tx) {
    return (
      <p className="text-sm text-muted">Belum ada dompet. Buat dompet dulu di Keuangan → Kelola.</p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SegmentedControl<TransactionKind>
        label="Jenis transaksi"
        value={kind}
        onChange={changeKind}
        options={[
          { value: 'expense', label: 'Keluar', icon: <ArrowUpRight /> },
          { value: 'income', label: 'Masuk', icon: <ArrowDownLeft /> },
          { value: 'transfer', label: 'Transfer', icon: <ArrowLeftRight /> },
        ]}
      />

      <MoneyInput value={amount} onChange={setAmount} size="lg" autoFocus={!tx} tone={kind} />

      {kind !== 'transfer' && (
        <div>
          <Label>Kategori</Label>
          <div
            className="grid grid-cols-4 gap-2 sm:grid-cols-5"
            role="radiogroup"
            aria-label="Kategori"
          >
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={categoryId === c.id}
                onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center text-[11px] leading-tight font-semibold transition',
                  categoryId === c.id ? 'ring-2 glass-strong ring-primary/60' : 'hover:bg-surface',
                )}
              >
                <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                <span className="line-clamp-2">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={cn('grid gap-3', kind === 'transfer' && 'grid-cols-2')}>
        <div>
          <Label htmlFor="tx-wallet">{kind === 'transfer' ? 'Dari' : 'Dompet'}</Label>
          <Select id="tx-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {walletOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        {kind === 'transfer' && (
          <div>
            <Label htmlFor="tx-to">Ke</Label>
            <Select id="tx-to" value={toWalletId} onChange={(e) => setToWalletId(e.target.value)}>
              <option value="">Pilih…</option>
              {walletOptions
                .filter((w) => w.id !== walletId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <Label htmlFor="tx-date">Tanggal</Label>
          <Input
            id="tx-date"
            type="date"
            value={date}
            required
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="tx-time">Jam</Label>
          <Input
            id="tx-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-32"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="tx-title">Keterangan</Label>
        <Input
          id="tx-title"
          value={title}
          maxLength={120}
          placeholder={
            kind === 'expense'
              ? 'mis. Makan siang'
              : kind === 'income'
                ? 'mis. Gaji Oktober'
                : 'mis. Isi saldo'
          }
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="tx-note">Catatan</Label>
        <Textarea
          id="tx-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-16"
        />
      </div>

      {tx?.debt_id && (
        <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
          Transaksi ini tercatat dari Hutang/Piutang. Perubahan di sini tidak mengubah catatan
          hutangnya.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {tx ? (
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => {
              void actions.removeTx(tx.id);
              onDone();
            }}
          >
            <Trash2 /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={saving} disabled={!amount}>
          {tx ? 'Simpan' : 'Catat'}
        </Button>
      </div>
    </form>
  );
}
