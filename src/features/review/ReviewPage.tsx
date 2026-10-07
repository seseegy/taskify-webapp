import { useQuery } from '@powersync/react';
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  Flame,
  ListChecks,
  NotebookPen,
  PenLine,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { CategoryIcon } from '@/features/finance/components/CategoryIcon';
import { useCategoryBreakdown } from '@/features/finance/finance-queries';
import { MoodIcon } from '@/features/journal/components/MoodIcon';
import { moodOf } from '@/features/journal/mood';
import { diffLocalDays, formatLocalDate, todayLocal, type LocalDate } from '@/lib/date';
import { Progress } from '@/components/ui/Progress';
import { formatIDR, formatIDRCompact } from '@/lib/money';
import { formatDecimal } from '@/lib/number';
import { cn } from '@/lib/utils';
import { ActivityHeatmap } from './ActivityHeatmap';
import {
  percentChange,
  periodRange,
  shiftPeriod,
  useDailySeries,
  usePeriodStats,
  type PeriodStats,
  type Range,
  type ReviewPeriod,
} from './review-queries';

/** URL: ?periode=minggu|bulan&tanggal=YYYY-MM-DD */
export function ReviewPage() {
  const today = todayLocal();
  const [params, setParams] = useSearchParams();
  const period: ReviewPeriod = params.get('periode') === 'bulan' ? 'bulan' : 'minggu';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('tanggal') ?? '')
    ? params.get('tanggal')!
    : today;
  const { current, previous } = periodRange(period, anchor);
  const isCurrent = current.from <= today && today <= current.to;
  const navigate = useNavigate();

  const update = (p: Record<string, string>) =>
    setParams(
      (prev) => {
        for (const [k, v] of Object.entries(p)) prev.set(k, v);
        return prev;
      },
      { replace: true },
    );

  const now = usePeriodStats(current);
  const before = usePeriodStats(previous);
  const label =
    period === 'minggu'
      ? `${formatLocalDate(current.from, 'd MMM')} – ${formatLocalDate(current.to, 'd MMM yyyy')}`
      : formatLocalDate(current.from, 'MMMM yyyy');
  const elapsed = Math.min(
    diffLocalDays(current.from, isCurrent ? today : current.to) + 1,
    diffLocalDays(current.from, current.to) + 1,
  );

  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Ringkasan & refleksi semua aktivitasmu"
        icon={Trophy}
        gradient="bg-gradient-brand"
        actions={
          <Button
            // Di HP tombol hanya berupa ikon → wajib punya nama aksesibel
            aria-label="Tulis refleksi"
            onClick={() =>
              navigate(
                `/jurnal?baru=${today}&templat=review-${period}&dari=${current.from}&sampai=${current.to}`,
              )
            }
          >
            <PenLine /> <span className="hidden sm:inline">Tulis refleksi</span>
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<ReviewPeriod>
          label="Periode"
          value={period}
          onChange={(v) => update({ periode: v })}
          className="w-full sm:w-64"
          options={[
            { value: 'minggu', label: 'Mingguan' },
            { value: 'bulan', label: 'Bulanan' },
          ]}
        />
        <div className="flex items-center gap-1 rounded-xl p-1 glass">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Periode sebelumnya"
            onClick={() => update({ tanggal: shiftPeriod(period, anchor, -1) })}
          >
            <ChevronLeft />
          </Button>
          <button
            type="button"
            onClick={() => update({ tanggal: today })}
            className="min-w-44 px-2 text-center text-sm font-bold capitalize"
            title="Periode ini"
          >
            {label}
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Periode berikutnya"
            disabled={isCurrent}
            onClick={() => update({ tanggal: shiftPeriod(period, anchor, 1) })}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {now && before && (
        <div className="space-y-5">
          <Summary
            now={now}
            before={before}
            period={period}
            isCurrent={isCurrent}
            elapsed={elapsed}
          />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              icon={ListChecks}
              gradient="bg-gradient-tasks"
              label="Tugas selesai"
              value={String(now.tasks_done)}
              delta={percentChange(now.tasks_done, before.tasks_done)}
            />
            <Stat
              icon={CalendarCheck2}
              gradient="bg-gradient-calendar"
              label="Tepat jadwal"
              value={
                now.tasks_due ? `${Math.round((now.tasks_due_done / now.tasks_due) * 100)}%` : '–'
              }
              hint={`${now.tasks_due_done}/${now.tasks_due} tugas ber-tenggat`}
            />
            <Stat
              icon={Wallet}
              gradient="bg-linear-to-br from-rose-500 to-orange-500"
              label="Pengeluaran"
              value={formatIDRCompact(now.expense)}
              delta={percentChange(now.expense, before.expense)}
              lowerIsBetter
              hint={`Masuk ${formatIDRCompact(now.income)}`}
            />
            <Stat
              icon={NotebookPen}
              gradient="bg-gradient-journal"
              label="Hari berjurnal"
              value={`${now.journal_days}/${elapsed}`}
              hint={
                now.mood_avg ? (
                  <span className="inline-flex items-center gap-1">
                    <MoodIcon mood={now.mood_avg} className="size-3.5" /> mood{' '}
                    {formatDecimal(now.mood_avg)}
                  </span>
                ) : (
                  'belum ada mood'
                )
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
            <DailyChart
              range={current}
              today={today}
              onSelect={(d) => navigate(`/kalender?tanggal=${d}`)}
            />
            <TopCategories range={current} total={now.expense} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Highlights range={current} now={now} />
            <Card className="animate-fade-up">
              <CardHeader className="mb-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Flame className="size-4 text-fuchsia-500" /> Jejak aktivitas
                  </CardTitle>
                  <CardDescription>
                    26 minggu terakhir · klik hari untuk membuka Kalender
                  </CardDescription>
                </div>
              </CardHeader>
              <ActivityHeatmap weeks={26} onSelect={(d) => navigate(`/kalender?tanggal=${d}`)} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------- Ringkasan
function Summary({
  now,
  before,
  period,
  isCurrent,
  elapsed,
}: {
  now: PeriodStats;
  before: PeriodStats;
  period: ReviewPeriod;
  isCurrent: boolean;
  elapsed: number;
}) {
  const unit = period === 'minggu' ? 'minggu' : 'bulan';
  const doneDelta = percentChange(now.tasks_done, before.tasks_done);
  const expDelta = percentChange(now.expense, before.expense);
  const parts: string[] = [];
  parts.push(
    `Kamu menyelesaikan ${now.tasks_done} tugas${doneDelta !== null && before.tasks_done ? ` (${doneDelta >= 0 ? '+' : ''}${doneDelta}% dari ${unit} lalu)` : ''}`,
  );
  parts.push(`berjurnal ${now.journal_days} dari ${elapsed} hari`);
  parts.push(
    `mengeluarkan ${formatIDR(now.expense)}${expDelta !== null && before.expense ? ` (${expDelta >= 0 ? '+' : ''}${expDelta}%)` : ''}`,
  );
  const mood = moodOf(now.mood_avg);

  return (
    <section className="relative animate-fade-up overflow-hidden rounded-3xl p-6 glass">
      <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-gradient-brand opacity-25 blur-3xl" />
      <p className="relative text-xs font-bold tracking-wide text-muted uppercase">
        {isCurrent ? `${unit} ini sejauh ini` : `ringkasan ${unit}`}
      </p>
      <p className="relative mt-2 max-w-3xl text-lg leading-relaxed font-semibold">
        {parts.join(', ')}.
        {mood && (
          <>
            {' '}
            Rata-rata perasaanmu <span className={mood.text}>{mood.label.toLowerCase()}</span>.
          </>
        )}
        {now.snippets_new + now.versions_new > 0 &&
          ` Vault bertambah ${now.snippets_new} snippet & ${now.versions_new} versi project.`}
      </p>
    </section>
  );
}

function Stat({
  icon: Icon,
  gradient,
  label,
  value,
  delta,
  lowerIsBetter,
  hint,
}: {
  icon: LucideIcon;
  gradient: string;
  label: string;
  value: string;
  delta?: number | null;
  lowerIsBetter?: boolean;
  hint?: ReactNode;
}) {
  const good =
    delta !== undefined && delta !== null && delta !== 0 && (lowerIsBetter ? delta < 0 : delta > 0);
  return (
    <Card className="animate-fade-up p-4">
      <span
        className={cn(
          'shine mb-2 flex size-9 items-center justify-center rounded-xl text-white shadow-md',
          gradient,
        )}
      >
        <Icon className="size-4" />
      </span>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="flex items-baseline gap-2">
        <span className="text-xl font-extrabold tracking-tight">{value}</span>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-bold',
              good ? 'text-success' : 'text-danger',
            )}
          >
            {delta > 0 ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            {delta > 0 ? '+' : ''}
            {delta}%
          </span>
        )}
      </p>
      {hint && <p className="truncate text-xs text-muted">{hint}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------- Grafik harian
function DailyChart({
  range,
  today,
  onSelect,
}: {
  range: Range;
  today: LocalDate;
  onSelect: (d: LocalDate) => void;
}) {
  const points = useDailySeries(range);
  const maxTasks = Math.max(1, ...points.map((p) => p.tasks_done));
  const maxExp = Math.max(1, ...points.map((p) => p.expense));
  const dense = points.length > 10;

  return (
    <Card className="animate-fade-up">
      <CardHeader className="mb-3">
        <div>
          <CardTitle>Per hari</CardTitle>
          <CardDescription className="flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-mod-tasks" /> tugas selesai
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-rose-500" /> pengeluaran
            </span>
            <span>ikon = mood jurnal</span>
          </CardDescription>
        </div>
      </CardHeader>
      <div className={cn('flex h-44 items-end', dense ? 'gap-[3px]' : 'gap-2')}>
        {points.map((p) => (
          <button
            key={p.day}
            type="button"
            onClick={() => onSelect(p.day)}
            disabled={p.day > today}
            title={`${formatLocalDate(p.day, 'EEE, d MMM')}: ${p.tasks_done} tugas, ${formatIDR(p.expense)}`}
            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 disabled:opacity-30"
          >
            <span className="flex h-5 items-center">
              {p.mood !== null && (
                <MoodIcon mood={p.mood} className={dense ? 'size-3' : 'size-4'} />
              )}
            </span>
            <span className="flex w-full flex-1 items-end justify-center gap-px">
              <span
                className="w-1/2 rounded-t-sm bg-linear-to-t from-violet-600 to-fuchsia-400 transition group-hover:brightness-125"
                style={{
                  height: `${(p.tasks_done / maxTasks) * 100}%`,
                  minHeight: p.tasks_done ? 4 : 0,
                }}
              />
              <span
                className="w-1/2 rounded-t-sm bg-linear-to-t from-rose-600 to-orange-400 transition group-hover:brightness-125"
                style={{ height: `${(p.expense / maxExp) * 100}%`, minHeight: p.expense ? 4 : 0 }}
              />
            </span>
            <span
              className={cn(
                'text-xs font-semibold',
                p.day === today ? 'text-primary' : 'text-muted',
              )}
            >
              {dense
                ? Number(p.day.slice(8)) % 5 === 1 || p.day === today
                  ? Number(p.day.slice(8))
                  : ''
                : formatLocalDate(p.day, 'EEEEEE')}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function TopCategories({ range, total }: { range: Range; total: number }) {
  const slices = useCategoryBreakdown(range.from, range.to, 'expense').slice(0, 5);
  return (
    <Card className="animate-fade-up">
      <CardHeader className="mb-3">
        <CardTitle>Pengeluaran terbesar</CardTitle>
        <Link
          to={`/keuangan?bulan=${range.from.slice(0, 7)}`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Keuangan
        </Link>
      </CardHeader>
      {slices.length === 0 ? (
        <p className="text-sm text-muted">Tidak ada pengeluaran.</p>
      ) : (
        <ul className="space-y-2.5">
          {slices.map((s) => (
            <li key={s.category_id ?? 'none'} className="flex items-center gap-2.5 text-sm">
              <CategoryIcon icon={s.icon} color={s.color} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-2">
                  <span className="truncate font-semibold">{s.name}</span>
                  <span className="font-bold tabular-nums">{formatIDR(s.total)}</span>
                </span>
                <Progress
                  decorative
                  value={s.total}
                  max={total}
                  className="mt-1"
                  barClassName="bg-linear-to-r from-rose-500 to-orange-400"
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- Sorotan
function Highlights({ range, now }: { range: Range; now: PeriodStats }) {
  const points = useDailySeries(range);
  const best = points.reduce<(typeof points)[number] | null>(
    (b, p) => (p.tasks_done > (b?.tasks_done ?? 0) ? p : b),
    null,
  );
  const { data: bigTx } = useQuery<{
    title: string | null;
    amount: number;
    occurred_on: string;
    category: string | null;
  }>(
    `SELECT t.title, t.amount, t.occurred_on, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.deleted_at IS NULL AND t.debt_id IS NULL AND t.kind = 'expense' AND t.occurred_on BETWEEN ?1 AND ?2
      ORDER BY t.amount DESC LIMIT 1`,
    [range.from, range.to],
  );
  const { data: bestMood } = useQuery<{
    id: string;
    title: string | null;
    entry_date: string;
    mood: number;
  }>(
    `SELECT id, title, entry_date, mood FROM journal_entries
      WHERE deleted_at IS NULL AND mood IS NOT NULL AND entry_date BETWEEN ?1 AND ?2
      ORDER BY mood DESC, entry_date DESC LIMIT 1`,
    [range.from, range.to],
  );
  const tx = bigTx[0];
  const jm = bestMood[0];

  const rows: {
    icon: LucideIcon;
    gradient: string;
    label: string;
    value: ReactNode;
    to?: string;
  }[] = [
    {
      icon: Trophy,
      gradient: 'bg-gradient-tasks',
      label: 'Hari paling produktif',
      value: best
        ? `${formatLocalDate(best.day, 'EEEE, d MMM')} · ${best.tasks_done} tugas`
        : 'Belum ada tugas selesai',
      to: best ? `/kalender?tanggal=${best.day}` : undefined,
    },
    {
      icon: Wallet,
      gradient: 'bg-linear-to-br from-rose-500 to-orange-500',
      label: 'Pengeluaran terbesar',
      value: tx
        ? `${tx.title || tx.category || 'Pengeluaran'} · ${formatIDR(tx.amount)}`
        : 'Tidak ada',
      to: tx ? `/kalender?tanggal=${tx.occurred_on}` : undefined,
    },
    {
      icon: NotebookPen,
      gradient: 'bg-gradient-journal',
      label: 'Hari terbaik',
      value: jm ? (
        <span className="inline-flex items-center gap-1.5">
          <MoodIcon mood={jm.mood} className="size-4" />{' '}
          {jm.title || formatLocalDate(jm.entry_date, 'EEEE, d MMM')}
        </span>
      ) : (
        'Belum ada jurnal dengan mood'
      ),
      to: jm ? `/jurnal?entri=${jm.id}` : undefined,
    },
    {
      icon: CodeXml,
      gradient: 'bg-gradient-vault',
      label: 'Vault',
      value: `${now.snippets_new} snippet baru · ${now.versions_new} versi project`,
      to: '/vault',
    },
  ];

  return (
    <Card className="animate-fade-up">
      <CardTitle className="mb-3">Sorotan</CardTitle>
      <ul className="space-y-1">
        {rows.map((r) => {
          const body = (
            <>
              <span
                className={cn(
                  'shine flex size-9 shrink-0 items-center justify-center rounded-xl text-white',
                  r.gradient,
                )}
              >
                <r.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-muted">{r.label}</span>
                <span className="block truncate text-sm font-bold">{r.value}</span>
              </span>
            </>
          );
          return (
            <li key={r.label}>
              {r.to ? (
                <Link
                  to={r.to}
                  className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-2 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
