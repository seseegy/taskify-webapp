import { ModulePlaceholder } from '@/features/placeholder/ModulePlaceholder';

export function JournalPage() {
  return (
    <ModulePlaceholder
      path="/jurnal"
      subtitle="Catat hari & perasaanmu"
      phase={4}
      emptyTitle="Belum ada catatan"
      emptyDescription="Tulis jurnal harian dengan markdown, lengkap dengan pelacak mood."
      planned={[
        'Editor markdown dengan pratinjau',
        'Mood harian (1–5) & grafik tren mood',
        '"Hari ini di masa lalu": catatan dari bulan/tahun sebelumnya',
        'Sematkan catatan penting, lampiran gambar (R2)',
        'Mention tugas & snippet (@tugas, #tag)',
      ]}
    />
  );
}
