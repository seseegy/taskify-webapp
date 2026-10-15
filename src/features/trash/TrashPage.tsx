import { useQuery } from '@powersync/react';
import { formatDistanceToNow } from 'date-fns';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/toast-store';
import { ENTITY_META } from '@/features/entities/entities';
import { entitySubtitle } from '@/features/entities/entity-format';
import { EntityIcon } from '@/features/entities/EntityChip';
import { localeId, parseTimestamp } from '@/lib/date';
import { cn } from '@/lib/utils';
import {
  TRASH_RETENTION_DAYS,
  TRASH_TYPES,
  useTrashActions,
  type TrashType,
} from './trash-actions';
import { askConfirm } from '@/components/ui/confirm-store';

interface TrashRow {
  type: TrashType;
  id: string;
  title: string;
  subtitle: string | null;
  deleted_at: string;
}

const SQL = `
  SELECT 'task' AS type, id, title, due_date AS subtitle, deleted_at FROM tasks
   WHERE deleted_at IS NOT NULL AND parent_id IS NULL
  UNION ALL
  SELECT 'journal_entry', id, COALESCE(NULLIF(title, ''), substr(content, 1, 80), 'Jurnal'), entry_date, deleted_at
    FROM journal_entries WHERE deleted_at IS NOT NULL
  UNION ALL
  SELECT 'note', id, COALESCE(NULLIF(title, ''), NULLIF(substr(content, 1, 80), ''), 'Catatan'), note_date, deleted_at
    FROM notes WHERE deleted_at IS NOT NULL
  UNION ALL
  SELECT 'transaction', t.id, COALESCE(NULLIF(t.title, ''), c.name, 'Transaksi'),
         t.occurred_on || '|' || t.kind || '|' || t.amount, t.deleted_at
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'snippet', id, title, language, deleted_at FROM snippets WHERE deleted_at IS NOT NULL
  UNION ALL
  SELECT 'code_project', id, name, NULL, deleted_at FROM code_projects WHERE deleted_at IS NOT NULL
  ORDER BY deleted_at DESC`;

/** Sampah gabungan: tugas, jurnal, catatan, transaksi, snippet, project. */
export function TrashPage() {
  const { data: rows } = useQuery<TrashRow>(SQL);
  const actions = useTrashActions();
  const [now] = useState(() => Date.now());

  const emptyAll = async () => {
    const ok = await askConfirm({
      title: `Hapus permanen ${rows.length} item?`,
      confirmLabel: 'Hapus permanen',
    });
    if (!ok) return;
    for (const type of TRASH_TYPES) {
      await actions.destroy(
        type,
        rows.filter((r) => r.type === type).map((r) => r.id),
      );
    }
    toast('Sampah dikosongkan');
  };

  return (
    <>
      <PageHeader
        title="Sampah"
        subtitle={`Item dihapus otomatis setelah ${TRASH_RETENTION_DAYS} hari`}
        icon={Trash2}
        gradient="bg-gradient-settings"
        actions={
          rows.length > 0 && (
            <Button variant="danger" onClick={() => void emptyAll()}>
              <Trash2 /> Kosongkan
            </Button>
          )
        }
      />
      <Card className="animate-fade-up">
        {rows.length === 0 ? (
          <EmptyState
            icon={Trash2}
            gradient="bg-gradient-settings"
            title="Sampah kosong"
            description="Item yang kamu hapus akan muncul di sini dan bisa dipulihkan."
          />
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => {
              const days = Math.max(
                0,
                TRASH_RETENTION_DAYS -
                  Math.floor((now - parseTimestamp(r.deleted_at).getTime()) / 86400_000),
              );
              return (
                <li
                  key={`${r.type}-${r.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface"
                >
                  <EntityIcon type={r.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {entitySubtitle(r)} · dihapus{' '}
                      {formatDistanceToNow(parseTimestamp(r.deleted_at), {
                        addSuffix: true,
                        locale: localeId,
                      })}{' '}
                      ·{' '}
                      <span className={cn(days <= 3 && 'text-danger')}>
                        terhapus permanen dalam {days} hari
                      </span>
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void actions
                          .restore(r.type, r.id)
                          .then(() =>
                            toast(`${ENTITY_META[r.type].label} dipulihkan`, { tone: 'success' }),
                          )
                      }
                    >
                      <RotateCcw /> Pulihkan
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-danger"
                      aria-label={`Hapus permanen ${r.title}`}
                      onClick={() =>
                        void (async () => {
                          const ok = await askConfirm({
                            title: `Hapus permanen "${r.title}"?`,
                            confirmLabel: 'Hapus permanen',
                          });
                          if (ok) await actions.destroy(r.type, [r.id]);
                        })()
                      }
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
