import { create } from 'zustand';

/** Tugas yang sedang dibuka di panel detail (global: dipakai Tugas, Kalender, Beranda). */
interface TaskSheetState {
  taskId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useTaskSheet = create<TaskSheetState>((set) => ({
  taskId: null,
  open: (taskId) => set({ taskId }),
  close: () => set({ taskId: null }),
}));
