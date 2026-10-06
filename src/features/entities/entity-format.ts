import { formatLocalDate, relativeDayLabel, todayLocal } from '@/lib/date';
import { formatIDR } from '@/lib/money';
import { ENTITY_META, type EntityRow } from './entities';

/** Teks pendukung singkat per jenis entitas (tanggal, nominal, bahasa…). */
export function entitySubtitle(row: Pick<EntityRow, 'type' | 'subtitle'>): string {
  const s = row.subtitle;
  if (!s) return ENTITY_META[row.type].label;
  switch (row.type) {
    case 'task':
      return `Tugas · ${relativeDayLabel(s, todayLocal())}`;
    case 'journal_entry':
      return `Jurnal · ${formatLocalDate(s, 'd MMM yyyy')}`;
    case 'transaction': {
      const [date = '', kind, amount] = s.split('|');
      const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : '';
      return `${sign}${formatIDR(Number(amount))} · ${formatLocalDate(date, 'd MMM')}`;
    }
    case 'snippet':
      return `Snippet · ${s}`;
    default:
      return ENTITY_META[row.type].label;
  }
}
