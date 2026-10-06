import { iconOf } from '../finance-icons';
import type { WalletWithBalance } from '../finance-queries';
import { formatIDR } from '@/lib/money';
import { paletteOf } from '@/lib/palette';
import { cn } from '@/lib/utils';

/** Kartu dompet bergradasi, bisa digeser horizontal di HP. */
export function WalletStrip({
  wallets,
  selected,
  onSelect,
}: {
  wallets: WalletWithBalance[];
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {wallets
        .filter((w) => w.is_archived === 0)
        .map((w) => {
          const Icon = iconOf(w.icon, 'wallet');
          const p = paletteOf(w.color, 'emerald');
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onSelect?.(w.id)}
              className={cn(
                'shine relative min-w-44 shrink-0 overflow-hidden rounded-2xl bg-linear-to-br p-4 text-left text-white shadow-lg transition hover:-translate-y-0.5',
                p.grad,
                selected === w.id && 'ring-4 ring-white/60',
              )}
            >
              <span className="absolute -right-6 -bottom-6 size-24 rounded-full bg-white/15 blur-xl" />
              <span className="relative flex items-center gap-2 text-xs font-semibold opacity-90">
                <Icon className="size-4" /> {w.name}
              </span>
              <span className="relative mt-2 block text-lg font-extrabold tracking-tight tabular-nums">
                {formatIDR(w.balance)}
              </span>
            </button>
          );
        })}
    </div>
  );
}
