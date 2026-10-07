import { useQuery } from '@powersync/react';
import { formatDistanceToNow } from 'date-fns';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { confirmDialog } from '@/components/ui/confirm-store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast-store';
import { ENTITY_META } from '@/features/entities/entities';
import { entitySubtitle } from '@/features/entities/entity-format';
import { EntityIcon } from '@/features/entities/EntityChip';
import { localeId, parseTimestamp } from '@/lib/date';
import { cn } from '@/lib/utils';
import { TRASH_RETENTION_DAYS, useTrashActions, type TrashType } from './trash-actions';

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
  SELECT 'transaction', t.id, COALESCE(NULLIF(t.title, ''), c.name, 'Transaksi'),
         t.occurred_on || '|' || t.kind || '|' || t.amount, t.deleted_at
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'snippet', id, title, language, deleted_at FROM snippets WHERE deleted_at IS NOT NULL
  UNION ALL
  SELECT 'code_project', id, name, NULL, deleted_at FROM code_projects WHERE deleted_at IS NOT NULL
  ORDER BY deleted_at DESC`;

/** Sampah gabungan: tugas, jurnal, transaksi. */
export function TrashPage() {
  const { data: rows, isLoading } = useQuery<TrashRow>(SQL);
  const actions = useTrashActions();
  const [now] = useState(() => Date.now());

  // Dialog konfirmasi asinkron: isi Sampah bisa berubah selama dialog terbuka (mis. item dipulihkan
  // dari perangkat lain lewat sync). Simpan rujukan terbaru supaya yang dihapus hanya item yang
  // (1) ikut dikonfirmasi DAN (2) masih berada di Sampah saat konfirmasi disetujui.
  const latestRows = useRef(rows);
  useEffect(() => {
    latestRows.current = rows;
  }, [rows]);

  const emptyAll = async () => {
    const confirmed = new Set(rows.map((r) => r.id));
    if (
      !(await confirmDialog(
        `Hapus permanen ${rows.length} item? Tindakan ini tidak bisa dibatalkan.`,
        { confirmLabel: 'Hapus semua' },
      ))
    )
      return;
    const targets = latestRows.current.filter((r) => confirmed.has(r.id));
    for (const type of [
      'task',
      'journal_entry',
      'transaction',
      'snippet',
      'code_project',
    ] as TrashType[]) {
      await actions.destroy(
        type,
        targets.filter((r) => r.type === type).map((r) => r.id),
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
        {isLoading ? (
          <LoadingRows label="Memuat sampah…" />
        ) : rows.length === 0 ? (
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
                      onClick={async () => {
                        if (
                          await confirmDialog(`Hapus permanen "${r.title}"?`, {
                            confirmLabel: 'Hapus permanen',
                          })
                        )
                          void actions.destroy(r.type, [r.id]);
                      }}
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
