import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import type { JournalEntry } from '@/db/schema';
import { addLocalDays, type LocalDate } from '@/lib/date';

export interface JournalFilter {
  search?: string;
  mood?: number | null;
  trash?: boolean;
}

/** Daftar jurnal (terbaru dulu). Pencarian di judul & isi. */
export function useJournalEntries(f: JournalFilter) {
  const search = f.search?.trim().toLowerCase() ?? '';
  const { data, isLoading } = useQuery<JournalEntry>(
    `SELECT * FROM journal_entries
      WHERE (CASE WHEN ?1 = 1 THEN deleted_at IS NOT NULL ELSE deleted_at IS NULL END)
        AND (?2 IS NULL OR mood = ?2)
        AND (?3 = '' OR LOWER(COALESCE(title, '') || ' ' || content) LIKE '%' || ?3 || '%')
      ORDER BY is_pinned DESC, entry_date DESC, created_at DESC
      LIMIT 1000`,
    [f.trash ? 1 : 0, f.mood ?? null, search],
  );
  return { entries: data, isLoading };
}

export function useJournalEntry(id: string | null) {
  const { data } = useQuery<JournalEntry>('SELECT * FROM journal_entries WHERE id = ?1', [
    id ?? '',
  ]);
  return data[0];
}

export function useEntriesOnDate(date: LocalDate) {
  const { data } = useQuery<JournalEntry>(
    `SELECT * FROM journal_entries WHERE deleted_at IS NULL AND entry_date = ?1 ORDER BY created_at`,
    [date],
  );
  return data;
}

export interface MoodPoint {
  day: LocalDate;
  mood: number | null;
  entries: number;
}

/** Mood rata-rata per hari selama `days` hari terakhir (hari tanpa jurnal = null). */
export function useMoodSeries(today: LocalDate, days = 30): MoodPoint[] {
  const from = addLocalDays(today, -(days - 1));
  const { data } = useQuery<{ day: LocalDate; mood: number | null; entries: number }>(
    `SELECT entry_date AS day, AVG(mood) AS mood, COUNT(*) AS entries FROM journal_entries
      WHERE deleted_at IS NULL AND entry_date BETWEEN ?1 AND ?2 GROUP BY entry_date`,
    [from, today],
  );
  return useMemo(() => {
    const map = new Map(data.map((r) => [r.day, r]));
    return Array.from({ length: days }, (_, i) => {
      const day = addLocalDays(from, i);
      const r = map.get(day);
      return { day, mood: r?.mood ?? null, entries: r?.entries ?? 0 };
    });
  }, [data, from, days]);
}

/** Tanggal unik yang punya jurnal (untuk streak). */
export function useJournalDays() {
  const { data } = useQuery<{ day: LocalDate }>(
    `SELECT DISTINCT entry_date AS day FROM journal_entries
      WHERE deleted_at IS NULL ORDER BY entry_date DESC LIMIT 1000`,
  );
  return useMemo(() => data.map((r) => r.day), [data]);
}

/** "Hari ini di masa lalu": tanggal & bulan sama di tahun sebelumnya, plus tepat 1 bulan lalu. */
export function useOnThisDay(today: LocalDate) {
  const monthAgo = (() => {
    const [y, m, d] = today.split('-').map(Number);
    const date = new Date(Date.UTC(y!, m! - 2, d!));
    // Lewati jika tanggal tidak ada di bulan lalu (mis. 31 → 1 bulan berikutnya)
    return date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
  })();
  const { data } = useQuery<JournalEntry>(
    `SELECT * FROM journal_entries
      WHERE deleted_at IS NULL AND entry_date < ?1
        AND (substr(entry_date, 6) = substr(?1, 6) OR entry_date = ?2)
      ORDER BY entry_date DESC LIMIT 5`,
    [today, monthAgo ?? ''],
  );
  return data;
}
