import { createElement } from 'react';
import { cn } from '@/lib/utils';
import { moodOf } from '../mood';

/** Ikon mood berwarna. `badge` = lingkaran bergradasi; tanpa badge = ikon berwarna saja. */
export function MoodIcon({
  mood,
  badge,
  className,
}: {
  mood: number | null | undefined;
  badge?: boolean;
  className?: string;
}) {
  const m = moodOf(mood);
  if (!m) return null;
  const icon = createElement(m.icon, {
    className: badge ? 'size-[60%]' : 'size-full',
    'aria-hidden': true,
  });
  return (
    <span
      title={m.label}
      aria-label={`Mood: ${m.label}`}
      role="img"
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        badge ? cn('shine rounded-full bg-linear-to-br text-white shadow-sm', m.className) : m.text,
        className ?? 'size-4',
      )}
    >
      {icon}
    </span>
  );
}
