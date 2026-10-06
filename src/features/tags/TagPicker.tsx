import { Hash, Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
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
    size === 'sm' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs',
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
          className="-mr-0.5 ml-0.5 rounded-full hover:bg-black/10"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/** Kelola tag sebuah entitas: chip + input dengan saran (Enter/koma untuk menambah). */
export function TagPicker({ type, entityId }: { type: EntityType; entityId: string }) {
  const current = useEntityTags(type, entityId);
  const all = useAllTags();
  const actions = useTagActions();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  const q = normalizeTagName(text);
  const have = new Set(current.map((t) => t.id));
  const suggestions = all.filter((t) => !have.has(t.id) && (!q || t.name.includes(q))).slice(0, 6);
  const exact = all.some((t) => t.name === q);

  const add = async (name: string) => {
    if (!normalizeTagName(name)) return;
    await actions.addByName(type, entityId, [name]);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      void add(text);
    } else if (e.key === 'Backspace' && !text && current.length) {
      void actions.remove(type, entityId, current.at(-1)!.id);
    }
  };

  return (
    <div className="relative">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl px-2.5 py-2 glass">
        {current.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => void actions.remove(type, entityId, t.id)} />
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={current.length ? '' : 'Tambah tag…'}
          aria-label="Tambah tag"
          className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
        />
      </div>
      {open && (suggestions.length > 0 || (q && !exact)) && (
        <div
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl p-1 glass-strong"
          role="listbox"
        >
          {q && !exact && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void add(q)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface"
            >
              <Plus className="size-4 text-primary" /> Buat tag <b>#{q}</b>
            </button>
          )}
          {suggestions.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void add(t.name)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface"
            >
              <TagChip tag={t} link={false} />
              <span className="text-xs text-muted">{t.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
