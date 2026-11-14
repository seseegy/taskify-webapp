import { Pin, Plus, StickyNote } from 'lucide-react';
import { Link } from 'react-router';
import type { LocalDate } from '@/lib/date';
import { plainExcerpt } from '@/lib/markdown';
import { useNotesOnDate } from '../note-queries';

/** Catatan yang ditempel ke satu tanggal + tombol tulis (panel hari di Kalender). */
export function DayNotes({ date }: { date: LocalDate }) {
  const notes = useNotesOnDate(date);
  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between text-xs font-semibold text-muted">
        Catatan
        <Link
          to={`/catatan?baru=${date}`}
          className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-primary hover:bg-surface"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Tulis
        </Link>
      </h3>
      {notes.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted">Belum ada catatan.</p>
      ) : (
        <div className="space-y-0.5">
          {notes.map((n) => (
            <Link
              key={n.id}
              to={`/catatan?catatan=${n.id}`}
              className="flex items-start gap-2.5 rounded-2xl px-2 py-1.5 hover:bg-surface"
            >
              <StickyNote className="mt-1 size-5 shrink-0 text-mod-notes" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{n.title || 'Tanpa judul'}</span>
                  {n.is_pinned === 1 && (
                    <Pin className="size-3 shrink-0 text-primary" aria-label="Disematkan" />
                  )}
                </span>
                <span className="block truncate text-xs text-muted">
                  {plainExcerpt(n.content, 70) || 'Belum ada isi'}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
