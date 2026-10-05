import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  ListChecks,
  NotebookPen,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardTitle } from '@/components/ui/Card';
import { formatLocalDate, todayLocal, type LocalDate } from '@/lib/date';
import { formatIDR, formatIDRCompact } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ActivityDots } from './ActivityDots';
import {
  ACTIVITY_LEGEND,
  buildMonthGrid,
  firstOfMonth,
  shiftMonth,
  WEEKDAY_LABELS,
} from './calendar-utils';
import { EMPTY_DAY, useCalendarActivity, type DayActivity } from './useCalendarActivity';

export function CalendarPage() {
  const today = todayLocal();
  const [month, setMonth] = useState<LocalDate>(() => firstOfMonth(today));
  const [selected, setSelected] = useState<LocalDate>(today);

  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const { byDay } = useCalendarActivity(cells[0]!.date, cells[cells.length - 1]!.date);

  const goTo = (target: LocalDate) => {
    setMonth(firstOfMonth(target));
    setSelected(target);
  };

  return (
    <>
      <PageHeader
        title="Kalender"
        subtitle="Semua aktivitasmu dalam satu tampilan"
        icon={CalendarDays}
        gradient="bg-gradient-calendar"
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="animate-fade-up p-4 sm:p-5">
          {/* Navigasi bulan */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold capitalize">{formatLocalDate(month, 'MMMM yyyy')}</h2>
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Bulan sebelumnya"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => goTo(today)}>
                Hari ini
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Bulan berikutnya"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
            {WEEKDAY_LABELS.map((d, i) => (
              <div key={d} className={cn('py-2', i === 6 && 'text-danger/80')}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Kalender bulanan">
            {cells.map((cell, i) => {
              const activity = byDay.get(cell.date) ?? EMPTY_DAY;
              const isToday = cell.date === today;
              const isSelected = cell.date === selected;
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={formatLocalDate(cell.date, 'EEEE, d MMMM yyyy')}
                  onClick={() => goTo(cell.date)}
                  className={cn(
                    'relative flex aspect-square flex-col items-center justify-start gap-1 rounded-xl p-1 pt-1.5 text-sm transition sm:aspect-[1.1] sm:items-start sm:p-2',
                    !cell.inMonth && 'opacity-40',
                    isSelected ? 'ring-2 glass-strong ring-primary/50' : 'hover:bg-surface',
                    i % 7 === 6 && !isToday && 'text-danger/80',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full font-semibold',
                      isToday && 'shine bg-gradient-calendar text-white shadow-md',
                    )}
                  >
                    {cell.day}
                  </span>
                  <ActivityDots activity={activity} className="sm:pl-1" />
                  {activity.expense > 0 && (
                    <span className="hidden truncate pl-1 text-[10px] font-semibold text-danger sm:block">
                      −{formatIDRCompact(activity.expense)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legenda */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
            {ACTIVITY_LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', l.className)} />
                {l.label}
              </span>
            ))}
          </div>
        </Card>

        <DayPanel date={selected} activity={byDay.get(selected) ?? EMPTY_DAY} />
      </div>
    </>
  );
}

function DayPanel({ date, activity }: { date: LocalDate; activity: DayActivity }) {
  const rows = [
    {
      icon: ListChecks,
      gradient: 'bg-gradient-tasks',
      label: 'Tugas',
      value: activity.tasks ? `${activity.tasksDone}/${activity.tasks} selesai` : 'Tidak ada',
    },
    {
      icon: NotebookPen,
      gradient: 'bg-gradient-journal',
      label: 'Jurnal',
      value: activity.journal ? `${activity.journal} catatan` : 'Belum menulis',
    },
    {
      icon: TrendingDown,
      gradient: 'bg-linear-to-br from-rose-500 to-orange-500',
      label: 'Pengeluaran',
      value: formatIDR(activity.expense),
    },
    {
      icon: TrendingUp,
      gradient: 'bg-gradient-finance',
      label: 'Pemasukan',
      value: formatIDR(activity.income),
    },
    {
      icon: CodeXml,
      gradient: 'bg-gradient-vault',
      label: 'Vault',
      value: activity.vault ? `${activity.vault} item baru` : 'Tidak ada',
    },
  ];

  return (
    <Card className="animate-fade-up self-start">
      <CardTitle className="capitalize">{formatLocalDate(date, 'EEEE')}</CardTitle>
      <CardDescription className="mb-4">{formatLocalDate(date, 'd MMMM yyyy')}</CardDescription>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3">
            <span
              className={cn(
                'shine flex size-9 shrink-0 items-center justify-center rounded-xl text-white',
                r.gradient,
              )}
            >
              <r.icon className="size-4" />
            </span>
            <span className="flex-1 text-sm font-medium">{r.label}</span>
            <span className="text-sm font-semibold text-muted">{r.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 rounded-xl bg-surface px-3 py-2 text-xs text-muted">
        Daftar detail per hari & tampilan Minggu/Agenda hadir bersama fitur Tugas (tahap 2).
      </p>
    </Card>
  );
}
