/**
 * Query reaktif modul Keuangan (SQLite lokal).
 *
 * Aturan perhitungan:
 *  - Saldo dompet = saldo awal + pemasukan − pengeluaran − transfer keluar + transfer masuk.
 *  - Statistik (ringkasan, kategori, anggaran) MENGABAIKAN transfer dan transaksi hutang/piutang
 *    (debt_id terisi), karena itu perpindahan uang, bukan pemasukan/pengeluaran sebenarnya.
 */
import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import type { Category, Transaction, TransactionKind, Wallet } from '@/db/schema';
import type { LocalDate } from '@/lib/date';

export interface WalletWithBalance extends Wallet {
  balance: number;
  tx_count: number;
}

export function useWallets(includeArchived = true) {
  const { data, isLoading } = useQuery<WalletWithBalance>(
    `SELECT w.*,
            w.initial_balance + COALESCE((
              SELECT SUM(CASE
                WHEN t.kind = 'income'   AND t.wallet_id = w.id    THEN t.amount
                WHEN t.kind = 'expense'  AND t.wallet_id = w.id    THEN -t.amount
                WHEN t.kind = 'transfer' AND t.wallet_id = w.id    THEN -t.amount
                WHEN t.kind = 'transfer' AND t.to_wallet_id = w.id THEN t.amount
                ELSE 0 END)
              FROM transactions t
             WHERE t.deleted_at IS NULL AND (t.wallet_id = w.id OR t.to_wallet_id = w.id)), 0) AS balance,
            (SELECT COUNT(*) FROM transactions t
              WHERE t.deleted_at IS NULL AND (t.wallet_id = w.id OR t.to_wallet_id = w.id)) AS tx_count
       FROM wallets w
      WHERE w.deleted_at IS NULL AND (?1 = 1 OR w.is_archived = 0)
      ORDER BY w.is_archived, w.position, w.created_at`,
    [includeArchived ? 1 : 0],
  );
  return { wallets: data, isLoading };
}

export function useCategories(kind?: 'income' | 'expense') {
  const { data } = useQuery<Category & { tx_count: number }>(
    `SELECT c.*, (SELECT COUNT(*) FROM transactions t
                   WHERE t.deleted_at IS NULL AND t.category_id = c.id) AS tx_count
       FROM categories c
      WHERE c.deleted_at IS NULL AND c.is_archived = 0 AND (?1 IS NULL OR c.kind = ?1)
      ORDER BY c.kind DESC, c.position, c.name`,
    [kind ?? null],
  );
  return data;
}

export interface TxRow extends Transaction {
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  wallet_name: string | null;
  to_wallet_name: string | null;
}

export interface TxFilter {
  from: LocalDate;
  to: LocalDate;
  kind?: TransactionKind | null;
  walletId?: string | null;
  categoryId?: string | null;
  search?: string;
  limit?: number;
}

const TX_SELECT = `
  SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
         w.name AS wallet_name, tw.name AS to_wallet_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN wallets w ON w.id = t.wallet_id
    LEFT JOIN wallets tw ON tw.id = t.to_wallet_id`;

export function useTransactions(f: TxFilter) {
  const search = f.search?.trim().toLowerCase() ?? '';
  const { data, isLoading } = useQuery<TxRow>(
    `${TX_SELECT}
     WHERE t.deleted_at IS NULL
       AND t.occurred_on BETWEEN ?1 AND ?2
       AND (?3 IS NULL OR t.kind = ?3)
       AND (?4 IS NULL OR t.wallet_id = ?4 OR t.to_wallet_id = ?4)
       AND (?5 IS NULL OR t.category_id = ?5)
       AND (?6 = '' OR LOWER(COALESCE(t.title, '') || ' ' || COALESCE(t.note, '') || ' ' ||
                             COALESCE(c.name, '')) LIKE '%' || ?6 || '%')
     ORDER BY t.occurred_on DESC, COALESCE(t.occurred_time, '99') DESC, t.created_at DESC
     LIMIT ?7`,
    [
      f.from,
      f.to,
      f.kind ?? null,
      f.walletId ?? null,
      f.categoryId ?? null,
      search,
      f.limit ?? 2000,
    ],
  );
  return { rows: data, isLoading };
}

export function useTransaction(id: string | null) {
  const { data } = useQuery<TxRow>(`${TX_SELECT} WHERE t.id = ?1`, [id ?? '']);
  return data[0];
}

export interface PeriodTotals {
  income: number;
  expense: number;
  count: number;
}

