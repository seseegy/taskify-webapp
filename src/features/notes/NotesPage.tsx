import { Download, Pin, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { askConfirm } from '@/components/ui/confirm-store';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { toast } from '@/components/ui/toast-store';
import type { Note } from '@/db/schema';
import { TagChip } from '@/features/tags/TagPicker';
import { useTagMap } from '@/features/tags/tag-actions';
import { formatLocalDate, type LocalDate } from '@/lib/date';
import { plainExcerpt } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { useToday } from '@/lib/useToday';
import { NoteEditor } from './components/NoteEditor';
import { NotesOverview } from './components/NotesOverview';
import { useNoteActions } from './note-actions';
import { useNote, useNotes } from './note-queries';
import {
  groupLabel,
  groupNotes,
  isNoteScope,
  noteDateLabel,
  NOTE_SCOPES,
  notesToMarkdown,
  type NoteScope,
} from './note-utils';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * URL:
 *   ?catatan=<id>       buka catatan
 *   ?baru               draf catatan bebas
 *   ?baru=<tanggal>     draf yang ditempel ke tanggal itu
 */
export function NotesPage() {
  const today = useToday();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const noteId = params.get('catatan');
  // null = tidak ada draf; { date: null } = draf bebas; { date } = draf bertanggal
  const baruRaw = params.get('baru');
  const draft: { date: LocalDate | null } | null =
    baruRaw === null ? null : { date: DATE_RE.test(baruRaw) ? baruRaw : null };

  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<NoteScope>('all');
  const [trash, setTrash] = useState(false);
  // Draf yang baru tersimpan tetap memakai key editor lama → kursor tidak hilang
  const [aliases, setAliases] = useState<Record<string, { key: string; date: LocalDate | null }>>(
    {},
  );

  const selected = useNote(noteId);

  let editor: { key: string; note?: Note; draftDate: LocalDate | null } | null = null;
  if (noteId) {
    const alias = aliases[noteId];
    if (selected) editor = { key: alias?.key ?? noteId, note: selected, draftDate: null };
    // Baru saja dibuat dari draf & belum terbaca dari DB → editor tetap terpasang
    else if (alias) editor = { key: alias.key, draftDate: alias.date };
  } else if (draft) {
    // `location.key` berubah di tiap navigasi → menekan "Catatan baru" lagi selalu memulai
    // editor baru, bukan memakai ulang editor catatan yang barusan tersimpan.
    editor = { key: `draft:${location.key}`, draftDate: draft.date };
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

  const create = useCallback((date: LocalDate | null) => go({ baru: date ?? '' }), [go]);

  const onCreated = useCallback(
    (id: string) => {
      if (editor)
        setAliases((a) => ({ ...a, [id]: { key: editor!.key, date: editor!.draftDate } }));
      setParams(() => new URLSearchParams({ catatan: id }), { replace: true });
    },
    [editor, setParams],
  );

  return (
    <>
      <PageHeader
        title="Catatan"
        subtitle="Ide, daftar, dan apa pun yang perlu diingat"
        icon={StickyNote}
        gradient="bg-gradient-notes"
        actions={
          <Button onClick={() => create(null)}>
            <Plus /> <span className="hidden sm:inline">Catatan baru</span>
            <span className="sm:hidden">Baru</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
        <div className={cn('min-w-0 space-y-4', editor && 'hidden lg:block')}>
          <div className="lg:hidden">
            <NotesOverview today={today} onCreate={create} compact />
          </div>
          <NoteList
            today={today}
            activeId={editor?.note?.id ?? null}
            search={search}
            onSearch={setSearch}
            scope={scope}
            onScope={setScope}
            trash={trash}
            onTrash={setTrash}
            onOpen={(id) => go({ catatan: id })}
            onCreate={() => create(null)}
          />
        </div>

        <div className={cn('min-w-0', !editor && 'hidden lg:block')}>
          {editor ? (
            <Card className="animate-fade-up p-4 sm:p-6">
              <NoteEditor
                key={editor.key}
                note={editor.note}
                draftDate={editor.draftDate}
                onCreated={onCreated}
                onBack={() => go(null)}
              />
            </Card>
          ) : noteId ? null : (
            <NotesOverview today={today} onCreate={create} />
          )}
        </div>
      </div>
    </>
  );
}

function NoteList({
  today,
  activeId,
  search,
  onSearch,
  scope,
  onScope,
  trash,
  onTrash,
  onOpen,
  onCreate,
}: {
  today: LocalDate;
  activeId: string | null;
  search: string;
  onSearch: (s: string) => void;
  scope: NoteScope;
  onScope: (s: NoteScope) => void;
  trash: boolean;
  onTrash: (t: boolean) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { notes, isLoading } = useNotes({ search, scope, trash });
  const tagMap = useTagMap('note');
  const actions = useNoteActions();

  const { pinned, groups } = useMemo(() => groupNotes(notes, trash), [notes, trash]);
  const filtering = search.trim() !== '' || scope !== 'all';

  const exportAll = () => {
    if (notes.length === 0) return toast('Tidak ada catatan untuk diekspor');
    const md = notesToMarkdown(
      [...notes].sort((a, b) => (a.note_date ?? '').localeCompare(b.note_date ?? '')),
    );
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `taskify-catatan-${today}.md`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const item = (n: Note) => (
    <NoteItem
      key={n.id}
      note={n}
      today={today}
      active={n.id === activeId}
      tags={tagMap.get(n.id) ?? []}
      onOpen={onOpen}
    />
  );

  return (
    <Card className="p-3 sm:p-4">
      <label className="mb-3 flex h-11 items-center gap-2 rounded-xl px-3 glass focus-within:ring-4 focus-within:ring-primary/15">
        <Search className="size-4 text-muted" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cari di catatan…"
          aria-label="Cari catatan"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
        />
      </label>
      <div className="mb-3 flex items-center gap-1.5">
        <SegmentedControl
          label="Jenis catatan"
          value={scope}
          options={NOTE_SCOPES}
          onChange={(v) => isNoteScope(v) && onScope(v)}
          className="min-w-0 flex-1 [&_button]:px-2"
        />
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

      {/* Jumlah hasil untuk pembaca layar saat mencari/menyaring */}
      <p role="status" className="sr-only">
        {!isLoading && filtering ? `${notes.length} catatan ditemukan` : ''}
      </p>

      {trash && notes.length > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-xs text-muted">
          Catatan di Sampah bisa dipulihkan.
          <button
            type="button"
            className="font-bold text-danger hover:underline"
            onClick={() =>
              void (async () => {
                const ok = await askConfirm({
                  title: 'Kosongkan Sampah catatan?',
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

      {!isLoading && notes.length === 0 && (
        <EmptyState
          icon={trash ? Trash2 : StickyNote}
          gradient="bg-gradient-notes"
          title={trash ? 'Sampah kosong' : filtering ? 'Tidak ada yang cocok' : 'Belum ada catatan'}
          description={
            trash
              ? undefined
              : filtering
                ? 'Coba kata kunci lain atau ganti jenis catatan.'
                : 'Tulis ide, daftar, atau apa pun — bebas atau ditempel ke tanggal.'
          }
          className="py-8"
        >
          {!trash && !filtering && (
            <Button onClick={onCreate}>
              <Plus /> Tulis catatan
            </Button>
          )}
        </EmptyState>
      )}

      {pinned.length > 0 && (
        <Group label="Disematkan" icon={<Pin className="size-3" aria-hidden="true" />}>
          {pinned.map(item)}
        </Group>
      )}
      {groups.map(([key, items]) => (
        <Group key={key} label={groupLabel(key)}>
          {items.map(item)}
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

function NoteItem({
  note,
  today,
  active,
  tags,
  onOpen,
}: {
  note: Note;
  today: LocalDate;
  active: boolean;
  tags: { id: string; name: string; color: string | null }[];
  onOpen: (id: string) => void;
}) {
  const excerpt = plainExcerpt(note.content, 110);
  const dated = note.note_date !== null;
  return (
    <button
      type="button"
      onClick={() => onOpen(note.id)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl px-2.5 py-2.5 text-left transition',
        active ? 'ring-2 glass-strong ring-mod-notes/50' : 'hover:bg-surface',
      )}
    >
      <span
        className={cn(
          'flex size-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none',
          dated ? 'shine bg-gradient-notes text-white shadow-md' : 'bg-surface text-mod-notes',
        )}
      >
        {dated ? (
          <>
            <span className="text-[10px] font-semibold uppercase opacity-80">
              {formatLocalDate(note.note_date!, 'EEE')}
            </span>
            <span className="text-lg font-extrabold">{formatLocalDate(note.note_date!, 'd')}</span>
          </>
        ) : (
          <StickyNote className="size-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold">{note.title || 'Tanpa judul'}</span>
          {note.is_pinned === 1 && (
            <Pin className="size-3 shrink-0 text-primary" aria-label="Disematkan" />
          )}
        </span>
        <span className="line-clamp-2 text-xs text-muted">{excerpt || 'Belum ada isi'}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-semibold text-muted">
            {noteDateLabel(note.note_date, today)}
          </span>
          {tags.slice(0, 3).map((t) => (
            <TagChip key={t.id} tag={t} link={false} size="sm" />
          ))}
          {tags.length > 3 && (
            <span className="text-[10px] font-semibold text-muted">+{tags.length - 3}</span>
          )}
        </span>
      </span>
    </button>
  );
}
