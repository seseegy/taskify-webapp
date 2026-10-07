import {
  ArrowDownLeft,
  ArrowUpRight,
  CornerDownLeft,
  Hash,
  ListChecks,
  Moon,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  createElement,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { NAV_ITEMS } from '@/app/navigation';
import { Sheet } from '@/components/ui/Sheet';
import {
  matchCategory,
  parseCapture,
  type Capture,
  type CaptureKind,
} from '@/features/capture/parse-capture';
import { useCategories } from '@/features/finance/finance-queries';
import { useCapture } from '@/features/capture/useCapture';
import { useOpenEntity } from '@/features/entities/entities';
import { entitySubtitle } from '@/features/entities/entity-format';
import { EntityIcon } from '@/features/entities/EntityChip';
import { useTxSheet } from '@/features/finance/tx-sheet-store';
import { TagChip } from '@/features/tags/TagPicker';
import { useTheme } from '@/features/theme/theme-context';
import { relativeDayLabel } from '@/lib/date';
import { formatIDR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { usePalette } from './palette-store';
import { splitSnippet, useGlobalSearch } from './useGlobalSearch';
import { useToday } from '@/lib/useToday';

interface Item {
  key: string;
  section: string;
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  keywords?: string;
  run: () => void | Promise<unknown>;
}

const KIND_META: Record<CaptureKind, { label: string; icon: LucideIcon; gradient: string }> = {
  task: { label: 'Tugas', icon: ListChecks, gradient: 'bg-gradient-tasks' },
  expense: {
    label: 'Pengeluaran',
    icon: ArrowUpRight,
    gradient: 'bg-linear-to-br from-rose-500 to-orange-500',
  },
  income: { label: 'Pemasukan', icon: ArrowDownLeft, gradient: 'bg-gradient-finance' },
  journal: { label: 'Jurnal', icon: NotebookPen, gradient: 'bg-gradient-journal' },
};

/** Pemasangan global: dialog + pintasan keyboard. */
export function CommandPalette() {
  const { open, initial, show, hide } = usePalette();

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (usePalette.getState().open) hide();
        else show();
      } else if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, hide]);

  return (
    <Sheet open={open} onClose={hide} variant="palette" title="Cari & catat cepat">
      {open && <PaletteBody initial={initial} onClose={hide} />}
    </Sheet>
  );
}

