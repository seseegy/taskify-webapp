import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import type { Note } from '@/db/schema';
import type { LocalDate } from '@/lib/date';
import { escapeLike, type NoteScope } from './note-utils';

export interface NoteFilter {
  search?: string;
  scope?: NoteScope;
  trash?: boolean;
}

/**
 * Daftar catatan. Urutan: disematkan → tanggal terbaru → terbaru dibuat; catatan bebas
 * (note_date NULL) di bawah yang bertanggal. Pencarian di judul & isi (huruf besar/kecil
 * diabaikan; `%` dan `_` dibaca apa adanya).
 */
export function useNotes(f: NoteFilter) {
  const search = escapeLike(f.search?.trim().toLowerCase() ?? '');
  const scope = f.scope ?? 'all';
  const { data, isLoading } = useQuery<Note>(
    `SELECT * FROM notes
      WHERE (CASE WHEN ?1 = 1 THEN deleted_at IS NOT NULL ELSE deleted_at IS NULL END)
        AND (?2 = 'all' OR (?2 = 'dated' AND note_date IS NOT NULL) OR (?2 = 'free' AND note_date IS NULL))
        AND (?3 = '' OR LOWER(COALESCE(title, '') || ' ' || content) LIKE '%' || ?3 || '%' ESCAPE '\\')
      ORDER BY is_pinned DESC, (note_date IS NULL), note_date DESC, created_at DESC
      LIMIT 1000`,
    [f.trash ? 1 : 0, scope, search],
  );
  return { notes: data, isLoading };
}

export function useNote(id: string | null) {
  const { data } = useQuery<Note>('SELECT * FROM notes WHERE id = ?1', [id ?? '']);
  return data[0];
}

/** Catatan yang ditempel ke satu tanggal (panel hari di Kalender, buka-dari-tanggal). */
export function useNotesOnDate(date: LocalDate) {
  const { data } = useQuery<Note>(
    `SELECT * FROM notes WHERE deleted_at IS NULL AND note_date = ?1
      ORDER BY is_pinned DESC, created_at`,
    [date],
  );
  return data;
}

/** Jumlah catatan (untuk subjudul halaman); hanya yang hidup. */
export function useNoteCounts() {
  const { data } = useQuery<{ total: number; dated: number; pinned: number }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(note_date IS NOT NULL), 0) AS dated,
            COALESCE(SUM(is_pinned), 0) AS pinned
       FROM notes WHERE deleted_at IS NULL`,
  );
  return useMemo(() => data[0] ?? { total: 0, dated: 0, pinned: 0 }, [data]);
}
