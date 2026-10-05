import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Gabungkan className Tailwind tanpa konflik (`cn('p-2', cond && 'p-4')` → 'p-4'). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** SQLite menyimpan boolean sebagai 0/1. */
export const toBool = (value: number | null | undefined) => value === 1;
export const fromBool = (value: boolean) => (value ? 1 : 0);
