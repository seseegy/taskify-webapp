import { ArrowRight, Repeat } from 'lucide-react';
import { shortTime } from '@/lib/date';
import { formatIDR } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { TxRow } from '../finance-queries';
import { txTitle } from '../finance-utils';
import { useTxSheet } from '../tx-sheet-store';
import { CategoryIcon } from './CategoryIcon';

export function TransactionRow({ tx, compact }: { tx: TxRow; compact?: boolean }) {
  const edit = useTxSheet((s) => s.edit);
  const sign = tx.kind === 'income' ? '+' : tx.kind === 'expense' ? '−' : '';

  return (
    <button
      type="button"
      onClick={() => edit(tx.id)}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl text-left transition hover:bg-surface',
        compact ? 'px-2 py-1.5' : 'px-3 py-2.5',
      )}
    >
      <CategoryIcon
        icon={tx.category_icon}
        color={tx.category_color}
        size={compact ? 'sm' : 'md'}
        special={tx.kind === 'transfer' ? 'transfer' : tx.debt_id ? 'debt' : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{txTitle(tx)}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted">
          {tx.kind === 'transfer' ? (
            <>
              {tx.wallet_name} <ArrowRight className="size-3" /> {tx.to_wallet_name}
            </>
          ) : (
            <>
              {tx.title && tx.category_name ? `${tx.category_name} · ` : ''}
              {tx.wallet_name}
            </>
          )}
          {tx.occurred_time && <> · {shortTime(tx.occurred_time)}</>}
          {tx.recurring_id && <Repeat className="size-3" aria-label="Berulang" />}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          tx.kind === 'income' && 'text-success',
          tx.kind === 'expense' && 'text-danger',
          tx.kind === 'transfer' && 'text-muted',
        )}
      >
        {sign}
        {formatIDR(tx.amount)}
      </span>
    </button>
  );
}
