import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildWeek, WEEKDAY_LABELS, WEEKDAY_NAMES } from '@/features/calendar/calendar-utils';
import { addLocalDays, formatLocalDate, todayLocal, type LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { heatLevel, useActivityHeatmap } from './review-queries';

const LEVEL_CLASS = [
  'bg-surface',
  'bg-violet-500/30',
  'bg-violet-500/55',
  'bg-fuchsia-500/75',
  'bg-linear-to-br from-fuchsia-500 to-pink-500 shadow-sm shadow-fuchsia-500/40',
];

/**
 * Heatmap aktivitas ala GitHub: kolom = minggu, baris = hari (Senin–Minggu).
 * Klik/Enter pada sel → buka hari itu di Kalender.
 *
 * Aksesibilitas (ARIA grid): satu Tab stop (roving tabindex) alih-alih 182; ←/→ pindah minggu,
 * ↑/↓ pindah hari, Home/End sel pertama/terakhir di baris, PageUp/PageDown ±4 minggu.
 * Tiap sel punya label teks lengkap; intensitas warna bukan satu-satunya informasi.
 *
 * Catatan ukuran target: sel sengaja kecil (visualisasi padat). Fungsi "buka hari" tersedia juga
 * lewat halaman Kalender (kontrol setara, WCAG 2.5.8 pengecualian "Equivalent").
 */
export function ActivityHeatmap({
  weeks = 26,
  onSelect,
}: {
  weeks?: number;
  onSelect?: (day: LocalDate) => void;
}) {
  const today = todayLocal();
  const lastWeek = buildWeek(today);
  const start = addLocalDays(lastWeek[0]!, -(weeks - 1) * 7);
  const byDay = useActivityHeatmap(start, lastWeek[6]!);

  const { columns, max, total, activeDays } = useMemo(() => {
    const cols: LocalDate[][] = Array.from({ length: weeks }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => addLocalDays(start, w * 7 + d)),
    );
    let mx = 0;
    let sum = 0;
    for (const d of byDay.values()) {
      mx = Math.max(mx, d.score);
      sum += d.score;
    }
    return { columns: cols, max: mx, total: sum, activeDays: byDay.size };
  }, [byDay, start, weeks]);

  // Sel yang masuk urutan Tab (roving tabindex): terakhir difokuskan, atau hari ini
  const [active, setActive] = useState<LocalDate | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tabStop = active && active >= start && active <= today ? active : today;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date;
    if (!current || e.altKey || e.ctrlKey || e.metaKey) return;

    const first = addLocalDays(start, daysBetween(start, current) % 7); // sel pertama di baris ini
    const last = addLocalDays(first, Math.floor(daysBetween(first, today) / 7) * 7); // terakhir ≤ hari ini
    const target: Partial<Record<string, LocalDate>> = {
      ArrowLeft: addLocalDays(current, -7),
      ArrowRight: addLocalDays(current, 7),
      ArrowUp: addLocalDays(current, -1),
      ArrowDown: addLocalDays(current, 1),
      Home: first,
      End: last,
      PageUp: addLocalDays(current, -28),
      PageDown: addLocalDays(current, 28),
    };
    let next = target[e.key];
    if (!next) return;
    e.preventDefault();
    // Jangan keluar dari rentang yang tampil / masuk ke masa depan
    if (next < start) next = e.key === 'PageUp' ? first : current;
    else if (next > today) next = e.key === 'PageDown' ? last : current;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
  };

  // Baris = hari dalam minggu, kolom = minggu. DOM dibuat per baris (role=row + display:contents)
  // supaya struktur ARIA valid sementara tampilannya tetap kolom-per-minggu.
  return (
    <div>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="hidden flex-col justify-between py-0.5 text-xs text-muted sm:flex"
        >
          {WEEKDAY_LABELS.map((d, i) => (
            <span key={d} className={cn('h-3 leading-3', i % 2 === 1 && 'invisible')}>
              {d}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div
            ref={gridRef}
            role="grid"
            aria-label="Heatmap aktivitas"
            aria-rowcount={7}
            aria-colcount={weeks}
            onKeyDown={onKeyDown}
            className="grid w-max gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${weeks}, auto)` }}
          >
            {WEEKDAY_NAMES.map((name, r) => (
              <div key={name} role="row" aria-label={name} className="contents">
                {columns.map((col) => {
                  const day = col[r]!;
                  const d = byDay.get(day);
                  if (day > today) {
                    // Hari yang belum terjadi: ruang kosong, disembunyikan dari pembaca layar
                    return (
                      <div
                        key={day}
                        role="gridcell"
                        aria-hidden="true"
                        className="size-3 sm:size-3.5"
                      />
                    );
                  }
                  const level = heatLevel(d?.score ?? 0, max);
                  const label = d
                    ? `${formatLocalDate(day, 'EEEE, d MMMM yyyy')}: ${d.tasks} tugas selesai, ${d.journal} jurnal, ${d.transactions} transaksi, ${d.vault} vault`
                    : `${formatLocalDate(day, 'EEEE, d MMMM yyyy')}: tidak ada aktivitas`;
                  return (
                    <div key={day} role="gridcell">
                      <button
                        type="button"
                        data-date={day}
                        tabIndex={day === tabStop ? 0 : -1}
                        title={label}
                        aria-label={day === today ? `${label} (hari ini)` : label}
                        aria-current={day === today ? 'date' : undefined}
                        onFocus={() => setActive(day)}
                        onClick={() => onSelect?.(day)}
                        className={cn(
                          'block size-3 rounded-[3px] transition hover:ring-2 hover:ring-primary/50 sm:size-3.5',
                          LEVEL_CLASS[level],
                          day === today && 'ring-2 ring-primary',
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {activeDays} hari aktif · {total} aktivitas dalam {weeks} minggu
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          Sedikit
          {LEVEL_CLASS.map((c, i) => (
            <span key={i} className={cn('size-3 rounded-[3px]', c)} />
          ))}
          Banyak
        </span>
      </div>
    </div>
  );
}

/** Jumlah hari dari a ke b (b ≥ a). Tanggal lokal 'YYYY-MM-DD' aman dibandingkan via UTC. */
function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
