import type { BudgetStatus, TxRow } from './finance-queries';

/** Judul tampilan transaksi: keterangan → kategori → jenis. */
export function txTitle(t: TxRow) {
  if (t.title) return t.title;
  if (t.kind === 'transfer') return 'Transfer';
  return t.category_name ?? (t.kind === 'income' ? 'Pemasukan' : 'Pengeluaran');
}

/** Status anggaran: ok / warn (≥ alert_pct) / over (≥ 100%). */
export function budgetLevel(b: Pick<BudgetStatus, 'spent' | 'amount' | 'alert_pct'>) {
  const pct = (b.spent / b.amount) * 100;
  return pct >= 100 ? 'over' : pct >= b.alert_pct ? 'warn' : 'ok';
}
