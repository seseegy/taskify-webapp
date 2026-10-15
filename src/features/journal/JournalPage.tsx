import { Download, NotebookPen, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/toast-store';
import type { JournalEntry } from '@/db/schema';
import { formatLocalDate, relativeDayLabel, type LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { JournalEditor } from './components/JournalEditor';
import { JournalInsights } from './components/JournalInsights';
import { MoodIcon } from './components/MoodIcon';
import { useJournalActions } from './journal-actions';
import { useEntriesOnDate, useJournalEntries, useJournalEntry } from './journal-queries';
import { plainExcerpt } from '@/lib/markdown';
import { journalToMarkdown } from './journal-utils';
import { MOODS, moodOf } from './mood';
import { useToday } from '@/lib/useToday';
import { askConfirm } from '@/components/ui/confirm-store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * URL:
 *   ?entri=<id>        buka catatan
 *   ?baru=<tanggal>    draf baru di tanggal itu
 *   ?tanggal=<tanggal> buka catatan terakhir di tanggal itu, atau draf jika belum ada
 */
export function JournalPage() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const entriId = params.get('entri');
  const baru = DATE_RE.test(params.get('baru') ?? '') ? params.get('baru')! : null;
  const tanggal = DATE_RE.test(params.get('tanggal') ?? '') ? params.get('tanggal')! : null;
  const template = reflectionTemplate(
    params.get('templat'),
    params.get('dari'),
    params.get('sampai'),
  );

  const [search, setSearch] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [trash, setTrash] = useState(false);
  // Draf yang baru tersimpan tetap memakai key editor lama → kursor tidak hilang
  const [aliases, setAliases] = useState<Record<string, { key: string; date: LocalDate }>>({});

  const onDate = useEntriesOnDate(tanggal ?? '');
  const selected = useJournalEntry(entriId);

  let editor: {
    key: string;
    entry?: JournalEntry;
    draftDate: LocalDate;
    draftTitle?: string;
    draftContent?: string;
  } | null = null;
  if (entriId) {
    const alias = aliases[entriId];
    if (selected)
      editor = { key: alias?.key ?? entriId, entry: selected, draftDate: selected.entry_date };
    // Baru saja dibuat dari draf & belum terbaca dari DB → editor tetap terpasang
    else if (alias) editor = { key: alias.key, draftDate: alias.date };
  } else if (baru) {
    editor = { key: `draft:${baru}${template ? ':t' : ''}`, draftDate: baru, ...template };
  } else if (tanggal) {
    const last = onDate.at(-1);
    editor = last
      ? { key: last.id, entry: last, draftDate: tanggal }
      : { key: `draft:${tanggal}`, draftDate: tanggal };
  }

  const go = useCallback(
    (next: Record<string, string> | null) =>
      setParams(
        () => {
          const p = new URLSearchParams();
          for (const [k, v] of Object.entries(next ?? {})) p.set(k, v);
          return p;
        },
        { replace: false },
      ),
    [setParams],
  );

  const onCreated = useCallback(
    (id: string) => {
      if (editor)
        setAliases((a) => ({ ...a, [id]: { key: editor!.key, date: editor!.draftDate } }));
      setParams(() => new URLSearchParams({ entri: id }), { replace: true });
    },
    [editor, setParams],
  );

  return (
    <>
      <PageHeader
        title="Jurnal"
        subtitle="Catat hari & perasaanmu"
        icon={NotebookPen}
        gradient="bg-gradient-journal"
        actions={
          <Button onClick={() => go({ tanggal: today })}>
            <Plus /> <span className="hidden sm:inline">Tulis hari ini</span>
            <span className="sm:hidden">Tulis</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
        <div className={cn('min-w-0 space-y-4', editor && 'hidden lg:block')}>
          <div className="lg:hidden">
            <JournalInsights today={today} compact />
          </div>
          <EntryList
            today={today}
            activeId={editor?.entry?.id ?? null}
            search={search}
            onSearch={setSearch}
            mood={mood}
            onMood={setMood}
            trash={trash}
            onTrash={setTrash}
            onOpen={(id) => go({ entri: id })}
          />
        </div>

        <div className={cn('min-w-0', !editor && 'hidden lg:block')}>
          {editor ? (
            <Card className="animate-fade-up p-4 sm:p-6">
              <JournalEditor
                key={editor.key}
                entry={editor.entry}
                draftDate={editor.draftDate}
                draftTitle={editor.draftTitle}
                draftContent={editor.draftContent}
                onCreated={onCreated}
                onBack={() => go(null)}
              />
            </Card>
          ) : entriId ? null : (
            <JournalInsights today={today} />
          )}
        </div>
      </div>
    </>
  );
}

function EntryList({
  today,
  activeId,
  search,
  onSearch,
  mood,
  onMood,
  trash,
  onTrash,
  onOpen,
}: {
  today: LocalDate;
  activeId: string | null;
  search: string;
  onSearch: (s: string) => void;
  mood: number | null;
  onMood: (m: number | null) => void;
  trash: boolean;
  onTrash: (t: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const { entries, isLoading } = useJournalEntries({ search, mood, trash });
  const actions = useJournalActions();

  const groups = useMemo(() => {
    const pinned = trash ? [] : entries.filter((e) => e.is_pinned === 1);
    const rest = trash ? entries : entries.filter((e) => e.is_pinned !== 1);
    const byMonth = new Map<string, JournalEntry[]>();
    for (const e of rest) {
      const key = e.entry_date.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), e]);
    }
    return { pinned, months: [...byMonth.entries()] };
  }, [entries, trash]);

  const exportAll = () => {
    if (entries.length === 0) return toast('Tidak ada catatan untuk diekspor');
    const md = journalToMarkdown(
      [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
      (m) => `${moodOf(m)?.emoji ?? ''} ${moodOf(m)?.label ?? ''}`.trim(),
    );
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `taskify-jurnal-${today}.md`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Card className="p-3 sm:p-4">
      <label className="mb-3 flex h-11 items-center gap-2 rounded-xl px-3 glass">
        <Search className="size-4 text-muted" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cari di jurnal…"
          aria-label="Cari jurnal"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
        />
      </label>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {MOODS.map((m) => (
          <button
            key={m.value}
            type="button"
            title={m.label}
            aria-label={`Filter mood ${m.label}`}
            aria-pressed={mood === m.value}
            onClick={() => onMood(mood === m.value ? null : m.value)}
            className={cn(
              'flex size-9 items-center justify-center rounded-xl transition',
              mood === m.value ? cn('bg-linear-to-br shadow-md', m.className) : 'hover:bg-surface',
            )}
          >
            <MoodIcon mood={m.value} className={cn('size-5', mood === m.value && 'text-white')} />
          </button>
        ))}
        <span className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          aria-label="Ekspor Markdown"
          title="Ekspor ke Markdown"
          onClick={exportAll}
        >
          <Download />
        </Button>
        <Button
          size="icon"
          variant={trash ? 'secondary' : 'ghost'}
          aria-label="Sampah"
          aria-pressed={trash}
          title="Sampah"
          onClick={() => onTrash(!trash)}
          className={trash ? 'text-danger' : undefined}
        >
          <Trash2 />
        </Button>
      </div>

      {trash && entries.length > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-xs text-muted">
          Catatan di Sampah bisa dipulihkan.
          <button
            type="button"
            className="font-bold text-danger hover:underline"
            onClick={() =>
              void (async () => {
                const ok = await askConfirm({
                  title: 'Kosongkan Sampah jurnal?',
                  description: 'Semua catatan di Sampah dihapus permanen.',
                  confirmLabel: 'Hapus permanen',
                });
                if (ok) await actions.emptyTrash();
              })()
            }
          >
            Kosongkan
          </button>
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <EmptyState
          icon={trash ? Trash2 : NotebookPen}
          gradient="bg-gradient-journal"
          title={
            trash ? 'Sampah kosong' : search || mood ? 'Tidak ada yang cocok' : 'Belum ada catatan'
          }
          description={
            trash || search || mood ? undefined : 'Mulai dengan menulis tentang hari ini.'
          }
          className="py-8"
        />
      )}

      {groups.pinned.length > 0 && (
        <Group label="Disematkan" icon={<Pin className="size-3" />}>
          {groups.pinned.map((e) => (
            <EntryItem
              key={e.id}
              entry={e}
              today={today}
              active={e.id === activeId}
              onOpen={onOpen}
            />
          ))}
        </Group>
      )}
      {groups.months.map(([month, items]) => (
        <Group key={month} label={formatLocalDate(`${month}-01`, 'MMMM yyyy')}>
          {items.map((e) => (
            <EntryItem
              key={e.id}
              entry={e}
              today={today}
              active={e.id === activeId}
              onOpen={onOpen}
            />
          ))}
        </Group>
      ))}
    </Card>
  );
}

function Group({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="mb-1 flex items-center gap-1.5 px-2 text-xs font-bold tracking-wide text-muted uppercase">
        {icon}
        {label}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function EntryItem({
  entry,
  today,
  active,
  onOpen,
}: {
  entry: JournalEntry;
  today: LocalDate;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  const m = moodOf(entry.mood);
  const excerpt = plainExcerpt(entry.content, 110);
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl px-2.5 py-2.5 text-left transition',
        active ? 'ring-2 glass-strong ring-mod-journal/50' : 'hover:bg-surface',
      )}
    >
      <span
        className={cn(
          'flex size-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none',
          m ? cn('bg-linear-to-br text-white shadow-md', m.className) : 'bg-surface',
        )}
      >
        <span className="text-[10px] font-semibold uppercase opacity-80">
          {formatLocalDate(entry.entry_date, 'EEE')}
        </span>
        <span className="text-lg font-extrabold">{formatLocalDate(entry.entry_date, 'd')}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold">
            {entry.title || relativeDayLabel(entry.entry_date, today)}
          </span>
          {m && <MoodIcon mood={entry.mood} />}
        </span>
        <span className="line-clamp-2 text-xs text-muted">{excerpt || 'Belum ada isi'}</span>
      </span>
    </button>
  );
}

/** Templat refleksi dari halaman Review: ?templat=review-minggu|review-bulan&dari=&sampai= */
function reflectionTemplate(kind: string | null, from: string | null, to: string | null) {
  if (!kind?.startsWith('review-') || !from || !to || !DATE_RE.test(from) || !DATE_RE.test(to))
    return null;
  const monthly = kind === 'review-bulan';
  const label = monthly
    ? formatLocalDate(from, 'MMMM yyyy')
    : `${formatLocalDate(from, 'd MMM')} – ${formatLocalDate(to, 'd MMM yyyy')}`;
  return {
    draftTitle: `Refleksi ${monthly ? 'bulan' : 'minggu'} ${label}`,
    draftContent: [
      '### Yang berjalan baik',
      '- ',
      '',
      '### Yang bisa diperbaiki',
      '- ',
      '',
      '### Pelajaran',
      '- ',
      '',
      `### Fokus ${monthly ? 'bulan' : 'minggu'} depan`,
      '- [ ] ',
      '',
    ].join('\n'),
  };
}
