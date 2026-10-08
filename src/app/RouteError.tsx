import { TriangleAlert } from 'lucide-react';
import { Disclosure } from '@/components/ui/Disclosure';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { SplashScreen } from '@/components/layout/SplashScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Pengganti layar error bawaan React Router (berbahasa Inggris).
 * `fatal`: AppShell sendiri gagal → layar penuh. Selain itu tampil di dalam kerangka aplikasi,
 * jadi navigasi tetap bisa dipakai untuk pindah halaman.
 */
export function RouteError({ fatal = false }: { fatal?: boolean }) {
  const error = useRouteError();
  console.error('[router] error rute', error);

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null;
  const reload = () => window.location.reload();

  if (fatal) {
    return (
      <div role="alert">
        <SplashScreen
          title="Terjadi kesalahan"
          message="Halaman tidak dapat ditampilkan. Data yang sudah tersimpan di perangkat aman."
          action={{ label: 'Muat ulang', onClick: reload }}
        />
      </div>
    );
  }

  return (
    <Card role="alert">
      <EmptyState
        as="h1"
        icon={TriangleAlert}
        title="Halaman ini bermasalah"
        description="Terjadi kesalahan saat menampilkan halaman. Data yang sudah tersimpan di perangkat aman."
      >
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={reload}>Muat ulang</Button>
          <Link to="/" className="font-semibold text-primary hover:underline">
            Kembali ke Beranda
          </Link>
        </div>
        {detail && (
          <Disclosure className="mt-4 text-xs text-muted" summary="Detail teknis">
            <code className="mt-1 block break-words">{detail}</code>
          </Disclosure>
        )}
      </EmptyState>
    </Card>
  );
}
