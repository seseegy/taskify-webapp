import { ArrowLeft, CalendarPlus, CalendarX, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MarkdownEditor } from '@/components/ui/MarkdownEditor';
import { SaveIndicator, type SaveState } from '@/components/ui/SaveIndicator';
import { toast } from '@/components/ui/toast-store';
import type { Note } from '@/db/schema';
import { LinksPanel } from '@/features/links/LinksPanel';
import { TagPicker } from '@/features/tags/TagPicker';
import { formatLocalDate, type LocalDate } from '@/lib/date';
import { wordCount } from '@/lib/markdown';
import { useToday } from '@/lib/useToday';
import { useNoteActions, type NotePatch } from '../note-actions';

interface Props {
  /** Catatan yang sudah ada, atau undefined untuk draf baru */
  note?: Note;
  /** Tanggal awal draf baru; null = catatan bebas */
  draftDate: LocalDate | null;
  onCreated: (id: string) => void;
  onBack: () => void;
}

const DEBOUNCE_MS = 700;

/**
 * Editor catatan dengan simpan otomatis (pola yang sama dengan JournalEditor).
 * - Draf baru baru dibuat di DB saat ada judul/isi pertama (tidak meninggalkan catatan kosong).
 * - Teks disimpan setelah berhenti mengetik 0,7 dtk; tanggal/pin langsung.
 * - Perubahan tertunda disimpan saat editor ditutup, aplikasi di-background, atau tab ditutup.
 * - Jika simpan gagal, perubahan dikembalikan ke antrean (tidak hilang) dan bisa dicoba lagi.
 * State lokal adalah sumber kebenaran selama mengedit (data sync tidak menimpa ketikan).
 */
export function NoteEditor({ note, draftDate, onCreated, onBack }: Props) {
  const actions = useNoteActions();
  const today = useToday();
  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [date, setDate] = useState<LocalDate | null>(note ? note.note_date : draftDate);
  const [pinned, setPinned] = useState(note?.is_pinned === 1);
  const [state, setState] = useState<SaveState>(note ? 'saved' : 'idle');

  const [savedId, setSavedId] = useState<string | null>(note?.id ?? null);
  const idRef = useRef<string | null>(note?.id ?? null);
  const pendingRef = useRef<NotePatch>({});
  const latestRef = useRef({ title, content, date, pinned });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const onCreatedRef = useRef(onCreated);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    latestRef.current = { title, content, date, pinned };
  }, [title, content, date, pinned]);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);

  const flush = useCallback(
    function flushNow(): Promise<void> {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      const patch = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(patch).length === 0) return chainRef.current;

      // Serialkan penyimpanan agar create selalu selesai sebelum update berikutnya.
      // Langkah ini TIDAK boleh reject: promise yang reject akan membuat semua `.then`
      // berikutnya dilewati → simpan otomatis berhenti diam-diam.
      chainRef.current = chainRef.current.then(async () => {
        setState('saving');
        try {
          if (!idRef.current) {
            const v = latestRef.current;
            if (!v.title.trim() && !v.content.trim()) {
              setState('idle');
              return;
            }
            idRef.current = await actions.create({
              note_date: v.date,
              title: v.title,
              content: v.content,
              is_pinned: v.pinned ? 1 : 0,
            });
            setSavedId(idRef.current);
            onCreatedRef.current(idRef.current);
          } else {
            await actions.update(idRef.current, patch);
          }
          setState(Object.keys(pendingRef.current).length ? 'pending' : 'saved');
        } catch (err) {
          // Kembalikan perubahan ke antrean; perubahan yang lebih baru tetap menang.
          pendingRef.current = { ...patch, ...pendingRef.current };
          setState('error');
          console.error('[catatan] gagal menyimpan', err);
          // Editor sudah ditutup → indikator tidak terlihat, beri tahu lewat toast.
          if (!mountedRef.current) {
            toast('Gagal menyimpan catatan', {
              tone: 'danger',
              duration: 10_000,
              action: { label: 'Coba lagi', onClick: () => flushNow() },
            });
          }
        }
      });
      return chainRef.current;
    },
    [actions],
  );

  const queue = (patch: NotePatch, immediate = false) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    setState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    if (immediate) void flush();
    else timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  // Simpan sisa perubahan saat editor ditutup / pindah catatan
  useEffect(() => () => void flush(), [flush]);

  // PWA di HP sering ditutup/di-background tanpa unmount → simpan ketikan dalam jeda debounce
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush]);

  const removed = note?.deleted_at != null;

  const changeDate = (next: LocalDate | null) => {
    setDate(next);
    queue({ note_date: next }, true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Kembali ke daftar"
          onClick={onBack}
          className="lg:hidden"
        >
          <ArrowLeft />
        </Button>

        {date ? (
          <>
            <input
              type="date"
              aria-label="Tanggal catatan"
              value={date}
              onChange={(e) => {
                // Mengosongkan kolom tanggal bukan "lepas tanggal" — itu aksi eksplisit di bawah.
                if (e.target.value) changeDate(e.target.value);
              }}
              className="h-9 rounded-xl px-3 text-sm font-semibold glass outline-none"
            />
            <span className="hidden text-sm font-semibold text-muted capitalize sm:inline">
              {formatLocalDate(date, 'EEEE')}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Lepas dari tanggal"
              title="Lepas dari tanggal (jadi catatan bebas)"
              onClick={() => changeDate(null)}
            >
              <CalendarX />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => changeDate(today)}>
            <CalendarPlus /> Tempel ke tanggal
          </Button>
        )}

        <span className="flex-1" />
        <SaveIndicator state={state} onRetry={() => void flush()} />
        <Button
          size="icon"
          variant="ghost"
          aria-label={pinned ? 'Lepas sematan' : 'Sematkan'}
          aria-pressed={pinned}
          onClick={() => {
            setPinned(!pinned);
            queue({ is_pinned: pinned ? 0 : 1 }, true);
          }}
          className={pinned ? 'text-primary' : undefined}
        >
          {pinned ? <PinOff /> : <Pin />}
        </Button>
        {savedId && !removed && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Hapus catatan"
            className="text-danger"
            onClick={() => {
              void flush().then(() => actions.remove(savedId));
              onBack();
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {removed && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
          Catatan ini ada di Sampah.
          <Button size="sm" variant="secondary" onClick={() => void actions.restore(note!.id)}>
            <RotateCcw /> Pulihkan
          </Button>
        </div>
      )}

      <Input
        // Draf baru: langsung bisa mengetik. Catatan yang sudah ada tidak merebut fokus
        // (pengguna mungkin hanya membaca).
        autoFocus={!note}
        value={title}
        placeholder="Judul (opsional)"
        aria-label="Judul"
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
          queue({ title: e.target.value });
        }}
        className="h-12 border-transparent bg-transparent px-1 text-xl font-semibold shadow-none backdrop-blur-none focus:ring-0"
      />

      <MarkdownEditor
        gradient="bg-gradient-notes"
        ariaLabel="Isi catatan"
        value={content}
        placeholder={
          'Tulis apa saja…\n\nMendukung Markdown: **tebal**, _miring_, - daftar, - [ ] checklist'
        }
        onChange={(v) => {
          setContent(v);
          queue({ content: v });
        }}
      />
      <p className="text-right text-xs text-muted">{wordCount(content)} kata</p>

      {savedId ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted">Tag</p>
            <TagPicker type="note" entityId={savedId} />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted">Tautan</p>
            <LinksPanel type="note" id={savedId} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Tag & tautan tersedia setelah catatan tersimpan.</p>
      )}
    </div>
  );
}
