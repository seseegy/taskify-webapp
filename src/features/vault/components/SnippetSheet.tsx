import { Eye, Pencil, Star, Trash2 } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Select } from '@/components/ui/Field';
import { Input, Label } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/toast-store';
import type { Snippet } from '@/db/schema';
import { LinksPanel } from '@/features/links/LinksPanel';
import { TagPicker } from '@/features/tags/TagPicker';
import { LANGUAGES } from '@/lib/prism';
import { cn } from '@/lib/utils';
import { useVaultActions } from '../vault-data';
import { CopySnippet } from './CopySnippet';

/** Panel buat/ubah snippet. `snippet` undefined + open = snippet baru. */
export function SnippetSheet({
  open,
  loading,
  snippet,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Snippet sedang dibaca dari DB (mis. tepat setelah dibuat) → panel tetap terbuka */
  loading?: boolean;
  snippet?: Snippet;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={snippet ? 'Ubah snippet' : 'Snippet baru'} wide>
      {open && !loading && (
        <SnippetForm
          key={snippet?.id ?? 'new'}
          snippet={snippet}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </Sheet>
  );
}

function SnippetForm({
  snippet,
  onClose,
  onCreated,
}: {
  snippet?: Snippet;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const actions = useVaultActions();
  const [title, setTitle] = useState(snippet?.title ?? '');
  const [language, setLanguage] = useState(snippet?.language ?? 'typescript');
  const [description, setDescription] = useState(snippet?.description ?? '');
  const [code, setCode] = useState(snippet?.code ?? '');
  const [mode, setMode] = useState<'edit' | 'preview'>(snippet ? 'preview' : 'edit');
  const [saving, setSaving] = useState(false);
  const tabsId = useId();
  // Tab menyisipkan spasi di editor kode; Ctrl/⌘+M menukar supaya Tab memindahkan fokus
  // (jalan keluar bagi pengguna keyboard — Esc tidak bisa dipakai karena menutup dialog).
  const [tabMovesFocus, setTabMovesFocus] = useState(false);
  const dirty =
    !snippet ||
    title !== snippet.title ||
    language !== snippet.language ||
    code !== snippet.code ||
    (description || null) !== (snippet.description || null);

  const save = async () => {
    if (!title.trim()) return toast('Isi judul snippet', { tone: 'danger' });
    setSaving(true);
    const id = await actions.saveSnippet({ id: snippet?.id, title, language, code, description });
    setSaving(false);
    toast(snippet ? 'Snippet disimpan' : 'Snippet dibuat', { tone: 'success' });
    if (!snippet) onCreated(id);
    else setMode('preview');
  };

  // Tab = 2 spasi; Ctrl/⌘+M = Tab pindah fokus; Ctrl/⌘+S = simpan
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      setTabMovesFocus((v) => !v);
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !tabMovesFocus) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = code.slice(0, s) + '  ' + code.slice(end);
      setCode(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <div>
          <Label htmlFor="sn-title">Judul</Label>
          <Input
            id="sn-title"
            data-autofocus={snippet ? undefined : ''}
            value={title}
            maxLength={200}
            placeholder="mis. Fetch dengan timeout"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="sn-lang">Bahasa</Label>
          <Select id="sn-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="sn-desc">Deskripsi</Label>
        <Input
          id="sn-desc"
          value={description}
          placeholder="Kapan dipakai, catatan…"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-2xl glass">
        <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
          <div
            className="flex rounded-lg bg-surface p-0.5"
            role="tablist"
            aria-label="Mode kode"
            onKeyDown={(e) => {
              // Tab ARIA: ←/→ (atau Home/End) berpindah tab; fokus ikut dan tab langsung aktif
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const next = mode === 'edit' ? 'preview' : 'edit';
              setMode(next);
              requestAnimationFrame(() => document.getElementById(`${tabsId}-${next}`)?.focus());
            }}
          >
            {(['edit', 'preview'] as const).map((m) => (
              <button
                key={m}
                id={`${tabsId}-${m}`}
                type="button"
                role="tab"
                aria-selected={mode === m}
                aria-controls={`${tabsId}-panel`}
                tabIndex={mode === m ? 0 : -1}
                onClick={() => setMode(m)}
                className={cn(
                  'flex min-h-8 items-center gap-1 rounded-md px-3 py-1 text-xs font-bold',
                  mode === m ? 'bg-gradient-vault text-white shadow' : 'text-muted',
                )}
              >
                {m === 'edit' ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
                {m === 'edit' ? 'Ubah' : 'Lihat'}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2 text-xs text-muted">
            {code.split('\n').length} baris
            {code && <CopySnippet code={code} />}
          </span>
        </div>
        <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${mode}`}>
          {mode === 'edit' ? (
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              aria-label="Kode"
              aria-describedby={`${tabsId}-hint`}
              placeholder={'// Tempel kode di sini\n// Pakai {{nama}} untuk variabel template'}
              className="block min-h-72 w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset"
            />
          ) : (
            <div className="max-h-[50dvh] overflow-auto px-3 py-3">
              {code ? (
                <CodeBlock code={code} language={language} />
              ) : (
                <p className="text-sm text-muted">Belum ada kode.</p>
              )}
            </div>
          )}
        </div>
        {mode === 'edit' && (
          <p
            id={`${tabsId}-hint`}
            aria-live="polite"
            className="border-t border-line px-4 py-1.5 text-xs text-muted"
          >
            {tabMovesFocus
              ? 'Tab memindahkan fokus. Tekan Ctrl+M untuk kembali menyisipkan spasi.'
              : 'Tab menyisipkan 2 spasi. Tekan Ctrl+M agar Tab memindahkan fokus.'}
          </p>
        )}
      </div>

      {snippet ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Tag</Label>
            <TagPicker type="snippet" entityId={snippet.id} />
          </div>
          <div>
            <Label>Tautan</Label>
            <LinksPanel type="snippet" id={snippet.id} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Tag & tautan tersedia setelah snippet disimpan.</p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="flex gap-1">
          {snippet && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={snippet.is_favorite ? 'Hapus dari favorit' : 'Favoritkan'}
                onClick={() => void actions.toggleSnippetFavorite(snippet)}
              >
                <Star className={cn(snippet.is_favorite && 'fill-amber-400 text-amber-400')} />
              </Button>
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => {
                  void actions.removeSnippet(snippet.id);
                  onClose();
                }}
              >
                <Trash2 /> Hapus
              </Button>
            </>
          )}
        </span>
        <Button onClick={() => void save()} loading={saving} disabled={!dirty || !title.trim()}>
          Simpan
        </Button>
      </div>
    </div>
  );
}
