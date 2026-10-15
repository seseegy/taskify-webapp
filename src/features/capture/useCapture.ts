import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@/components/ui/toast-store';
import { useFinanceActions } from '@/features/finance/finance-actions';
import { useCategories, useWallets } from '@/features/finance/finance-queries';
import { useTxSheet } from '@/features/finance/tx-sheet-store';
import { useJournalActions } from '@/features/journal/journal-actions';
import { useNoteActions } from '@/features/notes/note-actions';
import { useTagActions } from '@/features/tags/tag-actions';
import { useTaskActions } from '@/features/tasks/task-actions';
import { useTaskSheet } from '@/features/tasks/task-sheet-store';
import { formatIDR } from '@/lib/money';
import { matchCategory, type Capture } from './parse-capture';

const LAST_WALLET_KEY = 'taskify-last-wallet';

/** Simpan hasil quick capture ke modul yang sesuai. */
export function useCapture() {
  const tasks = useTaskActions();
  const finance = useFinanceActions();
  const journal = useJournalActions();
  const noteActions = useNoteActions();
  const tagActions = useTagActions();
  const { wallets } = useWallets(false);
  const categories = useCategories();
  const openTask = useTaskSheet((s) => s.open);
  const editTx = useTxSheet((s) => s.edit);
  const navigate = useNavigate();

  return useCallback(
    async (c: Capture): Promise<boolean> => {
      if (
        c.kind === 'note'
          ? !c.rawText.trim()
          : !c.title.trim() && c.kind !== 'expense' && c.kind !== 'income'
      )
        return false;
      try {
        if (c.kind === 'task') {
          const id = await tasks.create({
            title: c.title,
            due_date: c.date ?? null,
            due_time: c.time ?? null,
            priority: c.priority ?? 0,
          });
          if (c.tags.length) await tagActions.addByName('task', id, c.tags);
          toast('Tugas ditambahkan', {
            tone: 'success',
            action: { label: 'Buka', onClick: () => openTask(id) },
          });
          return true;
        }
        if (c.kind === 'journal') {
          const id = await journal.create({ entry_date: c.date!, content: c.title });
          if (c.tags.length) await tagActions.addByName('journal_entry', id, c.tags);
          toast('Catatan jurnal disimpan', {
            tone: 'success',
            action: { label: 'Buka', onClick: () => navigate(`/jurnal?entri=${id}`) },
          });
          return true;
        }
        if (c.kind === 'note') {
          // Teks ASLI (`rawText`), bukan `title`: title sudah dibuang nominal/tanggal/jamnya oleh
          // parser tugas/transaksi, padahal catatan adalah teks bebas. Judul bisa ditambah nanti.
          const id = await noteActions.create({ content: c.rawText, note_date: c.date ?? null });
          if (c.tags.length) await tagActions.addByName('note', id, c.tags);
          toast('Catatan disimpan', {
            tone: 'success',
            action: { label: 'Buka', onClick: () => navigate(`/catatan?catatan=${id}`) },
          });
          return true;
        }
        // Transaksi
        const last = localStorage.getItem(LAST_WALLET_KEY);
        const wallet = wallets.find((w) => w.id === last) ?? wallets[0];
        if (!wallet) {
          toast('Buat dompet dulu di Keuangan → Kelola', { tone: 'danger' });
          return false;
        }
        const category = matchCategory(categories, c.kind, c.categoryHint, c.title);
        const id = await finance.createTx({
          kind: c.kind,
          amount: c.amount!,
          wallet_id: wallet.id,
          category_id: category?.id ?? null,
          occurred_on: c.date!,
          title: c.title || null,
        });
        if (c.tags.length) await tagActions.addByName('transaction', id, c.tags);
        toast(
          `${c.kind === 'income' ? 'Pemasukan' : 'Pengeluaran'} ${formatIDR(c.amount!)} · ${category?.name ?? 'tanpa kategori'} · ${wallet.name}`,
          { tone: 'success', action: { label: 'Ubah', onClick: () => editTx(id) } },
        );
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), { tone: 'danger' });
        return false;
      }
    },
    [
      tasks,
      finance,
      journal,
      noteActions,
      tagActions,
      wallets,
      categories,
      openTask,
      editTx,
      navigate,
    ],
  );
}
