import { Link2, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import type { EntityType } from '@/db/schema';
import { useOpenEntity } from '@/features/entities/entities';
import { entitySubtitle } from '@/features/entities/entity-format';
import { EntityIcon } from '@/features/entities/EntityChip';
import { useGlobalSearch } from '@/features/search/useGlobalSearch';
import { cn } from '@/lib/utils';
import { useEntityLinks, useLinkActions } from './link-actions';

/** Daftar tautan dua arah + pencari untuk menautkan entitas lain. */
export function LinksPanel({ type, id }: { type: EntityType; id: string }) {
  const links = useEntityLinks(type, id);
  const actions = useLinkActions();
  const openEntity = useOpenEntity();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const { hits } = useGlobalSearch(adding ? q : '', 8);
  const linked = new Set(links.map((l) => `${l.type}:${l.id}`));
  const candidates = hits.filter(
    (h) => !(h.type === type && h.id === id) && !linked.has(`${h.type}:${h.id}`),
  );

  return (
    <div className="space-y-1.5">
      {links.length === 0 && !adding && <p className="text-sm text-muted">Belum ada tautan.</p>}
      {links.map((l) => (
        <div
          key={l.link_id}
          className={cn(
            'group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-surface',
            l.deleted_at && 'opacity-50',
          )}
        >
          <button
            type="button"
            onClick={() => openEntity(l)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <EntityIcon type={l.type} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{l.title}</span>
              <span className="block truncate text-xs text-muted">
                {l.deleted_at ? 'Di Sampah' : entitySubtitle(l)}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={`Lepas tautan ${l.title}`}
            onClick={() => void actions.unlink(l.link_id)}
            className="flex size-7 items-center justify-center rounded-lg text-muted opacity-60 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl p-2 glass">
          <label className="flex items-center gap-2 rounded-lg px-1 focus-within:ring-2 focus-within:ring-primary/50">
            <Search className="size-4 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAdding(false))}
              placeholder="Cari tugas, jurnal, transaksi…"
              aria-label="Cari untuk ditautkan"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
            />
            <button
              type="button"
              aria-label="Batal"
              onClick={() => setAdding(false)}
              className="text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </label>
          {candidates.map((h) => (
            <button
              key={`${h.type}-${h.id}`}
              type="button"
              onClick={() => {
                void actions.link({ type, id }, h);
                setQ('');
                setAdding(false);
              }}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface"
            >
              <EntityIcon type={h.type} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{h.title}</span>
                <span className="block truncate text-xs text-muted">{entitySubtitle(h)}</span>
              </span>
            </button>
          ))}
          {q.trim() && candidates.length === 0 && (
            <p className="px-1.5 pt-1.5 text-xs text-muted">Tidak ditemukan.</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-primary hover:bg-surface"
        >
          <Plus className="size-4" /> <Link2 className="size-4" /> Tautkan
        </button>
      )}
    </div>
  );
}
