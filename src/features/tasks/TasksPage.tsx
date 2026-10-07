import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CircleCheckBig,
  Inbox,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast-store';
import type { Task, TaskList } from '@/db/schema';
import {
  addLocalDays,
  parseTimestamp,
  relativeDayLabel,
  todayLocal,
  type LocalDate,
} from '@/lib/date';
import { cn } from '@/lib/utils';
import { useTagMap } from '@/features/tags/tag-actions';
import { ListDialog } from './components/ListDialog';
import { QuickAdd } from './components/QuickAdd';
import { TaskRow } from './components/TaskRow';
import { useTaskActions } from './task-actions';
import {
  isListView,
  useListCounts,
  useSubtaskProgress,
  useTaskLists,
  useTaskViewRows,
  useViewCounts,
  type SmartView,
  type TaskView,
  type ViewCounts,
} from './task-queries';
import { groupByDate, listColor, type TaskGroup } from './task-utils';

const SMART_VIEWS: {
  view: SmartView;
  label: string;
  icon: LucideIcon;
  count?: keyof ViewCounts;
  danger?: boolean;
}[] = [
  { view: 'today', label: 'Hari ini', icon: Sun, count: 'today' },
  { view: 'upcoming', label: 'Mendatang', icon: CalendarClock, count: 'upcoming' },
  { view: 'overdue', label: 'Terlambat', icon: AlarmClock, count: 'overdue', danger: true },
  { view: 'all', label: 'Semua', icon: Inbox, count: 'all' },
  { view: 'done', label: 'Selesai', icon: CircleCheckBig },
  { view: 'trash', label: 'Sampah', icon: Trash2, count: 'trash' },
];

/** Jumlah tugas yang ditampilkan per tahap (tombol "Tampilkan lebih banyak"). */
const PAGE_SIZE = 100;

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as TaskView | null) ?? 'today';
  const setView = (v: TaskView) =>
    setParams((p) => {
      p.set('view', v);
      return p;
    });

  const today = todayLocal();
  const lists = useTaskLists();
  const counts = useViewCounts(today);
  const listCounts = useListCounts();
  const [dialog, setDialog] = useState<{ open: boolean; list: TaskList | null }>({
    open: false,
    list: null,
  });

  const currentList = isListView(view) ? lists.find((l) => l.id === view.slice(5)) : undefined;
  const smart = SMART_VIEWS.find((s) => s.view === view);
  const title = currentList?.name ?? smart?.label ?? 'Tugas';

  return (
    <>
      <PageHeader
        title="Tugas"
        subtitle={
          counts
            ? `${counts.today} tugas hari ini · ${counts.all} aktif`
            : 'Rencanakan & selesaikan'
        }
        icon={ListChecks}
        gradient="bg-gradient-tasks"
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[250px_1fr]">
        {/* Navigasi tampilan */}
        <nav aria-label="Tampilan tugas" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <Card className="-mx-1 flex gap-1.5 overflow-x-auto p-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:p-3">
            {SMART_VIEWS.map((s) => {
              const n = s.count && counts ? counts[s.count] : 0;
              return (
                <NavButton
                  key={s.view}
                  active={view === s.view}
                  onClick={() => setView(s.view)}
                  icon={<s.icon className="size-4" />}
                  label={s.label}
                  count={n}
                  danger={s.danger && n > 0}
                />
              );
            })}

            <div className="mx-1 my-1 hidden items-center justify-between px-2 pt-3 lg:flex">
              <span className="text-xs font-bold tracking-wide text-muted uppercase">Daftar</span>
              <button
                type="button"
                aria-label="Daftar baru"
                onClick={() => setDialog({ open: true, list: null })}
                className="hit-area flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <span className="mx-1 w-px shrink-0 bg-line lg:hidden" />

            {lists.map((l) => (
              <NavButton
                key={l.id}
                active={view === `list:${l.id}`}
                onClick={() => setView(`list:${l.id}`)}
                icon={<span className={cn('size-2.5 rounded-full', listColor(l.color).dot)} />}
                label={l.name}
                count={listCounts.get(l.id) ?? 0}
              />
            ))}
            <button
              type="button"
              onClick={() => setDialog({ open: true, list: null })}
              className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap text-muted hover:bg-surface hover:text-fg lg:hidden"
            >
              <Plus className="size-4" /> Daftar
            </button>
          </Card>
        </nav>

        {/* Konten */}
        <Card className="min-w-0 animate-fade-up p-3 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3 px-1">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              {currentList && (
                <span className={cn('size-3 rounded-full', listColor(currentList.color).dot)} />
              )}
              {title}
            </h2>
            {currentList && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDialog({ open: true, list: currentList })}
              >
                <Pencil /> Ubah
              </Button>
            )}
          </div>

          {view !== 'done' && view !== 'trash' && (
            <QuickAdd
              className="mb-4"
              listId={currentList?.id ?? null}
              defaultDate={defaultDateFor(view, today)}
            />
          )}

          {/* key: state "tampilkan lebih banyak" ikut direset tiap pindah tampilan */}
          <TaskViewContent
            key={view}
            view={view}
            today={today}
            lists={lists}
            overdueCount={counts?.overdue ?? 0}
            onView={setView}
          />
        </Card>
      </div>

      <ListDialog
        open={dialog.open}
        list={dialog.list}
        onClose={() => setDialog({ open: false, list: null })}
        onCreated={(id) => setView(`list:${id}`)}
        onDeleted={() => setView('today')}
      />
    </>
  );
}

