import { ModulePlaceholder } from '@/features/placeholder/ModulePlaceholder';

export function VaultPage() {
  return (
    <ModulePlaceholder
      path="/vault"
      subtitle="Snippet kode & arsip project"
      phase={6}
      emptyTitle="Vault masih kosong"
      emptyDescription="Simpan snippet kode dan arsip zip project (maks. 100 MB) di Cloudflare R2."
      planned={[
        'Snippet dengan syntax highlight, tag bahasa, salin 1 klik',
        'Upload zip project ke R2 via presigned URL (key R2 tidak pernah ada di browser)',
        'Lihat isi zip & pratinjau file tanpa ekstrak',
        'Versi per project (v1, v2, …) + deteksi duplikat SHA-256',
        'Peringatan otomatis jika zip berisi node_modules, .git, atau .env',
      ]}
    />
  );
}
