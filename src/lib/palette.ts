/**
 * Palet warna bernama (nama disimpan di DB: task_lists.color, categories.color, wallets.color).
 * Kelas Tailwind ditulis statis agar ikut ter-generate; `hex` untuk grafik (conic-gradient/SVG).
 */
export const PALETTE = {
  violet: {
    dot: 'bg-violet-500',
    soft: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    grad: 'from-violet-500 to-indigo-500',
    hex: '#8b5cf6',
  },
  indigo: {
    dot: 'bg-indigo-500',
    soft: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
    grad: 'from-indigo-500 to-blue-500',
    hex: '#6366f1',
  },
  sky: {
    dot: 'bg-sky-500',
    soft: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    grad: 'from-sky-500 to-cyan-500',
    hex: '#0ea5e9',
  },
  teal: {
    dot: 'bg-teal-500',
    soft: 'bg-teal-500/15 text-teal-600 dark:text-teal-300',
    grad: 'from-teal-500 to-emerald-500',
    hex: '#14b8a6',
  },
  emerald: {
    dot: 'bg-emerald-500',
    soft: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    grad: 'from-emerald-500 to-teal-500',
    hex: '#10b981',
  },
  amber: {
    dot: 'bg-amber-500',
    soft: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    grad: 'from-amber-500 to-orange-500',
    hex: '#f59e0b',
  },
  orange: {
    dot: 'bg-orange-500',
    soft: 'bg-orange-500/15 text-orange-600 dark:text-orange-300',
    grad: 'from-orange-500 to-rose-500',
    hex: '#f97316',
  },
  red: {
    dot: 'bg-red-500',
    soft: 'bg-red-500/15 text-red-600 dark:text-red-300',
    grad: 'from-red-500 to-rose-600',
    hex: '#ef4444',
  },
  rose: {
    dot: 'bg-rose-500',
    soft: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    grad: 'from-rose-500 to-pink-500',
    hex: '#f43f5e',
  },
  pink: {
    dot: 'bg-pink-500',
    soft: 'bg-pink-500/15 text-pink-600 dark:text-pink-300',
    grad: 'from-pink-500 to-fuchsia-500',
    hex: '#ec4899',
  },
  fuchsia: {
    dot: 'bg-fuchsia-500',
    soft: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300',
    grad: 'from-fuchsia-500 to-purple-500',
    hex: '#d946ef',
  },
  slate: {
    dot: 'bg-slate-500',
    soft: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    grad: 'from-slate-500 to-slate-600',
    hex: '#64748b',
  },
} as const;

export type PaletteColor = keyof typeof PALETTE;

/** Nama warna dalam Bahasa Indonesia (untuk pembaca layar; nama di DB tetap kunci Inggris). */
export const PALETTE_LABELS: Record<PaletteColor, string> = {
  violet: 'Ungu',
  indigo: 'Nila',
  sky: 'Biru langit',
  teal: 'Hijau toska',
  emerald: 'Hijau zamrud',
  amber: 'Kuning amber',
  orange: 'Jingga',
  red: 'Merah',
  rose: 'Mawar',
  pink: 'Merah muda',
  fuchsia: 'Fuchsia',
  slate: 'Abu-abu',
};

export const colorLabel = (name: string) => PALETTE_LABELS[name as PaletteColor] ?? name;
export const PALETTE_NAMES = Object.keys(PALETTE) as PaletteColor[];

export const paletteOf = (name: string | null | undefined, fallback: PaletteColor = 'violet') =>
  PALETTE[name && name in PALETTE ? (name as PaletteColor) : fallback];