function defaultDateFor(view: TaskView, today: LocalDate): LocalDate | null {
  if (view === 'today' || view === 'overdue') return today;
  if (view === 'upcoming') return addLocalDays(today, 1);
  return null;
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  count,
  danger,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count: number;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap transition',
        active
          ? 'shine bg-gradient-tasks text-white shadow-md shadow-violet-500/25'
          : 'text-muted hover:bg-surface hover:text-fg',
      )}
    >
      {icon}
      <span className="flex-1 truncate text-left">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            'min-w-5 rounded-full px-1.5 text-center text-xs font-bold',
            active ? 'bg-white/25' : danger ? 'bg-danger/15 text-danger' : 'bg-surface',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function TaskViewContent({
  view,
  today,
  lists,
  overdueCount,
  onView,
}: {
  view: TaskView;
  today: LocalDate;
  lists: TaskList[];
  overdueCount: number;
  onView: (v: TaskView) => void;
}) {
  const { data: rows, isLoading } = useTaskViewRows(view, today);
  const progress = useSubtaskProgress();
  const tagMap = useTagMap('task');
  const actions = useTaskActions();
  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const inList = isListView(view);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const groups: TaskGroup[] = useMemo(() => {
    if (view === 'today') {
      const active = rows.filter((t) => t.status !== 'done');
      const done = rows.filter((t) => t.status === 'done');
      return [
        { key: 'active', label: '', items: active },
        ...(done.length
          ? [
              {
                key: 'done',
                label: `Selesai hari ini (${done.length})`,
                tone: 'muted' as const,
                items: done,
              },
            ]
          : []),
      ];
    }
    if (view === 'done' || view === 'trash') return groupByFinished(rows, view, today);
    return groupByDate(rows, today);
  }, [rows, view, today]);

  if (isLoading) return <LoadingRows label="Memuat tugas…" />;

  const empty = rows.length === 0;

  // Daftar bisa tumbuh tanpa batas (terutama Selesai & Sampah) → tampilkan bertahap agar DOM kecil.
  // Dipotong lintas grup berurutan; batas kembali ke awal saat pindah tampilan (lewat `key`).
  const visibleGroups = groups.map((g, i) => {
    const before = groups.slice(0, i).reduce((n, x) => n + x.items.length, 0);
    return { ...g, items: g.items.slice(0, Math.max(0, limit - before)) };
  });
  const hiddenCount = rows.length - visibleGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-5">
      {view === 'today' && overdueCount > 0 && (
        <button
          type="button"
          onClick={() => onView('overdue')}
          className="flex w-full items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-left text-sm font-semibold text-danger"
        >
          <AlarmClock className="size-4" /> {overdueCount} tugas terlambat — lihat
        </button>
      )}

      {view === 'trash' && !empty && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          <span>Tugas di Sampah bisa dipulihkan kapan saja.</span>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={async () => {
              if (!window.confirm('Kosongkan Sampah? Semua tugas di dalamnya dihapus permanen.'))
                return;
              const n = await actions.emptyTrash();
              toast(`${n} tugas dihapus permanen`);
            }}
          >
            <Trash2 /> Kosongkan
          </Button>
        </div>
      )}

      {empty && <EmptyView view={view} />}

      {visibleGroups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.key}>
              {g.label && (
                <h3
                  className={cn(
                    'mb-1 px-3 text-xs font-bold tracking-wide uppercase',
                    g.tone === 'danger' ? 'text-danger' : 'text-muted',
                  )}
                >
                  {g.label}
                </h3>
              )}
              <div className="space-y-0.5">
                {g.items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    today={today}
                    onToggle={(task) => void actions.toggle(task)}
                    progress={progress.get(t.id)}
                    tags={tagMap.get(t.id)}
                    list={t.list_id ? listById.get(t.list_id) : undefined}
                    showList={!inList}
                    // Grup per hari sudah menampilkan tanggal di judulnya
                    showDate={view === 'done' || view === 'trash' || g.key === 'overdue'}
                    trailing={
                      view === 'trash' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            void actions.restore(t.id);
                          }}
                        >
                          <RotateCcw /> Pulihkan
                        </Button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ),
      )}

      {hiddenCount > 0 && (
        <div className="flex justify-center pt-1">
          <Button variant="secondary" onClick={() => setLimit(limit + PAGE_SIZE)}>
            Tampilkan {Math.min(PAGE_SIZE, hiddenCount)} lagi ({hiddenCount} tersisa)
          </Button>
        </div>
      )}
    </div>
  );
}

