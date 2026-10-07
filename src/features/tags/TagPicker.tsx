import { Hash, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { EntityType } from '@/db/schema';
import { paletteOf } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { normalizeTagName, useAllTags, useEntityTags, useTagActions } from './tag-actions';

export function TagChip({
  tag,
  onRemove,
  link = true,
  size = 'md',
}: {
  tag: { id: string; name: string; color: string | null };
  onRemove?: () => void;
  link?: boolean;
  size?: 'sm' | 'md';
}) {
  const p = paletteOf(tag.color);
  const cls = cn(
    'inline-flex items-center gap-0.5 rounded-full font-semibold',
    size === 'sm' ? 'px-1.5 py-px text-xs' : 'px-2 py-0.5 text-xs',
    p.soft,
  );
  const body = (
    <>
      <Hash className={size === 'sm' ? 'size-2.5' : 'size-3'} />
      {tag.name}
    </>
  );
  return (
    <span className={cls}>
      {link ? (
        <Link
          to={`/tag/${tag.id}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 hover:underline"
        >
          {body}
        </Link>
      ) : (
        body
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Hapus tag ${tag.name}`}
          onClick={onRemove}
          // Ikon 12px, tapi area sentuh diperluas jadi 24×24px lewat ::before (WCAG 2.5.8)
          className="relative -mr-0.5 ml-0.5 flex size-4 items-center justify-center rounded-full before:absolute before:-inset-1 hover:bg-black/10"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * Kelola tag sebuah entitas: chip + input dengan saran (Enter/koma untuk menambah).
 * Pola combobox ARIA: ↑/↓ memilih saran, Enter menambah, Esc menutup daftar.
 * Fokus tetap di input (aria-activedescendant), jadi saran bisa dipilih penuh lewat keyboard.
 */
export function TagPicker({ type, entityId }: { type: EntityType; entityId: string }) {
  const current = useEntityTags(type, entityId);
  const all = useAllTags();
  const actions = useTagActions();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const q = normalizeTagName(text);
  const have = new Set(current.map((t) => t.id));
  const suggestions = all.filter((t) => !have.has(t.id) && (!q || t.name.includes(q))).slice(0, 6);
  const exact = all.some((t) => t.name === q);

  const options = [
    ...(q && !exact ? [{ key: '__create', name: q, tag: null }] : []),
    ...suggestions.map((t) => ({ key: t.id, name: t.name, tag: t })),
  ];
  const expanded = open && options.length > 0;
  const activeIdx = expanded && active < options.length ? active : -1;

  useEffect(() => {
    // Jaga saran aktif tetap terlihat saat bernavigasi dengan panah
    if (activeIdx >= 0) {
      document.getElementById(`${baseId}-opt-${activeIdx}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx, baseId]);

  const add = async (name: string) => {
    const normalized = normalizeTagName(name);
    if (!normalized) return;
    await actions.addByName(type, entityId, [name]);
    setText('');
    setActive(-1);
    setAnnouncement(`Tag #${normalized} ditambahkan`);
  };

  const remove = (tag: { id: string; name: string }) => {
    void actions.remove(type, entityId, tag.id);
    setAnnouncement(`Tag #${tag.name} dihapus`);
    // Tombol hapus ikut hilang → kembalikan fokus ke input agar tidak jatuh ke <body>
    inputRef.current?.focus();
  };

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setOpen(true);
        if (options.length) setActive(activeIdx + 1 >= options.length ? 0 : activeIdx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setOpen(true);
        if (options.length) setActive(activeIdx <= 0 ? options.length - 1 : activeIdx - 1);
        break;
      case 'Enter':
        e.preventDefault();
        void add(activeIdx >= 0 ? options[activeIdx]!.name : text);
        break;
      case ',':
        e.preventDefault();
        void add(text);
        break;
      case 'Escape':
        // Esc pertama menutup daftar saran saja, bukan dialog di sekitarnya
        if (expanded) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case 'Backspace':
        if (!text && current.length) remove(current.at(-1)!);
        break;
    }
  };

  /** Tutup hanya jika fokus benar-benar keluar dari input + daftar saran. */
  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (next === inputRef.current || listRef.current?.contains(next))) return;
    close();
  };

  return (
    <div className="relative">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl px-2.5 py-2 glass">
        {current.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => remove(t)} />
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          placeholder={current.length ? '' : 'Tambah tag…'}
          aria-label="Tambah tag"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIdx >= 0 ? optionId(activeIdx) : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          enterKeyHint="enter"
          className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
        />
      </div>
      <span id={hintId} className="sr-only">
        Ketik nama tag lalu Enter atau koma. Panah atas/bawah untuk memilih saran.
      </span>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {expanded && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Saran tag"
          onBlur={onBlur}
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl p-1 glass-strong"
        >
          {options.map((o, i) => (
            <div
              key={o.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIdx}
              // tabIndex -1: tidak masuk urutan Tab, tapi di HP ketukan tidak mem-blur
              // input ke <body> sebelum klik terjadi (lihat onBlur).
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== activeIdx && setActive(i)}
              onClick={() => void add(o.name).then(() => inputRef.current?.focus())}
              className={cn(
                'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none',
                o.tag ? 'justify-between' : '',
                i === activeIdx ? 'ring-1 glass-strong ring-primary/40' : 'hover:bg-surface',
              )}
            >
              {o.tag ? (
                <>
                  <TagChip tag={o.tag} link={false} />
                  <span className="text-xs text-muted">
                    {o.tag.count}
                    <span className="sr-only"> item</span>
                  </span>
                </>
              ) : (
                <>
                  <Plus className="size-4 text-primary" /> Buat tag <b>#{o.name}</b>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
