import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { addMonthsLocal, formatLocalDate, monthStart, type LocalDate } from '@/lib/date';
import { PALETTE, PALETTE_NAMES, paletteOf } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { FINANCE_ICONS, ICON_NAMES } from '../finance-icons';
import { useToday } from '@/lib/useToday';

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Warna">
      {PALETTE_NAMES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-label={c}
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={cn(
            'flex size-8 items-center justify-center rounded-full text-white transition',
            PALETTE[c].dot,
            value === c ? 'scale-110 ring-4 ring-primary/30' : 'opacity-80 hover:opacity-100',
          )}
        >
          {value === c && <Check className="size-4" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function IconPicker({
  value,
  color,
  onChange,
}: {
  value: string;
  color: string;
  onChange: (i: string) => void;
}) {
  const p = paletteOf(color);
  return (
    <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Ikon">
      {ICON_NAMES.map((name) => {
        const Icon = FINANCE_ICONS[name]!;
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-label={name}
            aria-checked={active}
            onClick={() => onChange(name)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-xl transition',
              active
                ? cn('shine bg-linear-to-br text-white shadow-md', p.grad)
                : 'text-muted hover:bg-surface hover:text-fg',
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

/** Navigasi bulan: ‹ Oktober 2026 › */
export function MonthSwitcher({
  month,
  onChange,
}: {
  month: LocalDate;
  onChange: (m: LocalDate) => void;
}) {
  const current = monthStart(useToday());
  return (
    <div className="flex items-center gap-1 rounded-xl p-1 glass">
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Bulan sebelumnya"
        onClick={() => onChange(addMonthsLocal(month, -1))}
      >
        <ChevronLeft />
      </Button>
      <button
        type="button"
        onClick={() => onChange(current)}
        title="Bulan ini"
        className="min-w-32 px-2 text-center text-sm font-semibold capitalize"
      >
        {formatLocalDate(month, 'MMMM yyyy')}
      </button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Bulan berikutnya"
        onClick={() => onChange(addMonthsLocal(month, 1))}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
