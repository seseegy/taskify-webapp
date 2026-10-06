import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  List,
  NotebookPen,
} from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardTitle } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { TaskList } from '@/db/schema';
import { DayTransactions } from '@/features/finance/components/DayTransactions';
import { DayJournal } from '@/features/journal/components/DayJournal';
import { MoodIcon } from '@/features/journal/components/MoodIcon';
import { QuickAdd } from '@/features/tasks/components/QuickAdd';
import { useTaskLists } from '@/features/tasks/task-queries';
import { dayGroupLabel } from '@/features/tasks/task-utils';
import {
  addLocalDays,
  formatLocalDate,
  relativeDayLabel,
  todayLocal,
  type LocalDate,
} from '@/lib/date';
import { formatIDRCompact } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ActivityDots } from './ActivityDots';
import {
  ACTIVITY_LEGEND,
  buildMonthGrid,
  buildWeek,
  firstOfMonth,
  shiftMonth,
  WEEKDAY_LABELS,
} from './calendar-utils';
import { DayTaskList } from './DayTaskList';
import { EMPTY_DAY, type DayActivity } from './useCalendarActivity';
import { useDayActivity, type CalendarTaskItem } from './useDayActivity';

type CalView = 'bulan' | 'minggu' | 'agenda';
const AGENDA_DAYS = 30;

