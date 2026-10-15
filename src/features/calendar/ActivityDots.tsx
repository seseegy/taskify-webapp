import { cn } from '@/lib/utils';
import { describeActivity } from './calendar-utils';
import type { DayActivity } from './useCalendarActivity';

/**
 * Titik warna per modul untuk satu hari di kalender.
 * `decorative`: dipakai bila induknya sudah membawa ringkasan teks (mis. label sel kalender).
 * Selain itu titik diekspos sebagai gambar dengan teks alternatif.
 */
export function ActivityDots({
  activity,
  className,
  decorative = false,
}: {
  activity: DayActivity;
  className?: string;
  decorative?: boolean;
}) {
  const dots = [
    activity.tasks > 0 && { key: 'task', className: 'bg-mod-tasks' },
    activity.journal > 0 && { key: 'journal', className: 'bg-mod-journal' },
    activity.notes > 0 && { key: 'notes', className: 'bg-mod-notes' },
    activity.transactions > 0 && { key: 'finance', className: 'bg-mod-finance' },
    activity.vault > 0 && { key: 'vault', className: 'bg-mod-vault' },
  ].filter(Boolean) as { key: string; className: string }[];

  if (dots.length === 0) return null;

  // `aria-label` pada <div> tanpa role diabaikan pembaca layar → wajib role="img".
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': describeActivity(activity) } as const);

  return (
    <div className={cn('flex items-center gap-1', className)} {...a11y}>
      {dots.map((d) => (
        <span key={d.key} className={cn('size-1.5 rounded-full shadow-sm', d.className)} />
      ))}
    </div>
  );
}
