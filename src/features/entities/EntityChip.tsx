import { createElement } from 'react';
import { cn } from '@/lib/utils';
import { ENTITY_META, type EntityRow } from './entities';

/** Ikon bergradasi jenis entitas. */
export function EntityIcon({ type, size = 'md' }: { type: EntityRow['type']; size?: 'sm' | 'md' }) {
  const meta = ENTITY_META[type];
  return (
    <span
      className={cn(
        'shine flex shrink-0 items-center justify-center text-white shadow-sm',
        meta.gradient,
        size === 'sm' ? 'size-7 rounded-lg' : 'size-9 rounded-xl',
      )}
    >
      {createElement(meta.icon, { className: size === 'sm' ? 'size-3.5' : 'size-4' })}
    </span>
  );
}
