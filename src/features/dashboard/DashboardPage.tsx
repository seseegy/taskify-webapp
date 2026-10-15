import {
  ArrowRight,
  Flame,
  CodeXml,
  ListChecks,
  NotebookPen,
  Plus,
  Sparkles,
  StickyNote,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { TypedText } from '@/components/ui/TypedText';
import { homeGreeting } from '@/features/auth/display-name';
import { useDisplayName } from '@/features/auth/useDisplayName';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useTxSheet } from '@/features/finance/tx-sheet-store';
import { ActivityHeatmap } from '@/features/review/ActivityHeatmap';
import { ActivityDots } from '@/features/calendar/ActivityDots';
import { buildWeek } from '@/features/calendar/calendar-utils';
import { EMPTY_DAY } from '@/features/calendar/useCalendarActivity';
import { useDayActivity } from '@/features/calendar/useDayActivity';
import { FocusCard } from './FocusCard';
import { formatLocalDate, greeting } from '@/lib/date';
import { formatIDR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useTodaySummary } from './useTodaySummary';

export function DashboardPage() {
  const { summary, today } = useTodaySummary();
  const createTx = useTxSheet((st) => st.create);
  const { name, ready: nameReady } = useDisplayName();
  // Efek ketik berurutan: sapaan dulu, lalu kalimat ringkasan (kalau tidak, dua animasi
  // berjalan bersamaan). Ringkasan juga menunggu data tugas (`summary`) supaya yang terketik
  // tidak berubah di tengah jalan dari "Belum ada tugas" menjadi "Ada 3 tugas".
  const [greetDone, setGreetDone] = useState(false);
  const s = summary;
  const summaryText = `${
    s && s.tasks_today > 0
      ? `Ada ${s.tasks_today - s.tasks_today_done} tugas tersisa hari ini.`
      : 'Belum ada tugas untuk hari ini. Nikmati harimu!'
  }${s && s.tasks_overdue > 0 ? ` ${s.tasks_overdue} tugas lewat tenggat.` : ''}`;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative animate-fade-up overflow-hidden rounded-3xl p-6 glass sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-gradient-brand opacity-30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-10 size-64 rounded-full bg-gradient-finance opacity-20 blur-3xl" />
        <p className="relative text-sm font-semibold text-muted capitalize">
          {formatLocalDate(today, 'EEEE, d MMMM yyyy')}
        </p>
        <TypedText
          as="h1"
          className="relative mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl"
          text={homeGreeting(greeting(), name)}
          // Menunggu pengaturan terbaca: nama belum diketahui sebelum itu
          enabled={nameReady}
          onceKey="taskify-fx-home-greet"
          onDone={() => setGreetDone(true)}
          after={
            <Sparkles
              aria-hidden="true"
              className="ml-2 inline size-7 align-[-2px] text-fuchsia-400 sm:size-8"
            />
          }
        />
        <TypedText
          as="p"
          className="relative mt-2 max-w-xl text-sm text-muted"
          text={summaryText}
          enabled={greetDone && !!s}
          onceKey="taskify-fx-home-summary"
        />
      </section>

      {/* Ringkasan */}
      {/* 5 kartu: di HP (2 kolom) kartu terakhir melebar penuh agar tidak ada sel kosong */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard
          to="/tugas"
          icon={ListChecks}
          gradient="bg-gradient-tasks"
          label="Tugas hari ini"
          value={s ? `${s.tasks_today_done}/${s.tasks_today}` : '–'}
          hint={s && s.tasks_overdue > 0 ? `${s.tasks_overdue} terlambat` : 'selesai'}
          delay={0}
        />
        <StatCard
          to="/keuangan"
          icon={Wallet}
          gradient="bg-gradient-finance"
          label="Pengeluaran hari ini"
          value={s ? formatIDR(s.expense_today) : '–'}
          hint={s ? `Bulan ini ${formatIDR(s.expense_month)}` : undefined}
          delay={60}
        />
        <StatCard
          to={`/jurnal?tanggal=${today}`}
          icon={NotebookPen}
          gradient="bg-gradient-journal"
          label="Jurnal"
          value={s ? (s.journal_today > 0 ? 'Sudah ditulis' : 'Belum') : '–'}
          hint="hari ini"
          delay={120}
        />
        <StatCard
          to="/catatan"
          icon={StickyNote}
          gradient="bg-gradient-notes"
          label="Catatan"
          value={s ? String(s.notes_total) : '–'}
          hint="tersimpan"
          delay={180}
        />
        <StatCard
          to="/vault"
          icon={CodeXml}
          gradient="bg-gradient-vault"
          label="Snippet tersimpan"
          value={s ? String(s.snippets_total) : '–'}
          hint="di vault"
          delay={240}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <WeekStrip today={today} />
        <Card className="animate-fade-up">
          <CardHeader className="mb-2">
            <div>
              <CardTitle>Saldo total</CardTitle>
              <CardDescription>Semua dompet</CardDescription>
            </div>
            <Button size="sm" onClick={() => createTx()}>
              <Plus /> Catat
            </Button>
          </CardHeader>
          <p className="text-gradient-brand text-3xl font-extrabold tracking-tight">
            {s ? formatIDR(s.balance) : '–'}
          </p>
          {s && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-success/10 px-3 py-2">
                <p className="text-xs text-muted">Masuk bulan ini</p>
                <p className="font-bold text-success">{formatIDR(s.income_month)}</p>
              </div>
              <div className="rounded-xl bg-danger/10 px-3 py-2">
                <p className="text-xs text-muted">Keluar bulan ini</p>
                <p className="font-bold text-danger">{formatIDR(s.expense_month)}</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <FocusCard today={today} />
        <ActivityCard />
      </div>
    </div>
  );
}

function StatCard({
  to,
  icon: Icon,
  gradient,
  label,
  value,
  hint,
  delay,
  className,
}: {
  to: string;
  icon: LucideIcon;
  gradient: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delay: number;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group relative animate-fade-up overflow-hidden rounded-card p-4 glass transition hover:-translate-y-0.5 sm:p-5',
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={cn(
          'pointer-events-none absolute -top-10 -right-10 size-28 rounded-full opacity-25 blur-2xl transition group-hover:opacity-40',
          gradient,
        )}
      />
      <span
        className={cn(
          'shine relative mb-3 flex size-10 items-center justify-center rounded-xl text-white shadow-md',
          gradient,
        )}
      >
        <Icon className="size-5" />
      </span>
      <p className="relative text-xs font-semibold text-muted">{label}</p>
      <p className="relative mt-0.5 truncate text-lg font-extrabold tracking-tight sm:text-xl">
        {value}
      </p>
      {hint && <p className="relative truncate text-xs text-muted">{hint}</p>}
    </Link>
  );
}

function WeekStrip({ today }: { today: string }) {
  const week = buildWeek(today);
  const { byDay } = useDayActivity(week[0]!, week[6]!);

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div>
          <CardTitle>Minggu ini</CardTitle>
          <CardDescription>Aktivitas di semua modul</CardDescription>
        </div>
        <Link
          to="/kalender"
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          Kalender <ArrowRight className="size-4" />
        </Link>
      </CardHeader>
      <div className="grid grid-cols-7 gap-1.5">
        {week.map((day) => {
          const isToday = day === today;
          const activity = byDay.get(day) ?? EMPTY_DAY;
          return (
            <div
              key={day}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-2xl py-3',
                isToday ? 'shine bg-gradient-calendar text-white shadow-lg' : 'bg-surface',
              )}
            >
              <span className={cn('text-[11px] font-semibold', !isToday && 'text-muted')}>
                {formatLocalDate(day, 'EEEEEE')}
              </span>
              <span className="text-lg font-extrabold">{formatLocalDate(day, 'd')}</span>
              <ActivityDots activity={activity} className="h-1.5" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ActivityCard() {
  const navigate = useNavigate();
  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Flame className="size-4 text-fuchsia-500" /> Jejak aktivitas
          </CardTitle>
          <CardDescription>16 minggu terakhir</CardDescription>
        </div>
        <Link
          to="/review"
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          Review <ArrowRight className="size-4" />
        </Link>
      </CardHeader>
      <ActivityHeatmap weeks={16} onSelect={(d) => navigate(`/kalender?tanggal=${d}`)} />
    </Card>
  );
}
