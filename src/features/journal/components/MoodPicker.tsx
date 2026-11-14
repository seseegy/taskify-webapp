import { createElement } from 'react';
import { cn } from '@/lib/utils';
import { MOODS } from '../mood';

export function MoodPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Mood">
      {MOODS.map((m) => {
        const active = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={m.label}
            title={m.label}
            onClick={() => onChange(active ? null : m.value)}
            className={cn(
              'flex h-11 items-center justify-center gap-1.5 rounded-2xl px-3 text-xs font-semibold transition active:scale-95',
              active
                ? cn('shine bg-linear-to-br text-white shadow-lg', m.className)
                : cn('glass hover:bg-surface-strong', m.text),
            )}
          >
            {createElement(m.icon, { className: 'size-5' })}
            <span className={cn(!active && 'hidden sm:inline', !active && 'text-muted')}>
              {m.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
