import { ModulePlaceholder } from '@/features/placeholder/ModulePlaceholder';

export function TasksPage() {
  return (
    <ModulePlaceholder
      path="/tugas"
      subtitle="Rencanakan & selesaikan"
      phase={2}
      emptyTitle="Belum ada tugas"
      emptyDescription="Fitur Tugas dibangun di tahap berikutnya, lengkap dengan integrasi kalender."
      planned={[
        'Daftar (list) dengan warna & ikon, tampilan Hari ini / Mendatang / Selesai',
        'Prioritas, subtask, catatan markdown',
        'Tugas berulang (RRULE): harian, mingguan, tanggal tertentu tiap bulan',
        'Pengingat lewat Web Push',
        'Tampilan Kanban opsional & drag-and-drop urutan',
      ]}
    />
  );
}
