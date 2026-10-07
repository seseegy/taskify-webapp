import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import { SQLITE_TZ_MODIFIER, type LocalDate } from '@/lib/date';

/** Jenis aktivitas yang tampil di kalender. */
export type ActivityKind = 'journal' | 'expense' | 'income' | 'vault';

export interface DayActivity {
  tasks: number;
  tasksDone: number;
  journal: number;
  /** Rata-rata mood jurnal hari itu (1–5), null jika tidak ada */
  mood: number | null;
  expense: number; // total rupiah
  income: number; // total rupiah
  transactions: number;
  vault: number;
}

export const EMPTY_DAY: DayActivity = {
  tasks: 0,
  tasksDone: 0,
  journal: 0,
  mood: null,
  expense: 0,
  income: 0,
  transactions: 0,
  vault: 0,
};

interface Row {
  day: LocalDate;
  kind: ActivityKind;
  count: number;
  done: number;
  amount: number | null;
}

/**
 * Agregasi modul NON-tugas per hari dalam satu query (UNION ALL). Tugas (termasuk kejadian
 * berulang virtual) digabungkan oleh useDayActivity → pakai hook itu di UI.
 * Reaktif: otomatis berjalan ulang saat salah satu tabel berubah (lokal maupun dari sync).
 *
 * Catatan:
 *  - Data yang punya tanggal lokal (entry_date, occurred_on) dipakai apa adanya.
 *  - Vault (snippet, project, file) tidak punya tanggal lokal → created_at UTC dikonversi ke WIB.
 */
const SQL = `
  SELECT entry_date AS day, 'journal' AS kind, COUNT(*) AS count, 0 AS done, AVG(mood) AS amount
    FROM journal_entries
   WHERE deleted_at IS NULL AND entry_date BETWEEN ?1 AND ?2
   GROUP BY entry_date
  UNION ALL
  SELECT occurred_on, kind, COUNT(*), 0, SUM(amount)
    FROM transactions
   WHERE deleted_at IS NULL AND kind IN ('expense', 'income') AND occurred_on BETWEEN ?1 AND ?2
   GROUP BY occurred_on, kind
  UNION ALL
  SELECT day, 'vault', COUNT(*), 0, 0 FROM (
    SELECT date(created_at, ?3) AS day FROM snippets WHERE deleted_at IS NULL
    UNION ALL
    SELECT date(created_at, ?3) FROM code_projects WHERE deleted_at IS NULL
    UNION ALL
    SELECT date(created_at, ?3) FROM attachments
     WHERE deleted_at IS NULL AND entity_type = 'code_project'
  )
   WHERE day BETWEEN ?1 AND ?2
   GROUP BY day
`;

export function useCalendarActivity(from: LocalDate, to: LocalDate) {
  const { data, isLoading, error } = useQuery<Row>(SQL, [from, to, SQLITE_TZ_MODIFIER]);

  const byDay = useMemo(() => {
    const map = new Map<LocalDate, DayActivity>();
    for (const row of data) {
      const entry = map.get(row.day) ?? { ...EMPTY_DAY };
      switch (row.kind) {
        case 'journal':
          entry.journal += row.count;
          entry.mood = row.amount === null ? null : Math.round(row.amount);
          break;
        case 'expense':
          entry.expense += row.amount ?? 0;
          entry.transactions += row.count;
          break;
        case 'income':
          entry.income += row.amount ?? 0;
          entry.transactions += row.count;
          break;
        case 'vault':
          entry.vault += row.count;
          break;
      }
      map.set(row.day, entry);
    }
    return map;
  }, [data]);

  return { byDay, isLoading, error };
}
