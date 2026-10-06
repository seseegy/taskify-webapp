import { useMemo } from 'react';
import { buildWeek, WEEKDAY_LABELS } from '@/features/calendar/calendar-utils';
import { addLocalDays, formatLocalDate, todayLocal, type LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { heatLevel, useActivityHeatmap } from './review-queries';

const LEVEL_CLASS = [
  'bg-surface',
  'bg-violet-500/30',
  'bg-violet-500/55',
  'bg-fuchsia-500/75',
  'bg-linear-to-br from-fuchsia-500 to-pink-500 shadow-sm shadow-fuchsia-500/40',
];

/**
 * Heatmap aktivitas ala GitHub: kolom = minggu (Senin–Minggu), sel = hari.
 * Klik sel → buka hari itu di Kalender.
 */
export function ActivityHeatmap({
  weeks = 26,
  onSelect,
}: {
  weeks?: number;
  onSelect?: (day: LocalDate) => void;
}) {
  const today = todayLocal();
  const lastWeek = buildWeek(today);
  const start = addLocalDays(lastWeek[0]!, -(weeks - 1) * 7);
  const byDay = useActivityHeatmap(start, lastWeek[6]!);

  const { columns, max, total, activeDays } = useMemo(() => {
    const cols: LocalDate[][] = Array.from({ length: weeks }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => addLocalDays(start, w * 7 + d)),
    );
    let mx = 0;
    let sum = 0;
    for (const d of byDay.values()) {
      mx = Math.max(mx, d.score);
      sum += d.score;
    }
    return { columns: cols, max: mx, total: sum, activeDays: byDay.size };
  }, [byDay, start, weeks]);

  return (
    <div>
      <div className="flex gap-2">
        <div className="hidden flex-col justify-between py-0.5 text-[10px] text-muted sm:flex">
          {WEEKDAY_LABELS.map((d, i) => (
            <span key={d} className={cn('h-3 leading-3', i % 2 === 1 && 'invisible')}>
              {d}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="flex w-max gap-[3px]" role="grid" aria-label="Heatmap aktivitas">
            {columns.map((col) => (
              <div key={col[0]} className="flex flex-col gap-[3px]">
                {col.map((day) => {
                  const d = byDay.get(day);
                  const future = day > today;
                  const level = heatLevel(d?.score ?? 0, max);
                  const label = d
                    ? `${formatLocalDate(day, 'EEE, d MMM yyyy')}: ${d.tasks} tugas selesai, ${d.journal} jurnal, ${d.transactions} transaksi, ${d.vault} vault`
                    : `${formatLocalDate(day, 'EEE, d MMM yyyy')}: tidak ada aktivitas`;
                  return (
                    <button
                      key={day}
                      type="button"
                      role="gridcell"
                      title={label}
                      aria-label={label}
                      disabled={future}
                      onClick={() => onSelect?.(day)}
                      className={cn(
                        'size-3 rounded-[3px] transition hover:ring-2 hover:ring-primary/50 sm:size-3.5',
                        future ? 'opacity-0' : LEVEL_CLASS[level],
                        day === today && 'ring-2 ring-primary',
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {activeDays} hari aktif · {total} aktivitas dalam {weeks} minggu
        </span>
        <span className="flex items-center gap-1">
          Sedikit
          {LEVEL_CLASS.map((c, i) => (
            <span key={i} className={cn('size-3 rounded-[3px]', c)} />
          ))}
          Banyak
        </span>
      </div>
    </div>
  );
}
