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
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ duration = 5000, tone = 'default', ...toast }) => {
    const id = ++seq;
    // Maks. 3 toast tampil sekaligus
    set({ toasts: [...get().toasts.slice(-2), { ...toast, tone, id }] });
    setTimeout(() => get().dismiss(id), duration);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Pemakaian: toast('Tugas selesai', { action: { label: 'Urungkan', onClick: undo } }) */
export function toast(
  message: string,
  options: Partial<Omit<Toast, 'id' | 'message'>> & { duration?: number } = {},
) {
  useToastStore.getState().push({ message, ...options });
}
