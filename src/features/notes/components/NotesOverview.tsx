import { CalendarCheck, Pin, Plus, StickyNote } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatLocalDate, type LocalDate } from '@/lib/date';
import { plainExcerpt } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { useNoteCounts, useNotesOnDate } from '../note-queries';
import type { ReactNode } from 'react';

/**
 * Panel kanan saat tidak ada catatan terbuka (pola yang sama dengan JournalInsights):
 * angka ringkas + catatan untuk hari ini. `compact` (HP) hanya menampilkan kartu hari ini.
 */
export function NotesOverview({
  today,
  onCreate,
  compact,
}: {
  today: LocalDate;
  /** Buat catatan baru; `date` null = catatan bebas */
  onCreate: (date: LocalDate | null) => void;
  compact?: boolean;
}) {
  const counts = useNoteCounts();
  const todays = useNotesOnDate(today);

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="grid grid-cols-3 gap-3">
          <Stat
            icon={StickyNote}
            label="Catatan"
            value={String(counts.total)}
            gradient="bg-gradient-notes"
          />
          <Stat
            icon={CalendarCheck}
            label="Bertanggal"
            value={String(counts.dated)}
            gradient="bg-gradient-calendar"
          />
          <Stat
            icon={Pin}
            label="Disematkan"
            value={String(counts.pinned)}
            gradient="bg-linear-to-br from-orange-500 to-rose-500"
          />
        </div>
      )}

      <Card className="animate-fade-up">
        <CardHeader className="mb-2">
          <div>
            <CardTitle>Hari ini</CardTitle>
            <CardDescription className="capitalize">
              {formatLocalDate(today, 'EEEE, d MMMM yyyy')}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => onCreate(today)}>
            <Plus /> Catatan hari ini
          </Button>
        </CardHeader>
        {todays.length === 0 ? (
          <p className="px-1 py-1 text-sm text-muted">
            Belum ada catatan untuk hari ini. Tulis rencana, ide, atau daftar apa pun.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {todays.map((n) => (
              <li key={n.id}>
                <Link
                  to={`/catatan?catatan=${n.id}`}
                  className="flex items-start gap-2.5 rounded-2xl px-2 py-2 hover:bg-surface"
                >
                  <StickyNote
                    className="mt-0.5 size-5 shrink-0 text-mod-notes"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {n.title || 'Tanpa judul'}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {plainExcerpt(n.content, 90) || 'Belum ada isi'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!compact && (
        <Card className="animate-fade-up">
          <CardTitle className="mb-1">Cara pakai</CardTitle>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted marker:text-muted">
            <li>
              <b className="text-fg">Catatan bebas</b> tidak terikat hari, cocok untuk ide atau
              daftar yang dipakai berulang.
            </li>
            <li>
              Pakai <b className="text-fg">Tempel ke tanggal</b> agar catatan muncul di Kalender
              pada hari itu. Satu hari boleh punya banyak catatan.
            </li>
            <li>
              Cepat dari mana saja: ketik <b className="text-fg">c:</b> di kotak cari (Ctrl/⌘ K).
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  gradient,
}: {
  icon: typeof StickyNote;
  label: string;
  value: ReactNode;
  gradient: string;
}) {
  return (
    <Card className="animate-fade-up p-3 sm:p-4">
      <span
        className={cn(
          'shine mb-2 flex size-8 items-center justify-center rounded-lg text-white shadow-md',
          gradient,
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <p className="text-[11px] font-semibold text-muted">{label}</p>
      <p className="truncate text-base font-extrabold tracking-tight sm:text-lg">{value}</p>
    </Card>
  );
}
