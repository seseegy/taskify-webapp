/**
 * Metadata & navigasi lintas modul untuk "entitas" (tugas, jurnal, catatan, transaksi, snippet,
 * project).
 * Dipakai pencarian global, tag, dan tautan silang.
 */
import {
  CodeXml,
  FolderGit2,
  ListChecks,
  NotebookPen,
  StickyNote,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { EntityType } from '@/db/schema';
import { useTxSheet } from '@/features/finance/tx-sheet-store';
import { useTaskSheet } from '@/features/tasks/task-sheet-store';

export const ENTITY_META: Record<
  EntityType,
  { label: string; icon: LucideIcon; gradient: string; text: string }
> = {
  task: { label: 'Tugas', icon: ListChecks, gradient: 'bg-gradient-tasks', text: 'text-mod-tasks' },
  journal_entry: {
    label: 'Jurnal',
    icon: NotebookPen,
    gradient: 'bg-gradient-journal',
    text: 'text-mod-journal',
  },
  note: {
    label: 'Catatan',
    icon: StickyNote,
    gradient: 'bg-gradient-notes',
    text: 'text-mod-notes',
  },
  transaction: {
    label: 'Transaksi',
    icon: Wallet,
    gradient: 'bg-gradient-finance',
    text: 'text-mod-finance',
  },
  snippet: {
    label: 'Snippet',
    icon: CodeXml,
    gradient: 'bg-gradient-vault',
    text: 'text-mod-vault',
  },
  code_project: {
    label: 'Project',
    icon: FolderGit2,
    gradient: 'bg-gradient-vault',
    text: 'text-mod-vault',
  },
};

export interface EntityRef {
  type: EntityType;
  id: string;
}

/** Buka entitas di tempat yang sesuai (panel global atau halaman modul). */
export function useOpenEntity() {
  const navigate = useNavigate();
  const openTask = useTaskSheet((s) => s.open);
  const editTx = useTxSheet((s) => s.edit);

  return useCallback(
    ({ type, id }: EntityRef) => {
      switch (type) {
        case 'task':
          return openTask(id);
        case 'transaction':
          return editTx(id);
        case 'journal_entry':
          return navigate(`/jurnal?entri=${id}`);
        case 'note':
          return navigate(`/catatan?catatan=${id}`);
        case 'snippet':
        case 'code_project':
          return navigate(`/vault?${type === 'snippet' ? 'snippet' : 'project'}=${id}`);
      }
    },
    [navigate, openTask, editTx],
  );
}

/**
 * Subquery SQL yang menghasilkan (type, id, title, subtitle, deleted_at) untuk semua entitas.
 * Dipakai sebagai CTE: `WITH entities AS (${ENTITY_UNION}) ...`
 */
export const ENTITY_UNION = `
  SELECT 'task' AS type, id, title, due_date AS subtitle, deleted_at, updated_at FROM tasks
  UNION ALL
  SELECT 'journal_entry', id, COALESCE(NULLIF(title, ''), substr(content, 1, 80), 'Jurnal'), entry_date, deleted_at, updated_at
    FROM journal_entries
  UNION ALL
  SELECT 'note', id, COALESCE(NULLIF(title, ''), NULLIF(substr(content, 1, 80), ''), 'Catatan'), note_date, deleted_at, updated_at
    FROM notes
  UNION ALL
  SELECT 'transaction', t.id,
         COALESCE(NULLIF(t.title, ''), c.name, CASE t.kind WHEN 'income' THEN 'Pemasukan' WHEN 'expense' THEN 'Pengeluaran' ELSE 'Transfer' END),
         t.occurred_on || '|' || t.kind || '|' || t.amount, t.deleted_at, t.updated_at
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
  UNION ALL
  SELECT 'snippet', id, title, language, deleted_at, updated_at FROM snippets
  UNION ALL
  SELECT 'code_project', id, name, NULL, deleted_at, updated_at FROM code_projects`;

export interface EntityRow {
  type: EntityType;
  id: string;
  title: string;
  subtitle: string | null;
  deleted_at: string | null;
}
