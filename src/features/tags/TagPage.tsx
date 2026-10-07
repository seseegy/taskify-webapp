import { useQuery } from '@powersync/react';
import { Hash, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { confirmDialog } from '@/components/ui/confirm-store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Label } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import type { EntityType } from '@/db/schema';
import { ColorPicker } from '@/features/finance/components/Pickers';
import {
  ENTITY_META,
  ENTITY_UNION,
  useOpenEntity,
  type EntityRow,
} from '@/features/entities/entities';
import { entitySubtitle } from '@/features/entities/entity-format';
import { EntityIcon } from '@/features/entities/EntityChip';
import { paletteOf } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { useAllTags, useTagActions } from './tag-actions';
import { TagChip } from './TagPicker';

/** Semua item (lintas modul) yang memakai satu tag, plus daftar semua tag. */
export function TagPage() {
  const { id = '' } = useParams();
  const all = useAllTags();
  const tag = all.find((t) => t.id === id);
  const openEntity = useOpenEntity();
  const navigate = useNavigate();
  const actions = useTagActions();
  const [editing, setEditing] = useState(false);

  const { data: items } = useQuery<EntityRow>(
    `WITH entities AS (${ENTITY_UNION})
     SELECT e.* FROM taggings g JOIN entities e ON e.type = g.entity_type AND e.id = g.entity_id
      WHERE g.tag_id = ?1 AND e.deleted_at IS NULL ORDER BY e.updated_at DESC`,
    [id],
  );

  const groups = (Object.keys(ENTITY_META) as EntityType[])
    .map((type) => ({ type, rows: items.filter((r) => r.type === type) }))
    .filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        title={tag ? `#${tag.name}` : 'Tag'}
        subtitle={tag ? `${items.length} item` : 'Tag tidak ditemukan'}
        icon={Hash}
        gradient={tag ? cn('bg-linear-to-br', paletteOf(tag.color).grad) : 'bg-gradient-brand'}
        actions={
          tag && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil /> Ubah
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
        <Card className="min-w-0 animate-fade-up">
          {groups.length === 0 ? (
            <EmptyState
              icon={Hash}
              title="Belum ada item"
              description="Tambahkan tag ini di tugas, jurnal, atau transaksi."
            />
          ) : (
            groups.map((g) => (
              <section key={g.type} className="mb-4 last:mb-0">
                <h2
                  className={cn(
                    'mb-1 px-2 text-xs font-bold tracking-wide uppercase',
                    ENTITY_META[g.type].text,
                  )}
                >
                  {ENTITY_META[g.type].label} · {g.rows.length}
                </h2>
                {g.rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openEntity(r)}
                    className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface"
                  >
                    <EntityIcon type={r.type} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{r.title}</span>
                      <span className="block truncate text-xs text-muted">{entitySubtitle(r)}</span>
                    </span>
                  </button>
                ))}
              </section>
            ))
          )}
        </Card>
        <Card className="animate-fade-up self-start">
          <h2 className="mb-3 font-bold">Semua tag</h2>
          {all.length === 0 && (
            <p className="text-sm text-muted">Belum ada tag. Ketik #nama saat menambah tugas.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {all.map((t) => (
              <span key={t.id} className={cn(t.id === id && 'rounded-full ring-2 ring-primary/50')}>
                <TagChip tag={t} />
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Sheet
        open={editing && !!tag}
        onClose={() => setEditing(false)}
        variant="center"
        title="Ubah tag"
      >
        {editing && tag && (
          <TagForm
            key={tag.id}
            name={tag.name}
            color={tag.color ?? 'violet'}
            onSave={async (name, color) => {
              await actions.rename(tag.id, name);
              await actions.setColor(tag.id, color);
              setEditing(false);
            }}
            onDelete={async () => {
              if (
                !(await confirmDialog(`Hapus tag #${tag.name} dari semua item?`, {
                  confirmLabel: 'Hapus tag',
                }))
              )
                return;
              await actions.deleteTag(tag.id);
              setEditing(false);
              navigate('/');
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function TagForm({
  name: initialName,
  color: initialColor,
  onSave,
  onDelete,
}: {
  name: string;
  color: string;
  onSave: (name: string, color: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(name, color);
      }}
    >
      <div>
        <Label htmlFor="tag-name">Nama</Label>
        <Input
          id="tag-name"
          value={name}
          maxLength={50}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <Label>Warna</Label>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" className="text-danger" onClick={() => void onDelete()}>
          <Trash2 /> Hapus tag
        </Button>
        <Button type="submit">Simpan</Button>
      </div>
    </form>
  );
}