function groupByFinished(rows: Task[], view: 'done' | 'trash', today: LocalDate): TaskGroup[] {
  const map = new Map<string, Task[]>();
  for (const t of rows) {
    const stamp = view === 'trash' ? t.deleted_at : (t.completed_at ?? t.updated_at);
    const day = stamp ? todayLocal(parseTimestamp(stamp)) : today;
    map.set(day, [...(map.get(day) ?? []), t]);
  }
  return [...map.entries()].map(([day, items]) => ({
    key: day,
    label: `${view === 'trash' ? 'Dihapus' : 'Selesai'} ${relativeDayLabel(day, today).toLowerCase()}`,
    tone: 'muted' as const,
    items,
  }));
}

const EMPTY: Record<string, { title: string; description: string; icon: LucideIcon }> = {
  today: {
    title: 'Hari ini kosong',
    description: 'Tambahkan tugas di atas, atau nikmati waktu luangmu ✨',
    icon: Sun,
  },
  upcoming: {
    title: 'Belum ada rencana',
    description: 'Tugas dengan tanggal mendatang akan muncul di sini.',
    icon: CalendarDays,
  },
  overdue: {
    title: 'Tidak ada yang terlambat',
    description: 'Semua tugas tepat waktu. Mantap!',
    icon: CircleCheckBig,
  },
  all: {
    title: 'Belum ada tugas',
    description: 'Mulai dengan menambahkan tugas pertamamu.',
    icon: Inbox,
  },
  done: {
    title: 'Belum ada yang selesai',
    description: 'Tugas yang kamu centang akan tercatat di sini.',
    icon: CircleCheckBig,
  },
  trash: {
    title: 'Sampah kosong',
    description: 'Tugas yang dihapus bisa dipulihkan dari sini.',
    icon: Trash2,
  },
  list: {
    title: 'Daftar ini kosong',
    description: 'Tambahkan tugas pertama untuk daftar ini.',
    icon: ListChecks,
  },
};

function EmptyView({ view }: { view: TaskView }) {
  const e = EMPTY[isListView(view) ? 'list' : view]!;
  return (
    <EmptyState
      icon={e.icon}
      title={e.title}
      description={e.description}
      gradient="bg-gradient-tasks"
    />
  );
}
