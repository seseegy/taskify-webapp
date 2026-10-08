import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Listbox } from '@/components/ui/Listbox';
import { Input, Label } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/toast-store';
import type { Category, CategoryKind, WalletType } from '@/db/schema';
import { useFinanceActions } from '../finance-actions';
import { WALLET_TYPES } from '../finance-icons';
import type { WalletWithBalance } from '../finance-queries';
import { CategoryIcon } from './CategoryIcon';
import { MoneyInput } from './MoneyInput';
import { ColorPicker, IconPicker } from './Pickers';
import { askConfirm } from '@/components/ui/confirm-store';

// ------------------------------------------------------------------ Dompet
export function WalletDialog({
  open,
  wallet,
  onClose,
}: {
  open: boolean;
  wallet: WalletWithBalance | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      title={wallet ? 'Ubah dompet' : 'Dompet baru'}
    >
      {open && <WalletForm key={wallet?.id ?? 'new'} wallet={wallet} onClose={onClose} />}
    </Sheet>
  );
}

function WalletForm({
  wallet,
  onClose,
}: {
  wallet: WalletWithBalance | null;
  onClose: () => void;
}) {
  const actions = useFinanceActions();
  const [name, setName] = useState(wallet?.name ?? '');
  const [type, setType] = useState<WalletType>(wallet?.type ?? 'cash');
  const [initial, setInitial] = useState<number | null>(wallet?.initial_balance ?? 0);
  const [color, setColor] = useState(wallet?.color ?? 'emerald');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const icon = WALLET_TYPES.find((t) => t.value === type)!.icon;
    const values = { name: name.trim(), type, initial_balance: initial ?? 0, color, icon };
    if (wallet) await actions.updateWallet(wallet.id, values);
    else await actions.createWallet(values);
    onClose();
  };

  const archive = async () => {
    if (!wallet) return;
    await actions.updateWallet(wallet.id, { is_archived: wallet.is_archived ? 0 : 1 });
    toast(wallet.is_archived ? 'Dompet diaktifkan lagi' : 'Dompet diarsipkan');
    onClose();
  };

  const remove = async () => {
    if (!wallet) return;
    const ok = await askConfirm({
      title: `Hapus dompet "${wallet.name}"?`,
      confirmLabel: 'Hapus',
    });
    if (!ok) return;
    await actions.removeWallet(wallet.id);
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="w-name">Nama</Label>
        <Input
          id="w-name"
          value={name}
          maxLength={60}
          data-autofocus
          placeholder="mis. BCA, GoPay, Dompet"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="w-type">Jenis</Label>
        <Listbox
          id="w-type"
          value={type}
          onChange={(v) => setType(v as WalletType)}
          options={WALLET_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>
      <div>
        <Label htmlFor="w-initial">Saldo awal</Label>
        <MoneyInput id="w-initial" value={initial} onChange={setInitial} />
      </div>
      <div>
        <Label>Warna</Label>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex gap-1">
          {wallet &&
            (wallet.tx_count === 0 ? (
              <Button variant="ghost" className="text-danger" onClick={() => void remove()}>
                <Trash2 /> Hapus
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => void archive()}
                title="Dompet yang punya transaksi hanya bisa diarsipkan"
              >
                {wallet.is_archived ? <ArchiveRestore /> : <Archive />}
                {wallet.is_archived ? 'Aktifkan' : 'Arsipkan'}
              </Button>
            ))}
        </div>
        <Button type="submit" disabled={!name.trim()}>
          {wallet ? 'Simpan' : 'Buat dompet'}
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ Kategori
export function CategoryDialog({
  open,
  category,
  defaultKind,
  onClose,
}: {
  open: boolean;
  category: (Category & { tx_count: number }) | null;
  defaultKind: CategoryKind;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      title={category ? 'Ubah kategori' : 'Kategori baru'}
    >
      {open && (
        <CategoryForm
          key={category?.id ?? 'new'}
          category={category}
          defaultKind={defaultKind}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function CategoryForm({
  category,
  defaultKind,
  onClose,
}: {
  category: (Category & { tx_count: number }) | null;
  defaultKind: CategoryKind;
  onClose: () => void;
}) {
  const actions = useFinanceActions();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? defaultKind);
  const [color, setColor] = useState(category?.color ?? 'violet');
  const [icon, setIcon] = useState(category?.icon ?? 'circle-ellipsis');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (category) await actions.updateCategory(category.id, { name: name.trim(), color, icon });
    else await actions.createCategory({ name, kind, color, icon });
    onClose();
  };

  const remove = async () => {
    if (!category) return;
    const ok = await askConfirm({
      title: `Hapus kategori "${category.name}"?`,
      description: category.tx_count
        ? `${category.tx_count} transaksi lama tetap menyimpan nama kategori ini.`
        : undefined,
      confirmLabel: 'Hapus',
    });
    if (!ok) return;
    await actions.removeCategory(category.id);
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {!category && (
        <SegmentedControl<CategoryKind>
          label="Jenis kategori"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Pengeluaran' },
            { value: 'income', label: 'Pemasukan' },
          ]}
        />
      )}
      <div className="flex items-end gap-3">
        <CategoryIcon icon={icon} color={color} size="lg" />
        <div className="flex-1">
          <Label htmlFor="c-name">Nama</Label>
          <Input
            id="c-name"
            value={name}
            maxLength={60}
            data-autofocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label>Warna</Label>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div>
        <Label>Ikon</Label>
        <IconPicker value={icon} color={color} onChange={setIcon} />
      </div>
      <div className="flex items-center justify-between gap-2 pt-2">
        {category ? (
          <Button variant="ghost" className="text-danger" onClick={() => void remove()}>
            <Trash2 /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!name.trim()}>
          {category ? 'Simpan' : 'Buat kategori'}
        </Button>
      </div>
    </form>
  );
}
