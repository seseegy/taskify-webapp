import { CalendarHeart, Flame, History, NotebookPen } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { diffLocalDays, formatLocalDate, type LocalDate } from '@/lib/date';
import { formatDecimal } from '@/lib/number';
import { cn } from '@/lib/utils';
import { useJournalDays, useMoodSeries, useOnThisDay } from '../journal-queries';
import { journalStreak, plainExcerpt } from '../journal-utils';
import { MOODS } from '../mood';
import { MoodChart } from './MoodChart';
import { MoodIcon } from './MoodIcon';
import type { ReactNode } from 'react';

export function JournalInsights({ today, compact }: { today: LocalDate; compact?: boolean }) {
  const series = useMoodSeries(today, 30);
  const days = useJournalDays();
  const onThisDay = useOnThisDay(today);
  const streak = journalStreak(days, today);
  const withMood = series.filter((p) => p.mood !== null);
  const avg = withMood.length ? withMood.reduce((s, p) => s + p.mood!, 0) / withMood.length : null;
  const written = series.filter((p) => p.entries > 0).length;
  const dist = MOODS.map((m) => ({
    ...m,
    n: withMood.filter((p) => Math.round(p.mood!) === m.value).length,
  }));
  const maxDist = Math.max(1, ...dist.map((d) => d.n));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat
          icon={Flame}
          label="Streak"
          value={`${streak} hari`}
          gradient="bg-linear-to-br from-orange-500 to-rose-500"
        />
        <Stat
          icon={NotebookPen}
          label="30 hari"
          value={`${written} hari`}
          gradient="bg-gradient-journal"
        />
        <Stat
          icon={CalendarHeart}
          label="Rata-rata mood"
          value={
            avg ? (
              <span className="flex items-center gap-1.5">
                <MoodIcon mood={avg} className="size-5" /> {formatDecimal(avg)}
              </span>
            ) : (
              '–'
            )
          }
          gradient="bg-gradient-finance"
        />
      </div>

      <Card className="animate-fade-up">
        <CardHeader className="mb-1">
          <div>
            <CardTitle>Mood 30 hari</CardTitle>
            <CardDescription>
              {withMood.length
                ? `${withMood.length} hari tercatat`
                : 'Pilih mood saat menulis jurnal untuk melihat tren.'}
            </CardDescription>
          </div>
        </CardHeader>
        <MoodChart points={series} />
        {!compact && withMood.length > 0 && (
          <div className="mt-3 flex items-end justify-between gap-2">
            {dist.map((d) => (
              <div key={d.value} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-12 w-full items-end justify-center">
                  <div
                    className={cn('w-6 rounded-t-md bg-linear-to-t', d.className)}
                    style={{
                      height: `${Math.max(6, (d.n / maxDist) * 100)}%`,
                      opacity: d.n ? 1 : 0.25,
                    }}
                  />
                </div>
                <span className="text-lg" title={d.label}>
                  <MoodIcon mood={d.value} className="size-5" />
                </span>
                <span className="text-xs font-semibold text-muted">{d.n}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {onThisDay.length > 0 && (
        <Card className="animate-fade-up">
          <CardHeader className="mb-2">
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-mod-journal" /> Hari ini di masa lalu
            </CardTitle>
          </CardHeader>
          <ul className="space-y-1">
            {onThisDay.map((e) => {
              const years = Math.round(diffLocalDays(e.entry_date, today) / 365);
              const ago = years >= 1 ? `${years} tahun lalu` : '1 bulan lalu';
              return (
                <li key={e.id}>
                  <Link
                    to={`/jurnal?entri=${e.id}`}
                    className="block rounded-2xl px-2 py-2 hover:bg-surface"
                  >
                    <span className="flex items-center gap-2 text-xs font-bold text-mod-journal">
                      <MoodIcon mood={e.mood} className="size-3.5" /> {ago} ·{' '}
                      {formatLocalDate(e.entry_date, 'd MMM yyyy')}
                    </span>
                    <span className="block truncate text-sm font-semibold">
                      {e.title || plainExcerpt(e.content, 80) || 'Tanpa judul'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  gradient,
}: {
  icon: typeof Flame;
  label: string;
  value: ReactNode;
  gradient: string;
}) {
  return (
    <Card className="animate-fade-up p-3 sm:p-4">
      <span
        className={cn(
          'shine mb-2 flex size-8 items-center justify-center rounded-lg text-white shadow-md',
          gradient,
        )}
      >
        <Icon className="size-4" />
      </span>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="truncate text-base font-extrabold tracking-tight sm:text-lg">{value}</p>
    </Card>
  );
}
