import { NotebookPen, Plus } from 'lucide-react';
import { Link } from 'react-router';
import type { LocalDate } from '@/lib/date';
import { useEntriesOnDate } from '../journal-queries';
import { plainExcerpt } from '../journal-utils';
import { MoodIcon } from './MoodIcon';

/** Jurnal pada satu tanggal + tombol tulis (panel hari di Kalender). */
export function DayJournal({ date }: { date: LocalDate }) {
  const entries = useEntriesOnDate(date);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Jurnal</h3>
        <Link
          to={`/jurnal?baru=${date}`}
          className="flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-primary hover:bg-surface"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Tulis
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted">Belum menulis.</p>
      ) : (
        <div className="space-y-0.5">
          {entries.map((e) => (
            <Link
              key={e.id}
              to={`/jurnal?entri=${e.id}`}
              className="flex items-start gap-2.5 rounded-2xl px-2 py-1.5 hover:bg-surface"
            >
              {e.mood ? (
                <MoodIcon mood={e.mood} badge className="mt-0.5 size-6" />
              ) : (
                <NotebookPen className="mt-1 size-5 text-mod-journal" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {e.title || 'Tanpa judul'}
                </span>
                <span className="block truncate text-xs text-muted">
                  {plainExcerpt(e.content, 70) || 'Belum ada isi'}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
