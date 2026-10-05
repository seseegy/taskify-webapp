import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="Halaman tidak ditemukan"
        description="Alamat yang kamu buka tidak ada di Taskify."
      >
        <Link to="/" className="font-semibold text-primary hover:underline">
          Kembali ke Beranda
        </Link>
      </EmptyState>
    </Card>
  );
}
