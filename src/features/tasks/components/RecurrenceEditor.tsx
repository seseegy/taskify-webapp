import { Repeat } from 'lucide-react';
import { Select } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import type { LocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import {
  buildRule,
  describeRule,
  parseRule,
  weekdayOf,
  WEEKDAY_SHORT,
  type RecurrenceFreq,
  type RecurrenceState,
} from '../recurrence';

interface Props {
  rule: string | null;
  /** due_date tugas; pengulangan butuh tanggal mulai */
  anchor: LocalDate;
  onChange: (rule: string | null) => void;
  /** id untuk kontrol pertama (pilihan pola) — dipakai form induk untuk fokus & pesan error */
  id?: string;
  'aria-describedby'?: string;
}

const FREQ_OPTIONS: { value: RecurrenceFreq; label: string; unit?: string }[] = [
  { value: 'none', label: 'Tidak berulang' },
  { value: 'daily', label: 'Harian', unit: 'hari' },
  { value: 'weekdays', label: 'Hari kerja (Sen–Jum)' },
  { value: 'weekly', label: 'Mingguan', unit: 'minggu' },
  { value: 'monthly', label: 'Bulanan', unit: 'bulan' },
  { value: 'yearly', label: 'Tahunan', unit: 'tahun' },
];

export function RecurrenceEditor({
  rule,
  anchor,
  onChange,
  id,
  'aria-describedby': describedBy,
}: Props) {
  const state = parseRule(rule);
  const unit = FREQ_OPTIONS.find((o) => o.value === state.freq)?.unit;

  const apply = (patch: Partial<RecurrenceState>) => {
    const next = { ...state, ...patch };
    if (next.freq === 'weekly' && next.byDay.length === 0) next.byDay = [weekdayOf(anchor)];
    onChange(buildRule(next, anchor));
  };

  const toggleDay = (day: number) => {
    const has = state.byDay.includes(day);
    const byDay = has ? state.byDay.filter((d) => d !== day) : [...state.byDay, day];
    if (byDay.length > 0) apply({ byDay });
  };

  return (
    <div className="space-y-3">
      <Select
        id={id}
        aria-label="Pengulangan"
        aria-describedby={describedBy}
        value={state.freq}
        onChange={(e) => apply({ freq: e.target.value as RecurrenceFreq, interval: 1, byDay: [] })}
      >
        {FREQ_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      {state.freq !== 'none' && (
        <>
          {unit && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">Setiap</span>
              <Input
                type="number"
                min={1}
                max={99}
                value={state.interval}
                onChange={(e) => apply({ interval: Number(e.target.value) || 1 })}
                className="h-9 w-20 text-center"
              />
              <span className="text-muted">{unit}</span>
            </label>
          )}

          {state.freq === 'weekly' && (
            <div className="flex gap-1.5" role="group" aria-label="Hari">
              {WEEKDAY_SHORT.map((label, day) => {
                const active = state.byDay.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'flex h-9 flex-1 items-center justify-center rounded-lg text-xs font-bold transition',
                      active
                        ? 'shine bg-gradient-tasks text-white shadow-md'
                        : 'text-muted glass hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Berakhir</span>
            <Select
              aria-label="Berakhir"
              value={state.until ? 'until' : 'never'}
              onChange={(e) => apply({ until: e.target.value === 'until' ? anchor : null })}
              className="h-9 w-40"
            >
              <option value="never">Tidak pernah</option>
              <option value="until">Pada tanggal</option>
            </Select>
            {state.until && (
              <Input
                type="date"
                value={state.until}
                min={anchor}
                onChange={(e) => e.target.value && apply({ until: e.target.value })}
                className="h-9 w-auto"
              />
            )}
          </div>

          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Repeat className="size-3.5" /> {describeRule(rule, anchor)}
          </p>
        </>
      )}
    </div>
  );
}