export function CalendarPage() {
  const today = todayLocal();
  const [params, setParams] = useSearchParams();
  const view =
    (['bulan', 'minggu', 'agenda'] as const).find((v) => v === params.get('tampilan')) ?? 'bulan';
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(params.get('tanggal') ?? '')
    ? params.get('tanggal')!
    : today;

  const update = (next: { view?: CalView; date?: LocalDate }) =>
    setParams(
      (p) => {
        if (next.view) p.set('tampilan', next.view);
        if (next.date) p.set('tanggal', next.date);
        return p;
      },
      { replace: true },
    );

  const monthCells = useMemo(() => buildMonthGrid(firstOfMonth(selected)), [selected]);
  const week = useMemo(() => buildWeek(selected), [selected]);

  const [from, to] =
    view === 'bulan'
      ? [monthCells[0]!.date, monthCells.at(-1)!.date]
      : view === 'minggu'
        ? [week[0]!, week[6]!]
        : [selected, addLocalDays(selected, AGENDA_DAYS - 1)];

  const { byDay, tasksByDay } = useDayActivity(from, to);
  const lists = useTaskLists();
  const listMap = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);

  const shift = (dir: -1 | 1) => {
    if (view === 'bulan') update({ date: shiftMonth(firstOfMonth(selected), dir) });
    else update({ date: addLocalDays(selected, dir * (view === 'minggu' ? 7 : AGENDA_DAYS)) });
  };

  const heading =
    view === 'bulan'
      ? formatLocalDate(selected, 'MMMM yyyy')
      : view === 'minggu'
        ? `${formatLocalDate(week[0]!, 'd MMM')} – ${formatLocalDate(week[6]!, 'd MMM yyyy')}`
        : `${formatLocalDate(from, 'd MMM')} – ${formatLocalDate(to, 'd MMM yyyy')}`;

  return (
    <>
      <PageHeader
        title="Kalender"
        subtitle="Semua aktivitasmu dalam satu tampilan"
        icon={CalendarDays}
        gradient="bg-gradient-calendar"
      />

      <div
        className={cn('grid grid-cols-1 gap-5', view !== 'agenda' && 'lg:grid-cols-[1fr_340px]')}
      >
        <Card className="min-w-0 animate-fade-up p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold capitalize">{heading}</h2>
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Sebelumnya"
                onClick={() => shift(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => update({ date: today })}>
                Hari ini
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Berikutnya"
                onClick={() => shift(1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
          <SegmentedControl<CalView>
            label="Tampilan kalender"
            className="mb-4"
            value={view}
            onChange={(v) => update({ view: v })}
            options={[
              { value: 'bulan', label: 'Bulan', icon: <CalendarDays /> },
              { value: 'minggu', label: 'Minggu', icon: <CalendarRange /> },
              { value: 'agenda', label: 'Agenda', icon: <List /> },
            ]}
          />

          {view === 'bulan' && (
            <MonthGrid
              cells={monthCells}
              byDay={byDay}
              today={today}
              selected={selected}
              onSelect={(date) => update({ date })}
            />
          )}
          {view === 'minggu' && (
            <WeekView
              days={week}
              tasksByDay={tasksByDay}
              byDay={byDay}
              today={today}
              selected={selected}
              lists={listMap}
              onSelect={(date) => update({ date })}
            />
          )}
          {view === 'agenda' && (
            <AgendaView
              from={from}
              tasksByDay={tasksByDay}
              byDay={byDay}
              today={today}
              lists={listMap}
            />
          )}
        </Card>

        {view !== 'agenda' && (
          <DayPanel
            date={selected}
            today={today}
            activity={byDay.get(selected) ?? EMPTY_DAY}
            items={tasksByDay.get(selected) ?? []}
            lists={listMap}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- Bulan
function MonthGrid({
  cells,
  byDay,
  today,
  selected,
  onSelect,
}: {
  cells: ReturnType<typeof buildMonthGrid>;
  byDay: Map<LocalDate, DayActivity>;
  today: LocalDate;
  selected: LocalDate;
  onSelect: (date: LocalDate) => void;
}) {
  return (
    <>
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
          const open = activity.tasks - activity.tasksDone;
          return (
            <button
              key={cell.date}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={formatLocalDate(cell.date, 'EEEE, d MMMM yyyy')}
              onClick={() => onSelect(cell.date)}
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
              {activity.mood && (
                <span className="absolute top-1.5 right-1.5 hidden sm:block">
                  <MoodIcon mood={activity.mood} className="size-4" />
                </span>
              )}
              <ActivityDots activity={activity} className="sm:pl-1" />
              {open > 0 && (
                <span className="hidden pl-1 text-[10px] font-semibold text-mod-tasks sm:block">
                  {open} tugas
                </span>
              )}
              {activity.expense > 0 && (
                <span className="hidden truncate pl-1 text-[10px] font-semibold text-danger sm:block">
                  −{formatIDRCompact(activity.expense)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {ACTIVITY_LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', l.className)} />
            {l.label}
          </span>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- Minggu
function WeekView({
  days,
  tasksByDay,
  byDay,
  today,
  selected,
  lists,
  onSelect,
}: {
  days: LocalDate[];
  tasksByDay: Map<LocalDate, CalendarTaskItem[]>;
  byDay: Map<LocalDate, DayActivity>;
  today: LocalDate;
  selected: LocalDate;
  lists: Map<string, TaskList>;
  onSelect: (date: LocalDate) => void;
}) {
  return (
    <div className="space-y-2">
      {days.map((day) => {
        const isToday = day === today;
        const activity = byDay.get(day) ?? EMPTY_DAY;
        return (
          <section
            key={day}
            className={cn(
              'rounded-2xl p-2 transition',
              day === selected ? 'ring-2 glass-strong ring-primary/40' : 'bg-surface/60',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(day)}
              className="flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left"
            >
              <span
                className={cn(
                  'flex size-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none',
                  isToday ? 'shine bg-gradient-calendar text-white shadow-md' : 'bg-surface',
                )}
              >
                <span className="text-[10px] font-semibold uppercase opacity-80">
                  {formatLocalDate(day, 'EEE')}
                </span>
                <span className="text-lg font-extrabold">{formatLocalDate(day, 'd')}</span>
              </span>
              <span className="flex-1 text-sm font-semibold capitalize">
                {relativeDayLabel(day, today)}
              </span>
              <ActivityDots activity={activity} />
            </button>
            <div className="pl-12">
              <DayTaskList items={tasksByDay.get(day) ?? []} today={today} lists={lists} compact />
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------- Agenda
function AgendaView({
  from,
  tasksByDay,
  byDay,
  today,
  lists,
}: {
  from: LocalDate;
  tasksByDay: Map<LocalDate, CalendarTaskItem[]>;
  byDay: Map<LocalDate, DayActivity>;
  today: LocalDate;
  lists: Map<string, TaskList>;
}) {
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addLocalDays(from, i)).filter((d) => {
    const a = byDay.get(d);
    return d === today || (a && (a.tasks || a.journal || a.transactions || a.vault));
  });

  if (days.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">Tidak ada aktivitas dalam 30 hari ini.</p>
    );
  }

  return (
    <div className="space-y-5">
      {days.map((day) => {
        const a = byDay.get(day) ?? EMPTY_DAY;
        return (
          <section key={day}>
            <h3
              className={cn(
                'mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-xs font-bold tracking-wide uppercase',
                day === today ? 'text-primary' : 'text-muted',
              )}
            >
              {dayGroupLabel(day, today)}
              <ModuleChips activity={a} />
            </h3>
            <DayTaskList
              items={tasksByDay.get(day) ?? []}
              today={today}
              lists={lists}
              empty={day === today ? 'Tidak ada tugas hari ini.' : undefined}
            />
          </section>
        );
      })}
    </div>
  );
}

function ModuleChips({ activity: a }: { activity: DayActivity }) {
  return (
    <span className="flex flex-wrap gap-2 font-semibold tracking-normal normal-case">
      {a.journal > 0 && (
        <span className="inline-flex items-center gap-1 text-mod-journal">
          <NotebookPen className="size-3" /> Jurnal
        </span>
      )}
      {a.expense > 0 && <span className="text-danger">−{formatIDRCompact(a.expense)}</span>}
      {a.income > 0 && <span className="text-success">+{formatIDRCompact(a.income)}</span>}
      {a.vault > 0 && (
        <span className="inline-flex items-center gap-1 text-mod-vault">
          <CodeXml className="size-3" /> {a.vault}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------- Panel hari
function DayPanel({
  date,
  today,
  activity,
  items,
  lists,
}: {
  date: LocalDate;
  today: LocalDate;
  activity: DayActivity;
  items: CalendarTaskItem[];
  lists: Map<string, TaskList>;
}) {
  const rows = [
    {
      icon: CodeXml,
      gradient: 'bg-gradient-vault',
      label: 'Vault',
      value: activity.vault ? `${activity.vault} item baru` : 'Tidak ada',
    },
  ];

  return (
    <Card className="animate-fade-up self-start lg:sticky lg:top-6">
      <CardTitle>
        {relativeDayLabel(date, today) === 'Hari ini' ? 'Hari ini' : formatLocalDate(date, 'EEEE')}
      </CardTitle>
      <CardDescription className="mb-4">
        {formatLocalDate(date, 'EEEE, d MMMM yyyy')}
      </CardDescription>

      <h3 className="mb-2 flex items-center justify-between text-xs font-bold tracking-wide text-muted uppercase">
        Tugas
        {activity.tasks > 0 && (
          <span className="normal-case">
            {activity.tasksDone}/{activity.tasks} selesai
          </span>
        )}
      </h3>
      <QuickAdd
        key={date}
        defaultDate={date}
        placeholder="Tambah tugas di tanggal ini…"
        className="mb-2"
      />
      <DayTaskList items={items} today={today} lists={lists} compact empty="Tidak ada tugas." />

      <div className="mt-5">
        <DayJournal date={date} />
      </div>

      <div className="mt-5">
        <DayTransactions date={date} />
      </div>

      <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Modul lain</h3>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3">
            <span
              className={cn(
                'shine flex size-8 shrink-0 items-center justify-center rounded-lg text-white',
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
    </Card>
  );
}
