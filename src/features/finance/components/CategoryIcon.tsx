import { ArrowLeftRight, HandCoins } from 'lucide-react';
import { createElement } from 'react';
import { paletteOf } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { iconOf } from '../finance-icons';

interface Props {
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  /** Ikon khusus: transfer / hutang */
  special?: 'transfer' | 'debt';
  className?: string;
}

const SIZE = {
  sm: 'size-8 rounded-lg [&_svg]:size-4',
  md: 'size-10 rounded-xl [&_svg]:size-5',
  lg: 'size-12 rounded-2xl [&_svg]:size-6',
};

/** Lingkaran ikon kategori bergradasi sesuai warna kategori. */
export function CategoryIcon({ icon, color, size = 'md', special, className }: Props) {
  const Icon =
    special === 'transfer' ? ArrowLeftRight : special === 'debt' ? HandCoins : iconOf(icon);
  const p = paletteOf(
    special === 'transfer' ? 'indigo' : special === 'debt' ? 'amber' : color,
    'slate',
  );
  return (
    <span
      className={cn(
        'shine flex shrink-0 items-center justify-center bg-linear-to-br text-white shadow-md',
        p.grad,
        SIZE[size],
        className,
      )}
    >
      {createElement(Icon)}
    </span>
  );
}
