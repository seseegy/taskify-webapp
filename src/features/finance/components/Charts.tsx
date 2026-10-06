import { addLocalDays, daysInMonth, formatLocalDate, type LocalDate } from '@/lib/date';
import { formatIDR, formatIDRCompact } from '@/lib/money';
import { paletteOf } from '@/lib/palette';
import { cn } from '@/lib/utils';
import type { CategorySlice } from '../finance-queries';
import { CategoryIcon } from './CategoryIcon';

/** Donut pengeluaran per kategori (CSS conic-gradient, tanpa library grafik). */
export function CategoryDonut({
  slices,
  total,
  label,
}: {
  slices: CategorySlice[];
  total: number;
  label: string;
}) {
  let acc = 0;
  const stops = slices.map((s) => {
    const start = (acc / total) * 360;
    acc += s.total;
    const end = (acc / total) * 360;
    return `${paletteOf(s.color, 'slate').hex} ${start}deg ${end}deg`;
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <div
        className="relative size-40 shrink-0 rounded-full shadow-inner"
        style={{ background: total > 0 ? `conic-gradient(${stops.join(',')})` : 'var(--surface)' }}
        role="img"
        aria-label={`${label}: ${formatIDR(total)}`}
      >
        <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full text-center glass-strong">
          <span className="text-[11px] font-semibold text-muted">{label}</span>
          <span className="text-base font-extrabold tracking-tight">{formatIDRCompact(total)}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {slices.slice(0, 7).map((s) => {
          const pct = total ? Math.round((s.total / total) * 100) : 0;
          return (
            <li key={s.category_id ?? 'none'} className="flex items-center gap-2.5 text-sm">
              <CategoryIcon icon={s.icon} color={s.color} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-2">
                  <span className="truncate font-semibold">{s.name}</span>
                  <span className="shrink-0 font-bold tabular-nums">{formatIDR(s.total)}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct}%`, background: paletteOf(s.color, 'slate').hex }}
                    />
                  </span>
                  <span className="w-8 text-right text-xs text-muted">{pct}%</span>
                </span>
              </span>
            </li>
          );
        })}
        {slices.length > 7 && (
          <li className="text-xs text-muted">+{slices.length - 7} kategori lain</li>
        )}
      </ul>
    </div>
  );
}

/** Batang pengeluaran harian dalam satu bulan. */
export function DailyBars({
  month,
  totals,
  today,
  onSelect,
}: {
  month: LocalDate;
  totals: Map<LocalDate, { expense: number; income: number }>;
  today: LocalDate;
  onSelect?: (day: LocalDate) => void;
}) {
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => addLocalDays(month, i));
  const max = Math.max(1, ...days.map((d) => totals.get(d)?.expense ?? 0));

  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]" role="img" aria-label="Pengeluaran harian">
        {days.map((d) => {
          const v = totals.get(d)?.expense ?? 0;
          return (
            <button
              key={d}
              type="button"
              title={`${formatLocalDate(d, 'd MMM')}: ${formatIDR(v)}`}
              onClick={() => onSelect?.(d)}
              className="group flex h-full flex-1 items-end"
            >
              <span
                className={cn(
                  'w-full rounded-t-md transition group-hover:brightness-125',
                  d > today
                    ? 'bg-surface'
                    : v > 0
                      ? 'bg-linear-to-t from-rose-500 to-orange-400'
                      : 'bg-surface',
                  d === today && 'ring-2 ring-primary/60',
                )}
                style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-semibold text-muted">
        <span>1</span>
        <span>{Math.ceil(days.length / 2)}</span>
        <span>{days.length}</span>
      </div>
    </div>
  );
}