/** Total pemasukan & pengeluaran (tanpa transfer & hutang) dalam rentang. */
export function usePeriodTotals(from: LocalDate, to: LocalDate) {
  const { data } = useQuery<PeriodTotals>(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense,
            COUNT(*) AS count
       FROM transactions
      WHERE deleted_at IS NULL AND debt_id IS NULL AND kind <> 'transfer'
        AND occurred_on BETWEEN ?1 AND ?2`,
    [from, to],
  );
  return data[0] ?? { income: 0, expense: 0, count: 0 };
}

export interface CategorySlice {
  category_id: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  total: number;
  count: number;
}

export function useCategoryBreakdown(from: LocalDate, to: LocalDate, kind: 'income' | 'expense') {
  const { data } = useQuery<CategorySlice>(
    `SELECT t.category_id, COALESCE(c.name, 'Tanpa kategori') AS name, c.color, c.icon,
            SUM(t.amount) AS total, COUNT(*) AS count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.deleted_at IS NULL AND t.debt_id IS NULL AND t.kind = ?3
        AND t.occurred_on BETWEEN ?1 AND ?2
      GROUP BY t.category_id
      ORDER BY total DESC`,
    [from, to, kind],
  );
  return data;
}

/** Pengeluaran & pemasukan per hari dalam rentang. */
export function useDailyTotals(from: LocalDate, to: LocalDate) {
  const { data } = useQuery<{ day: LocalDate; income: number; expense: number }>(
    `SELECT occurred_on AS day,
            COALESCE(SUM(CASE WHEN kind = 'income' THEN amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense
       FROM transactions
      WHERE deleted_at IS NULL AND debt_id IS NULL AND kind <> 'transfer'
        AND occurred_on BETWEEN ?1 AND ?2
      GROUP BY occurred_on`,
    [from, to],
  );
  return useMemo(() => new Map(data.map((r) => [r.day, r])), [data]);
}

export interface BudgetStatus {
  id: string;
  category_id: string | null;
  amount: number;
  alert_pct: number;
  start_month: string;
  end_month: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  spent: number;
}

/** Anggaran yang berlaku di bulan `month` (YYYY-MM-01) beserta realisasinya. */
export function useBudgets(month: LocalDate, monthLast: LocalDate) {
  const { data } = useQuery<BudgetStatus>(
    `SELECT b.id, b.category_id, b.amount, b.alert_pct, b.start_month, b.end_month,
            COALESCE(c.name, 'Total pengeluaran') AS name, c.color, c.icon,
            COALESCE((SELECT SUM(t.amount) FROM transactions t
                       WHERE t.deleted_at IS NULL AND t.debt_id IS NULL AND t.kind = 'expense'
                         AND t.occurred_on BETWEEN ?1 AND ?2
                         AND (b.category_id IS NULL OR t.category_id = b.category_id)), 0) AS spent
       FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.deleted_at IS NULL AND b.start_month <= ?1
        AND (b.end_month IS NULL OR b.end_month >= ?1)
      ORDER BY b.category_id IS NOT NULL, c.position, c.name`,
    [month, monthLast],
  );
  return data;
}

export interface RecurringRow {
  id: string;
  kind: TransactionKind;
  amount: number;
  wallet_id: string;
  to_wallet_id: string | null;
  category_id: string | null;
  title: string;
  note: string | null;
  rrule: string;
  start_on: string;
  end_on: string | null;
  next_run_on: string | null;
  auto_post: number;
  is_active: number;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  wallet_name: string | null;
}

export function useRecurringTransactions() {
  const { data } = useQuery<RecurringRow>(
    `SELECT r.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
            w.name AS wallet_name
       FROM recurring_transactions r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN wallets w ON w.id = r.wallet_id
      WHERE r.deleted_at IS NULL
      ORDER BY r.is_active DESC, r.next_run_on IS NULL, r.next_run_on, r.title`,
  );
  return data;
}

export interface DebtRow {
  id: string;
  direction: 'lent' | 'borrowed';
  counterparty: string;
  amount: number;
  due_date: string | null;
  note: string | null;
  settled_at: string | null;
  created_at: string;
}

export function useDebts() {
  const { data } = useQuery<DebtRow>(
    `SELECT id, direction, counterparty, amount, due_date, note, settled_at, created_at
       FROM debts WHERE deleted_at IS NULL
      ORDER BY settled_at IS NOT NULL, due_date IS NULL, due_date, created_at DESC`,
  );
  return data;
}