function PaletteBody({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [override, setOverride] = useState<CaptureKind | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const today = useToday();
  const navigate = useNavigate();
  const openEntity = useOpenEntity();
  const capture = useCapture();
  const createTx = useTxSheet((s) => s.create);
  const { resolved, setPreference } = useTheme();
  const { hits, tags, ready, fts } = useGlobalSearch(text);
  const categories = useCategories();

  const parsed = useMemo(() => (text.trim() ? parseCapture(text, today) : null), [text, today]);
  const cap: Capture | null = parsed && override ? applyKind(parsed, override, today) : parsed;

  const close = (fn: () => void | Promise<unknown>) => async () => {
    await fn();
    onClose();
  };

  const commands: Item[] = [
    ...NAV_ITEMS.map((n) => ({
      key: `nav-${n.to}`,
      section: 'Navigasi',
      icon: <ItemIcon icon={n.icon} gradient={n.gradient} />,
      title: `Buka ${n.label}`,
      keywords: `buka ke halaman ${n.label}`,
      run: () => navigate(n.to),
    })),
    {
      key: 'nav-trash',
      section: 'Navigasi',
      icon: <ItemIcon icon={Trash2} gradient="bg-gradient-settings" />,
      title: 'Buka Sampah',
      keywords: 'sampah hapus pulihkan trash',
      run: () => navigate('/sampah'),
    },
    {
      key: 'new-tx',
      section: 'Aksi',
      icon: <ItemIcon icon={Plus} gradient="bg-gradient-finance" />,
      title: 'Catat transaksi (form lengkap)',
      keywords: 'transaksi baru uang keuangan catat',
      run: () => createTx(),
    },
    {
      key: 'new-journal',
      section: 'Aksi',
      icon: <ItemIcon icon={NotebookPen} gradient="bg-gradient-journal" />,
      title: 'Tulis jurnal hari ini',
      keywords: 'jurnal tulis catatan diary',
      run: () => navigate(`/jurnal?tanggal=${today}`),
    },
    {
      key: 'theme',
      section: 'Aksi',
      icon: <ItemIcon icon={resolved === 'dark' ? Sun : Moon} gradient="bg-gradient-brand" />,
      title: resolved === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap',
      keywords: 'tema gelap terang dark light mode',
      run: () => setPreference(resolved === 'dark' ? 'light' : 'dark'),
    },
  ];

  const q = text.trim().toLowerCase();
  const captureItem: Item | null =
    cap && (cap.title || cap.amount)
      ? {
          key: 'capture',
          section: 'Catat cepat',
          icon: (
            <ItemIcon icon={KIND_META[cap.kind].icon} gradient={KIND_META[cap.kind].gradient} />
          ),
          title: <CaptureTitle cap={cap} />,
          subtitle: (
            <CaptureMeta
              cap={cap}
              today={today}
              category={
                cap.kind === 'expense' || cap.kind === 'income'
                  ? (matchCategory(categories, cap.kind, cap.categoryHint, cap.title)?.name ??
                    'tanpa kategori')
                  : undefined
              }
            />
          ),
          run: close(() => capture(cap)),
        }
      : null;
  // Catat cepat didahulukan hanya jika ada sinyal jelas (nominal, j:, waktu, prioritas, #tag)
  // atau tidak ada hasil pencarian; teks biasa → hasil pencarian dulu.
  const explicit = !!cap && (override !== null || isExplicitCapture(cap));

  const matchingCommands = q
    ? commands
        .filter((c) => `${String(c.title)} ${c.keywords ?? ''}`.toLowerCase().includes(q))
        .slice(0, 4)
    : commands;
  const searchItems: Item[] = q
    ? [
        ...hits.map((h) => ({
          key: `${h.type}-${h.id}`,
          section: 'Hasil pencarian',
          icon: <EntityIcon type={h.type} />,
          title: h.title,
          subtitle:
            h.snippet && h.snippet.includes('⟪') ? (
              <Highlight text={h.snippet} />
            ) : (
              entitySubtitle(h)
            ),
          run: close(() => openEntity(h)),
        })),
        ...tags.map((t) => ({
          key: `tag-${t.id}`,
          section: 'Tag',
          icon: <ItemIcon icon={Hash} gradient="bg-gradient-brand" />,
          title: <TagChip tag={t} link={false} />,
          subtitle: `${t.count} item`,
          run: close(() => navigate(`/tag/${t.id}`)),
        })),
      ]
    : [];
  const commandItems = matchingCommands.map((c) => ({ ...c, run: close(c.run) }));
  const items: Item[] =
    captureItem && (explicit || searchItems.length === 0)
      ? [captureItem, ...searchItems, ...commandItems]
      : [...searchItems, ...commandItems, ...(captureItem ? [captureItem] : [])];

  const safeActive = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${safeActive}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [safeActive]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && !e.altKey) {
      e.preventDefault();
      setActive((safeActive + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp' && !e.altKey) {
      e.preventDefault();
      setActive((safeActive - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void items[safeActive]?.run();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && cap) {
      // Alt+↑/↓ = ganti jenis catat cepat. Tab tidak lagi dibajak agar fokus bisa berpindah
      // ke pilihan jenis & tombol Tutup (navigasi keyboard standar).
      e.preventDefault();
      const kinds = availableKinds(parsed!);
      const idx = kinds.indexOf(cap.kind);
      const step = e.key === 'ArrowDown' ? 1 : kinds.length - 1;
      setOverride(kinds[(idx + step) % kinds.length]!);
    }
  };

  // Kelompokkan item berurutan per seksi (role="group"), simpan indeks globalnya
  const groups: { section: string; entries: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.entries.push({ item, index });
    else groups.push({ section: item.section, entries: [{ item, index }] });
  });

  return (
    <div onKeyDown={onKeyDown}>
      <label className="mb-3 flex h-12 items-center gap-2 rounded-2xl px-3.5 glass focus-within:ring-4 focus-within:ring-primary/15">
        <Search className="size-5 text-muted" />
        <input
          data-autofocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOverride(null);
          }}
          placeholder='Cari, atau ketik "makan siang 25rb", "besok rapat jam 9 #kerja"…'
          aria-label="Cari atau catat cepat"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length > 0 ? optionId(safeActive) : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          enterKeyHint="go"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
        />
        <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] font-bold text-muted sm:block">
          ESC
        </kbd>
      </label>

      {cap && (
        <div
          className="mb-3 flex flex-wrap items-center gap-1.5"
          role="radiogroup"
          aria-label="Simpan sebagai"
        >
          <span className="mr-1 text-xs font-semibold text-muted">Simpan sebagai</span>
          {(Object.keys(KIND_META) as CaptureKind[]).map((k) => {
            const enabled = availableKinds(parsed!).includes(k);
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={cap.kind === k}
                disabled={!enabled}
                onClick={() => setOverride(k)}
                className={cn(
                  'min-h-8 rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-50',
                  cap.kind === k
                    ? cn('shine text-white shadow', KIND_META[k].gradient)
                    : 'text-muted glass hover:text-fg',
                )}
              >
                {KIND_META[k].label}
              </button>
            );
          })}
          <span className="ml-auto hidden text-xs text-muted sm:inline">Alt + ↑↓ untuk ganti</span>
        </div>
      )}

      {/* Petunjuk + jumlah hasil untuk pembaca layar (tidak terlihat) */}
      <span id={hintId} className="sr-only">
        Ketik untuk mencari atau mencatat. Panah atas dan bawah memilih hasil, Enter menjalankan.
        {cap && ' Alt dan panah atas atau bawah mengganti jenis catatan.'}
      </span>
      <div role="status" className="sr-only">
        {items.length > 0
          ? `${items.length} hasil tersedia`
          : q && ready
            ? `Tidak ada hasil untuk ${text.trim()}`
            : ''}
      </div>

      <div ref={listRef} className="-mx-1 max-h-[55dvh] overflow-y-auto px-1">
        <div id={listId} role="listbox" aria-label="Hasil" hidden={items.length === 0}>
          {groups.map((group) => (
            <div key={group.section} role="group" aria-labelledby={`${baseId}-g-${group.section}`}>
              <p
                id={`${baseId}-g-${group.section}`}
                role="presentation"
                className="mt-2 mb-1 px-2 text-xs font-bold tracking-wide text-muted uppercase first:mt-0"
              >
                {group.section}
              </p>
              {group.entries.map(({ item, index: i }) => (
                <div
                  key={item.key}
                  id={optionId(i)}
                  role="option"
                  data-index={i}
                  aria-selected={i === safeActive}
                  onMouseMove={() => i !== safeActive && setActive(i)}
                  // mencegah input kehilangan fokus saat opsi diklik
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void item.run()}
                  className={cn(
                    'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition',
                    i === safeActive ? 'ring-1 glass-strong ring-primary/40' : 'hover:bg-surface',
                  )}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.title}</span>
                    {item.subtitle && (
                      <span className="block truncate text-xs text-muted">{item.subtitle}</span>
                    )}
                  </span>
                  {i === safeActive && (
                    <CornerDownLeft className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        {q && ready && items.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted">Tidak ada hasil untuk “{text.trim()}”.</p>
        )}
      </div>

      <p className="mt-3 hidden flex-wrap items-center gap-x-1.5 border-t border-line pt-3 text-xs text-muted sm:flex">
        <Sparkles className="size-3.5 text-primary" />
        Ada nominal = transaksi · ada waktu = tugas · awali <b>j:</b> = jurnal · <b>#tag</b> · ↑↓
        lalu Enter
        {!fts && ' · (pencarian dasar)'}
      </p>
    </div>
  );
}

function isExplicitCapture(c: Capture): boolean {
  return c.kind !== 'task' || !!c.date || !!c.time || !!c.priority || c.tags.length > 0;
}

function availableKinds(c: Capture): CaptureKind[] {
  return c.amount ? ['expense', 'income', 'task', 'journal'] : ['task', 'journal'];
}

function applyKind(c: Capture, kind: CaptureKind, today: string): Capture {
  if (kind === c.kind) return c;
  if (kind === 'expense' || kind === 'income') return { ...c, kind, date: c.date ?? today };
  if (kind === 'journal') return { ...c, kind, date: today };
  return { ...c, kind, date: c.kind === 'journal' ? undefined : c.date };
}

function CaptureTitle({ cap }: { cap: Capture }) {
  const label = KIND_META[cap.kind].label;
  if (cap.kind === 'expense' || cap.kind === 'income') {
    return (
      <>
        {label}{' '}
        <span className={cap.kind === 'income' ? 'text-success' : 'text-danger'}>
          {formatIDR(cap.amount ?? 0)}
        </span>
        {cap.title && <> · {cap.title}</>}
      </>
    );
  }
  return (
    <>
      {label}: {cap.title}
    </>
  );
}

function CaptureMeta({ cap, today, category }: { cap: Capture; today: string; category?: string }) {
  const parts: ReactNode[] = [];
  if (cap.date) parts.push(relativeDayLabel(cap.date, today));
  if (cap.time) parts.push(cap.time);
  if (cap.priority) parts.push(`prioritas ${cap.priority}`);
  if (category) parts.push(category);
  return (
    <span className="flex items-center gap-1.5">
      <span>
        Enter untuk simpan{parts.length ? ' · ' : ''}
        {parts.join(' · ')}
      </span>
      {cap.tags.map((t) => (
        <span key={t} className="font-semibold text-primary">
          #{t}
        </span>
      ))}
    </span>
  );
}

function Highlight({ text }: { text: string }) {
  return (
    <>
      {splitSnippet(text).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-primary/25 px-0.5 text-fg">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function ItemIcon({ icon, gradient }: { icon: LucideIcon; gradient: string }) {
  return (
    <span
      className={cn(
        'shine flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
        gradient,
      )}
    >
      {createElement(icon, { className: 'size-4' })}
    </span>
  );
}
