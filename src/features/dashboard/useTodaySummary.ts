import { useQuery } from '@powersync/react';
import { todayLocal } from '@/lib/date';

export interface TodaySummary {
  tasks_today: number;
  tasks_today_done: number;
  tasks_overdue: number;
  expense_today: number;
  expense_month: number;
  income_month: number;
  balance: number;
  journal_today: number;
  snippets_total: number;
}

/**
 * Ringkasan Beranda dalam satu query reaktif.
 * Statistik mengabaikan transaksi hutang/piutang (debt_id). Saldo total tetap menghitung semuanya:
 * saldo awal semua dompet + pemasukan − pengeluaran
 * (transfer antar dompet saling meniadakan, jadi tidak dihitung).
 */
const SQL = `
  SELECT
    (SELECT COUNT(*) FROM tasks
      WHERE deleted_at IS NULL AND parent_id IS NULL AND due_date = ?1
        AND status <> 'cancelled')                                          AS tasks_today,
    (SELECT COUNT(*) FROM tasks
      WHERE deleted_at IS NULL AND parent_id IS NULL AND due_date = ?1
        AND status = 'done')                                                AS tasks_today_done,
    (SELECT COUNT(*) FROM tasks
      WHERE deleted_at IS NULL AND parent_id IS NULL AND due_date < ?1
        AND status IN ('todo', 'in_progress'))                              AS tasks_overdue,
    (SELECT COALESCE(SUM(amount), 0) FROM transactions
      WHERE deleted_at IS NULL AND debt_id IS NULL AND kind = 'expense' AND occurred_on = ?1)   AS expense_today,
    (SELECT COALESCE(SUM(amount), 0) FROM transactions
      WHERE deleted_at IS NULL AND debt_id IS NULL AND kind = 'expense'
        AND occurred_on BETWEEN ?2 AND ?1)                                  AS expense_month,
    (SELECT COALESCE(SUM(amount), 0) FROM transactions
      WHERE deleted_at IS NULL AND debt_id IS NULL AND kind = 'income'
        AND occurred_on BETWEEN ?2 AND ?1)                                  AS income_month,
    (SELECT COALESCE(SUM(initial_balance), 0) FROM wallets WHERE deleted_at IS NULL)
      + (SELECT COALESCE(SUM(CASE kind WHEN 'income' THEN amount
                                       WHEN 'expense' THEN -amount ELSE 0 END), 0)
           FROM transactions WHERE deleted_at IS NULL)                      AS balance,
    (SELECT COUNT(*) FROM journal_entries
      WHERE deleted_at IS NULL AND entry_date = ?1)                         AS journal_today,
    (SELECT COUNT(*) FROM snippets WHERE deleted_at IS NULL)                AS snippets_total
`;

export function useTodaySummary() {
  const today = todayLocal();
  const monthStart = `${today.slice(0, 7)}-01`;
  const { data, isLoading } = useQuery<TodaySummary>(SQL, [today, monthStart]);
  return { summary: data[0], isLoading, today };
}
