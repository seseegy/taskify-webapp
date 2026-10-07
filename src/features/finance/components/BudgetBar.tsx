import { Progress } from '@/components/ui/Progress';
import { formatIDR } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { BudgetStatus } from '../finance-queries';
import { budgetLevel } from '../finance-utils';
import { CategoryIcon } from './CategoryIcon';

export function BudgetBar({ budget, onClick }: { budget: BudgetStatus; onClick?: () => void }) {
  const pct = Math.min(100, (budget.spent / budget.amount) * 100);
  const level = budgetLevel(budget);
  const left = budget.amount - budget.spent;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface"
    >
      {budget.category_id ? (
        <CategoryIcon icon={budget.icon} color={budget.color} size="sm" />
      ) : (
        <CategoryIcon icon="piggy-bank" color="violet" size="sm" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex justify-between gap-2 text-sm">
          <span className="truncate font-semibold">{budget.name}</span>
          <span className="shrink-0 text-xs font-semibold text-muted tabular-nums">
            {formatIDR(budget.spent)} / {formatIDR(budget.amount)}
          </span>
        </span>
        {/* Dekoratif: "Sisa … · 87%" di bawahnya sudah menyampaikan angka yang sama */}
        <Progress
          decorative
          value={pct}
          className="mt-1.5 h-2"
          barClassName={cn(
            level === 'ok' && 'bg-linear-to-r from-emerald-500 to-teal-400',
            level === 'warn' && 'bg-linear-to-r from-amber-500 to-orange-400',
            level === 'over' && 'bg-linear-to-r from-rose-600 to-red-500',
          )}
        />
        <span
          className={cn(
            'mt-1 block text-xs font-medium',
            level === 'over' ? 'text-danger' : level === 'warn' ? 'text-warning' : 'text-muted',
          )}
        >
          {left >= 0 ? `Sisa ${formatIDR(left)}` : `Lewat ${formatIDR(-left)}`} ·{' '}
          {Math.round((budget.spent / budget.amount) * 100)}%
        </span>
      </span>
    </button>
  );
}
