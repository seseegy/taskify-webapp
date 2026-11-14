import { ArrowLeft, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MarkdownEditor } from '@/components/ui/MarkdownEditor';
import { SaveIndicator, type SaveState } from '@/components/ui/SaveIndicator';
import { toast } from '@/components/ui/toast-store';
import type { JournalEntry } from '@/db/schema';
import { formatLocalDate, type LocalDate } from '@/lib/date';
import { wordCount } from '@/lib/markdown';
import { AttachmentList } from '@/features/attachments/AttachmentList';
import { LinksPanel } from '@/features/links/LinksPanel';
import { TagPicker } from '@/features/tags/TagPicker';
import { useJournalActions, type JournalPatch } from '../journal-actions';
import { MoodPicker } from './MoodPicker';

interface Props {
  /** Catatan yang sudah ada, atau undefined untuk draf baru */
  entry?: JournalEntry;
  draftDate: LocalDate;
  /** Isi awal draf baru (mis. templat refleksi) */
  draftTitle?: string;
  draftContent?: string;
  onCreated: (id: string) => void;
  onBack: () => void;
}

const DEBOUNCE_MS = 700;

const PROMPTS = [
  'Apa yang paling kamu syukuri hari ini?',
  'Apa yang berjalan baik hari ini, dan apa yang ingin diperbaiki?',
  'Satu hal kecil yang membuatmu tersenyum hari ini…',
  'Apa yang sedang ada di pikiranmu?',
  'Apa pelajaran dari hari ini?',
];

/**
 * Editor jurnal dengan simpan otomatis.
 * - Draf baru baru dibuat di DB saat ada isi pertama (tidak meninggalkan catatan kosong).
 * - Teks disimpan setelah berhenti mengetik 0,7 dtk; mood/tanggal/pin langsung.
 * - Perubahan tertunda disimpan saat editor ditutup, aplikasi di-background, atau tab ditutup.
 * - Jika simpan gagal, perubahan dikembalikan ke antrean (tidak hilang) dan bisa dicoba lagi.
 * State lokal adalah sumber kebenaran selama mengedit (data sync tidak menimpa ketikan).
 */
export function JournalEditor({
  entry,
  draftDate,
  draftTitle,
  draftContent,
  onCreated,
  onBack,
}: Props) {
  const actions = useJournalActions();
  const [title, setTitle] = useState(entry?.title ?? draftTitle ?? '');
  const [content, setContent] = useState(entry?.content ?? draftContent ?? '');
  const [mood, setMood] = useState<number | null>(entry?.mood ?? null);
  const [date, setDate] = useState<LocalDate>(entry?.entry_date ?? draftDate);
  const [pinned, setPinned] = useState(entry?.is_pinned === 1);
  const [state, setState] = useState<SaveState>(entry ? 'saved' : 'idle');
  const [prompt] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]!);

  const [savedId, setSavedId] = useState<string | null>(entry?.id ?? null);
  const idRef = useRef<string | null>(entry?.id ?? null);
  const pendingRef = useRef<JournalPatch>({});
  const latestRef = useRef({ title, content, mood, date, pinned });
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
    latestRef.current = { title, content, mood, date, pinned };
  }, [title, content, mood, date, pinned]);
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
            if (!v.title.trim() && !v.content.trim() && v.mood === null) {
              setState('idle');
              return;
            }
            idRef.current = await actions.create({
              entry_date: v.date,
              title: v.title,
              content: v.content,
              mood: v.mood,
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
          console.error('[jurnal] gagal menyimpan', err);
          // Editor sudah ditutup → indikator tidak terlihat, beri tahu lewat toast.
          if (!mountedRef.current) {
            toast('Gagal menyimpan catatan jurnal', {
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

  const queue = (patch: JournalPatch, immediate = false) => {
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

  const removed = entry?.deleted_at != null;

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
        <input
          type="date"
          aria-label="Tanggal"
          value={date}
          onChange={(e) => {
            if (!e.target.value) return;
            setDate(e.target.value);
            queue({ entry_date: e.target.value }, true);
          }}
          className="h-9 rounded-xl px-3 text-sm font-semibold glass outline-none"
        />
        <span className="hidden text-sm font-semibold text-muted capitalize sm:inline">
          {formatLocalDate(date, 'EEEE')}
        </span>
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
          <Button size="sm" variant="secondary" onClick={() => void actions.restore(entry!.id)}>
            <RotateCcw /> Pulihkan
          </Button>
        </div>
      )}

      <Input
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

      <div>
        <p className="mb-2 text-xs font-semibold text-muted">Perasaanmu</p>
        <MoodPicker
          value={mood}
          onChange={(m) => {
            setMood(m);
            queue({ mood: m }, true);
          }}
        />
      </div>

      <MarkdownEditor
        gradient="bg-gradient-journal"
        ariaLabel="Isi jurnal"
        value={content}
        placeholder={`${prompt}\n\nMendukung Markdown: **tebal**, _miring_, - daftar, - [ ] checklist`}
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
            <TagPicker type="journal_entry" entityId={savedId} />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted">Tautan</p>
            <LinksPanel type="journal_entry" id={savedId} />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-semibold text-muted">Foto & lampiran</p>
            <AttachmentList type="journal_entry" id={savedId} label="Foto" />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Tag & tautan tersedia setelah catatan tersimpan.</p>
      )}
    </div>
  );
}
