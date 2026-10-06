import { Annoyed, Frown, Laugh, Meh, Smile, type LucideIcon } from 'lucide-react';

/**
 * Skala mood 1–5 (kolom journal_entries.mood).
 * UI memakai ikon (tampil sama di semua perangkat); emoji hanya untuk ekspor teks.
 */
export const MOODS: {
  value: number;
  icon: LucideIcon;
  emoji: string;
  label: string;
  color: string;
  className: string;
  text: string;
}[] = [
  {
    value: 1,
    icon: Frown,
    emoji: '😞',
    label: 'Sangat buruk',
    color: '#f43f5e',
    className: 'from-rose-500 to-red-600',
    text: 'text-rose-500',
  },
  {
    value: 2,
    icon: Annoyed,
    emoji: '🙁',
    label: 'Buruk',
    color: '#f97316',
    className: 'from-orange-500 to-rose-500',
    text: 'text-orange-500',
  },
  {
    value: 3,
    icon: Meh,
    emoji: '😐',
    label: 'Biasa',
    color: '#eab308',
    className: 'from-amber-400 to-yellow-500',
    text: 'text-amber-500',
  },
  {
    value: 4,
    icon: Smile,
    emoji: '🙂',
    label: 'Baik',
    color: '#22c55e',
    className: 'from-lime-500 to-emerald-500',
    text: 'text-emerald-500',
  },
  {
    value: 5,
    icon: Laugh,
    emoji: '😄',
    label: 'Sangat baik',
    color: '#10b981',
    className: 'from-emerald-500 to-teal-500',
    text: 'text-teal-500',
  },
];

export const moodOf = (value: number | null | undefined) =>
  value ? MOODS.find((m) => m.value === Math.round(value)) : undefined;
