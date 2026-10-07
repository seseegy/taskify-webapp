import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { addLocalDays, daysInMonth, formatLocalDate, type LocalDate } from '@/lib/date';
import { formatIDR, formatIDRCompact } from '@/lib/money';
import { paletteOf } from '@/lib/palette';
import { cn } from '@/lib/utils';
import type { CategorySlice } from '../finance-queries';
import { CategoryIcon } from './CategoryIcon';

/** Donut pengeluaran per kategori (CSS conic-gradient, tanpa library grafik). */
export function CategoryDonut({
  slices,
  total,
  label,
}: {
  slices: CategorySlice[];
  total: number;
  label: string;
}) {
  let acc = 0;
  const stops = slices.map((s) => {
    const start = (acc / total) * 360;
    acc += s.total;
    const end = (acc / total) * 360;
    return `${paletteOf(s.color, 'slate').hex} ${start}deg ${end}deg`;
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <div
        className="relative size-40 shrink-0 rounded-full shadow-inner"
        style={{ background: total > 0 ? `conic-gradient(${stops.join(',')})` : 'var(--surface)' }}
        role="img"
        aria-label={`${label}: ${formatIDR(total)}`}
      >
        <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full text-center glass-strong">
          <span className="text-[11px] font-semibold text-muted">{label}</span>
          <span className="text-base font-extrabold tracking-tight">{formatIDRCompact(total)}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {slices.slice(0, 7).map((s) => {
          const pct = total ? Math.round((s.total / total) * 100) : 0;
          return (
            <li key={s.category_id ?? 'none'} className="flex items-center gap-2.5 text-sm">
              <CategoryIcon icon={s.icon} color={s.color} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-2">
                  <span className="truncate font-semibold">{s.name}</span>
                  <span className="shrink-0 font-bold tabular-nums">{formatIDR(s.total)}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="relative block h-1.5 flex-1" aria-hidden="true">
                    <span className="absolute inset-0 overflow-hidden rounded-full bg-surface">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${pct}%`, background: paletteOf(s.color, 'slate').hex }}
                      />
                    </span>
                  </span>
                  <span className="w-8 text-right text-xs text-muted">{pct}%</span>
                </span>
              </span>
            </li>
          );
        })}
        {slices.length > 7 && (
          <li className="text-xs text-muted">+{slices.length - 7} kategori lain</li>
        )}
      </ul>
    </div>
  );
}

/**
 * Batang pengeluaran harian dalam satu bulan.
 *
 * Aksesibilitas:
 * - Satu Tab stop (roving tabindex); ←/→/Home/End berpindah hari. Setiap batang punya
 *   nama lengkap ("Senin, 5 Oktober: Rp 25.000").
 * - Batang sempit di HP (±7px), jadi ketuk = pilih hari; detail tampil di bawah grafik dengan
 *   tombol ‹ › dan "Lihat di kalender" berukuran ≥ 40px (kontrol setara, WCAG 2.5.8).
 * - Nilai tidak lagi hanya ada di tooltip hover.
 */
export function DailyBars({
  month,
  totals,
  today,
  onSelect,
}: {
  month: LocalDate;
  totals: Map<LocalDate, { expense: number; income: number }>;
  today: LocalDate;
  /** Dipanggil dari tombol "Lihat di kalender" untuk hari yang dipilih */
  onSelect?: (day: LocalDate) => void;
}) {
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => addLocalDays(month, i));
  const expenseOf = (d: LocalDate) => totals.get(d)?.expense ?? 0;
  const max = Math.max(1, ...days.map(expenseOf));

  // Hari default: hari ini (jika di bulan ini), selain itu hari dengan pengeluaran terbesar
  const todayInMonth = days.includes(today);
  const peakDay = days.reduce((best, d) => (expenseOf(d) > expenseOf(best) ? d : best), days[0]!);
  const defaultDay = todayInMonth ? today : peakDay;

  // Pilihan disimpan bersama bulannya → otomatis kembali ke default saat bulan diganti
  const [picked, setPicked] = useState<LocalDate | null>(null);
  const selected = picked && days.includes(picked) ? picked : defaultDay;
  const selectedIdx = days.indexOf(selected);
  const [announcement, setAnnouncement] = useState('');
  const barRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const describe = (d: LocalDate) => {
    const v = expenseOf(d);
    const name = formatLocalDate(d, 'EEEE, d MMMM');
    const suffix = d === today ? ' (hari ini)' : '';
    return `${name}${suffix}: ${v > 0 ? formatIDR(v) : 'tidak ada pengeluaran'}`;
  };

  /** Pindah pilihan. `focusBar` = dari keyboard di grafik; selain itu umumkan lewat live region. */
  const moveTo = (idx: number, focusBar: boolean) => {
    const day = days[Math.min(days.length - 1, Math.max(0, idx))]!;
    setPicked(day);
    if (focusBar) barRefs.current[days.indexOf(day)]?.focus();
    else setAnnouncement(describe(day));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? selectedIdx + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? selectedIdx - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? days.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    moveTo(next, true);
  };

  const selectedValue = expenseOf(selected);

  return (
    <div>
      <div
        className="flex h-32 items-end gap-[3px]"
        role="group"
        aria-label={`Pengeluaran harian ${formatLocalDate(month, 'MMMM yyyy')}`}
        onKeyDown={onKeyDown}
      >
        {days.map((d, i) => {
          const v = expenseOf(d);
          const isSelected = d === selected;
          return (
            <button
              key={d}
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              type="button"
              tabIndex={isSelected ? 0 : -1}
              aria-label={describe(d)}
              aria-pressed={isSelected}
              aria-current={d === today ? 'date' : undefined}
              onClick={() => setPicked(d)}
              className="group flex h-full flex-1 items-end rounded-t-md outline-offset-1"
            >
              <span
                className={cn(
                  'w-full rounded-t-md transition group-hover:brightness-125',
                  d > today
                    ? 'bg-surface'
                    : v > 0
                      ? 'bg-linear-to-t from-rose-500 to-orange-400'
                      : 'bg-surface',
                  d === today && 'ring-2 ring-primary/60',
                  isSelected && 'ring-2 ring-fg/70',
                )}
                style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div
        className="mt-1.5 flex justify-between text-[10px] font-semibold text-muted"
        aria-hidden="true"
      >
        <span>1</span>
        <span>{Math.ceil(days.length / 2)}</span>
        <span>{days.length}</span>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Hari sebelumnya"
          // aria-disabled (bukan disabled) agar fokus keyboard tidak hilang di ujung bulan
          aria-disabled={selectedIdx <= 0}
          className="aria-disabled:cursor-default aria-disabled:opacity-40"
          onClick={() => {
            if (!(selectedIdx <= 0)) moveTo(selectedIdx - 1, false);
          }}
        >
          <ChevronLeft />
        </Button>
        <p className="min-w-0 flex-1 text-center leading-tight">
          <span className="block truncate text-xs font-semibold text-muted">
            {formatLocalDate(selected, 'EEEE, d MMM')}
            {selected === today && ' · hari ini'}
          </span>
          <span className="block text-sm font-bold tabular-nums">
            {selectedValue > 0 ? formatIDR(selectedValue) : 'Tidak ada pengeluaran'}
          </span>
        </p>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Hari berikutnya"
          // aria-disabled (bukan disabled) agar fokus keyboard tidak hilang di ujung bulan
          aria-disabled={selectedIdx >= days.length - 1}
          className="aria-disabled:cursor-default aria-disabled:opacity-40"
          onClick={() => {
            if (!(selectedIdx >= days.length - 1)) moveTo(selectedIdx + 1, false);
          }}
        >
          <ChevronRight />
        </Button>
        {onSelect && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onSelect(selected)}
            aria-label={`Lihat ${formatLocalDate(selected, 'd MMMM')} di kalender`}
          >
            <CalendarDays /> <span className="hidden sm:inline">Kalender</span>
          </Button>
        )}
      </div>
      {/* Diumumkan hanya saat pindah lewat tombol ‹ › (fokus tidak berada di batang) */}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
