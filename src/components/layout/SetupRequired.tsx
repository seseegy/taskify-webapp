import { TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { missingEnv } from '@/lib/env';
import { Logo } from './Logo';

/** Ditampilkan jika .env.local belum diisi — lebih jelas daripada error koneksi acak. */
export function SetupRequired() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="max-w-lg animate-fade-up">
        <Logo withText className="mb-6" />
        <h1 className="mb-3 flex items-center gap-2 font-bold text-warning">
          <TriangleAlert className="size-5" aria-hidden="true" />
          Konfigurasi belum lengkap
        </h1>
        <p className="mb-4 text-sm text-muted">
          Salin <code className="font-mono">.env.example</code> menjadi{' '}
          <code className="font-mono">.env.local</code>, isi variabel berikut, lalu jalankan ulang{' '}
          <code className="font-mono">pnpm dev</code>:
        </p>
        <ul className="mb-4 space-y-1.5">
          {missingEnv.map((key) => (
            <li key={key} className="rounded-lg px-3 py-2 font-mono text-sm glass">
              {key}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Panduan lengkap ada di <code className="font-mono">docs/SETUP.md</code>.
        </p>
      </Card>
    </div>
  );
}
