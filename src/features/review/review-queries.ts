/**
 * Data untuk Review mingguan/bulanan dan heatmap aktivitas.
 * Timestamp UTC (completed_at, created_at) dikonversi ke tanggal WIB di SQLite.
 * Statistik keuangan mengikuti aturan modul Keuangan: tanpa transfer & transaksi hutang.
 */
import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import {
  addLocalDays,
  addMonthsLocal,
  diffLocalDays,
  monthEnd,
  SQLITE_TZ_MODIFIER,
  type LocalDate,
} from '@/lib/date';
import { buildWeek } from '@/features/calendar/calendar-utils';

export type ReviewPeriod = 'minggu' | 'bulan';

export interface Range {
  from: LocalDate;
  to: LocalDate;
}

/** Rentang periode yang memuat `anchor`, beserta periode sebelumnya (panjang setara). */
export function periodRange(
  period: ReviewPeriod,
  anchor: LocalDate,
): { current: Range; previous: Range } {
  if (period === 'minggu') {
    const week = buildWeek(anchor);
    const from = week[0]!;
    return {
      current: { from, to: week[6]! },
      previous: { from: addLocalDays(from, -7), to: addLocalDays(from, -1) },
    };
  }
  const from = `${anchor.slice(0, 7)}-01`;
  const prevFrom = addMonthsLocal(from, -1);
  return {
    current: { from, to: monthEnd(from) },
    previous: { from: prevFrom, to: monthEnd(prevFrom) },
  };
}

export function shiftPeriod(period: ReviewPeriod, anchor: LocalDate, dir: -1 | 1): LocalDate {
  return period === 'minggu' ? addLocalDays(anchor, dir * 7) : addMonthsLocal(anchor, dir);
}

export interface PeriodStats {
  tasks_done: number;
  tasks_created: number;
  tasks_due: number;
  tasks_due_done: number;
  income: number;
  expense: number;
  tx_count: number;
  journal_entries: number;
  journal_days: number;
  mood_avg: number | null;
  snippets_new: number;
  versions_new: number;
}

const STATS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 'done'
        AND date(completed_at, ?3) BETWEEN ?1 AND ?2)                                     AS tasks_done,
    (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL
        AND date(created_at, ?3) BETWEEN ?1 AND ?2)                                       AS tasks_created,
    (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status <> 'cancelled'
        AND due_date BETWEEN ?1 AND ?2)                                                   AS tasks_due,
    (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 'done'
        AND due_date BETWEEN ?1 AND ?2)                                                   AS tasks_due_done,
    (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE deleted_at IS NULL AND debt_id IS NULL
        AND kind = 'income' AND occurred_on BETWEEN ?1 AND ?2)                            AS income,
    (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE deleted_at IS NULL AND debt_id IS NULL
        AND kind = 'expense' AND occurred_on BETWEEN ?1 AND ?2)                           AS expense,
    (SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL AND occurred_on BETWEEN ?1 AND ?2) AS tx_count,
    (SELECT COUNT(*) FROM journal_entries WHERE deleted_at IS NULL AND entry_date BETWEEN ?1 AND ?2) AS journal_entries,
    (SELECT COUNT(DISTINCT entry_date) FROM journal_entries WHERE deleted_at IS NULL
        AND entry_date BETWEEN ?1 AND ?2)                                                 AS journal_days,
    (SELECT AVG(mood) FROM journal_entries WHERE deleted_at IS NULL AND mood IS NOT NULL
        AND entry_date BETWEEN ?1 AND ?2)                                                 AS mood_avg,
    (SELECT COUNT(*) FROM snippets WHERE deleted_at IS NULL AND date(created_at, ?3) BETWEEN ?1 AND ?2) AS snippets_new,
    (SELECT COUNT(*) FROM attachments WHERE deleted_at IS NULL AND entity_type = 'code_project'
        AND date(created_at, ?3) BETWEEN ?1 AND ?2)                                       AS versions_new
