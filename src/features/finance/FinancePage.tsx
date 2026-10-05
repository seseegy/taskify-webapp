import { ModulePlaceholder } from '@/features/placeholder/ModulePlaceholder';

export function FinancePage() {
  return (
    <ModulePlaceholder
      path="/keuangan"
      subtitle="Pantau uang masuk & keluar"
      phase={3}
      emptyTitle="Belum ada transaksi"
      emptyDescription="Dompet Tunai & Bank serta kategori default sudah dibuat otomatis untuk akunmu."
      planned={[
        'Catat pemasukan, pengeluaran, dan transfer antar dompet',
        'Input cepat: "25rb", "1,5jt" langsung terbaca',
        'Anggaran bulanan per kategori + peringatan 80%',
        'Transaksi berulang (langganan, tagihan, gaji)',
        'Hutang/piutang, foto struk, laporan & ekspor CSV',
      ]}
    />
  );
}
