import { cn } from '@/lib/utils';
import type { DayActivity } from './useCalendarActivity';

/** Titik warna per modul untuk satu hari di kalender. */
export function ActivityDots({
  activity,
  className,
}: {
  activity: DayActivity;
  className?: string;
}) {
  const dots = [
    activity.tasks > 0 && {
      key: 'task',
      className: 'bg-mod-tasks',
      label: `${activity.tasks} tugas`,
    },
    activity.journal > 0 && { key: 'journal', className: 'bg-mod-journal', label: 'jurnal' },
    activity.transactions > 0 && {
      key: 'finance',
      className: 'bg-mod-finance',
      label: `${activity.transactions} transaksi`,
    },
    activity.vault > 0 && { key: 'vault', className: 'bg-mod-vault', label: 'vault' },
  ].filter(Boolean) as { key: string; className: string; label: string }[];

  if (dots.length === 0) return null;

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      aria-label={dots.map((d) => d.label).join(', ')}
    >
      {dots.map((d) => (
        <span key={d.key} className={cn('size-1.5 rounded-full shadow-sm', d.className)} />
      ))}
    </div>
  );
}