`;

export function usePeriodStats(r: Range): PeriodStats | undefined {
  const { data } = useQuery<PeriodStats>(STATS_SQL, [r.from, r.to, SQLITE_TZ_MODIFIER]);
  return data[0];
}

export interface DayPoint {
  day: LocalDate;
  tasks_done: number;
  expense: number;
  journal: number;
  mood: number | null;
}

/** Ringkasan per hari (tugas selesai, pengeluaran, jurnal, mood) dalam rentang. */
export function useDailySeries(r: Range): DayPoint[] {
  const { data } = useQuery<{ day: LocalDate; kind: string; n: number; v: number | null }>(
    `SELECT date(completed_at, ?3) AS day, 'done' AS kind, COUNT(*) AS n, NULL AS v FROM tasks
      WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 'done' AND date(completed_at, ?3) BETWEEN ?1 AND ?2
      GROUP BY day
     UNION ALL
     SELECT occurred_on, 'expense', COUNT(*), SUM(amount) FROM transactions
      WHERE deleted_at IS NULL AND debt_id IS NULL AND kind = 'expense' AND occurred_on BETWEEN ?1 AND ?2
      GROUP BY occurred_on
     UNION ALL
     SELECT entry_date, 'journal', COUNT(*), AVG(mood) FROM journal_entries
      WHERE deleted_at IS NULL AND entry_date BETWEEN ?1 AND ?2 GROUP BY entry_date`,
    [r.from, r.to, SQLITE_TZ_MODIFIER],
  );
  return useMemo(() => {
    const days = diffLocalDays(r.from, r.to) + 1;
    const map = new Map<LocalDate, DayPoint>();
    for (let i = 0; i < days; i++) {
      const day = addLocalDays(r.from, i);
      map.set(day, { day, tasks_done: 0, expense: 0, journal: 0, mood: null });
    }
    for (const row of data) {
      const p = map.get(row.day);
      if (!p) continue;
      if (row.kind === 'done') p.tasks_done = row.n;
      if (row.kind === 'expense') p.expense = row.v ?? 0;
      if (row.kind === 'journal') {
        p.journal = row.n;
        p.mood = row.v;
      }
    }
    return [...map.values()];
  }, [data, r.from, r.to]);
}

export interface HeatDay {
  day: LocalDate;
  score: number;
  tasks: number;
  journal: number;
  transactions: number;
  vault: number;
}

/**
 * Skor aktivitas per hari untuk heatmap: tugas selesai + jurnal + transaksi + item vault baru.
 */
/**
 * Aturan hitung SAMA dengan Kalender & Review (supaya angka satu hari tidak berbeda antar layar):
 *  - tugas = hanya tugas induk (subtask tidak dihitung sendiri)
 *  - vault = snippet baru + project baru + versi file project baru
 */
export const HEATMAP_SQL = `SELECT date(completed_at, ?3) AS day, 'tasks' AS kind, COUNT(*) AS n FROM tasks
      WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 'done'
        AND date(completed_at, ?3) BETWEEN ?1 AND ?2 GROUP BY day
     UNION ALL
     SELECT entry_date, 'journal', COUNT(*) FROM journal_entries
      WHERE deleted_at IS NULL AND entry_date BETWEEN ?1 AND ?2 GROUP BY entry_date
     UNION ALL
     SELECT occurred_on, 'transactions', COUNT(*) FROM transactions
      WHERE deleted_at IS NULL AND occurred_on BETWEEN ?1 AND ?2 GROUP BY occurred_on
     UNION ALL
     SELECT day, 'vault', COUNT(*) FROM (
       SELECT date(created_at, ?3) AS day FROM snippets WHERE deleted_at IS NULL
       UNION ALL SELECT date(created_at, ?3) FROM code_projects WHERE deleted_at IS NULL
       UNION ALL SELECT date(created_at, ?3) FROM attachments
        WHERE deleted_at IS NULL AND entity_type = 'code_project')
      WHERE day BETWEEN ?1 AND ?2 GROUP BY day`;

export function useActivityHeatmap(from: LocalDate, to: LocalDate) {
  const { data } = useQuery<{ day: LocalDate; kind: string; n: number }>(HEATMAP_SQL, [
    from,
    to,
    SQLITE_TZ_MODIFIER,
  ]);
  return useMemo(() => {
    const map = new Map<LocalDate, HeatDay>();
    for (const r of data) {
      const d = map.get(r.day) ?? {
        day: r.day,
        score: 0,
        tasks: 0,
        journal: 0,
        transactions: 0,
        vault: 0,
      };
      d[r.kind as 'tasks' | 'journal' | 'transactions' | 'vault'] += r.n;
      d.score += r.n;
      map.set(r.day, d);
    }
    return map;
  }, [data]);
}

/** Level 0–4 relatif terhadap hari tersibuk dalam rentang yang ditampilkan. */
export function heatLevel(score: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (score <= 0) return 0;
  const ratio = score / Math.max(1, max);
  return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
}

/** Perubahan persen terhadap periode sebelumnya; null jika tidak bermakna. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}
