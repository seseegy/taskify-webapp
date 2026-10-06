import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'danger';
  action?: { label: string; onClick: () => void | Promise<void> };
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'tone'> & { tone?: Toast['tone']; duration?: number }) => void;
  dismiss: (id: number) => void;
  /** Tahan hitung mundur (kursor di atas toast / fokus keyboard di dalamnya). */
  pause: (id: number) => void;
  /** Lanjutkan hitung mundur; sisa waktu minimal RESUME_MIN_MS agar sempat dibaca. */
  resume: (id: number) => void;
}

/** Toast biasa. */
const DEFAULT_MS = 5000;
/** Toast dengan aksi (mis. "Urungkan") — sering jadi satu-satunya pengaman, beri waktu lebih. */
const ACTION_MS = 10_000;
const RESUME_MIN_MS = 2500;

interface Countdown {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}
const countdowns = new Map<number, Countdown>();

function start(id: number, ms: number) {
  const c = countdowns.get(id) ?? { handle: null, remaining: ms, startedAt: 0 };
  c.remaining = ms;
  c.startedAt = Date.now();
  c.handle = setTimeout(() => useToastStore.getState().dismiss(id), ms);
  countdowns.set(id, c);
}

function forget(id: number) {
  const c = countdowns.get(id);
  if (c?.handle) clearTimeout(c.handle);
  countdowns.delete(id);
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ duration, tone = 'default', ...toast }) => {
    const id = ++seq;
    const current = get().toasts;
    // Maks. 3 toast tampil sekaligus; yang terdorong keluar dibersihkan timernya
    current.slice(0, -2).forEach((t) => forget(t.id));
    set({ toasts: [...current.slice(-2), { ...toast, tone, id }] });
    start(id, duration ?? (toast.action ? ACTION_MS : DEFAULT_MS));
  },
  dismiss: (id) => {
    forget(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  pause: (id) => {
    const c = countdowns.get(id);
    if (!c?.handle) return;
    clearTimeout(c.handle);
    c.handle = null;
    c.remaining = Math.max(0, c.remaining - (Date.now() - c.startedAt));
  },
  resume: (id) => {
    const c = countdowns.get(id);
    if (!c || c.handle) return;
    start(id, Math.max(c.remaining, RESUME_MIN_MS));
  },
}));

/** Pemakaian: toast('Tugas selesai', { action: { label: 'Urungkan', onClick: undo } }) */
export function toast(
  message: string,
  options: Partial<Omit<Toast, 'id' | 'message'>> & { duration?: number } = {},
) {
  useToastStore.getState().push({ message, ...options });
}
