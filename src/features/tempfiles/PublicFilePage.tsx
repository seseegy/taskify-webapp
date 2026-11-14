import { Clock, Download, FileQuestion, HardDrive, Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { formatBytes } from '@/lib/bytes';
import { env } from '@/lib/env';
import { fetchPublicInfo, type PublicFileInfo } from './tempfile-api';
import { FileGlyph } from './FileGlyph';
import { directDownloadUrl, expiryLabel, isExecutableName } from './tempfile-utils';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; info: PublicFileInfo; checkedAt: number };

/**
 * Halaman unduh untuk penerima tautan Berkas publik (`/unduh/<token>`). Dibuka TANPA login.
 *
 * Halaman perantara (bukan langsung mengunduh) supaya penerima melihat nama & ukuran dulu, dan
 * supaya pratinjau tautan aplikasi chat (yang hanya mengambil HTML ini) tidak terhitung sebagai
 * unduhan. Unduhan sebenarnya = tautan biasa ke Edge Function, yang mengalihkan ke R2 dengan
 * `Content-Disposition: attachment`.
 */
export function PublicFilePage({ token }: { token: string | null }) {
  // Token rusak/terpotong: langsung "tidak tersedia", tanpa bertanya ke server
  const [state, setState] = useState<State>(token ? { kind: 'loading' } : { kind: 'missing' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = 'Unduh berkas · Taskify';
    if (!token) return;
    const ctrl = new AbortController();
    fetchPublicInfo(token, ctrl.signal)
      .then((info) =>
        setState(info ? { kind: 'ready', info, checkedAt: Date.now() } : { kind: 'missing' }),
      )
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState({ kind: 'error' });
      });
    return () => ctrl.abort();
  }, [token, attempt]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-5">
      <Logo size="lg" />
      <section
        aria-live="polite"
        className="w-full max-w-md animate-fade-up rounded-card p-6 text-center glass-strong sm:p-8"
      >
        {state.kind === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Memeriksa tautan…
          </p>
        )}

        {state.kind === 'missing' && (
          <div className="py-4">
            <span className="shine mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl bg-gradient-settings text-white shadow-lg">
              <FileQuestion className="size-8" aria-hidden="true" />
            </span>
            <h1 className="text-lg font-semibold">Berkas tidak tersedia</h1>
            <p className="mt-1.5 text-sm text-muted">
              Tautan ini sudah kedaluwarsa, dicabut, berkasnya dihapus pemiliknya, atau tautannya
              tidak lengkap saat disalin.
            </p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="py-4">
            <h1 className="text-lg font-semibold">Tidak bisa memeriksa tautan</h1>
            <p className="mt-1.5 text-sm text-muted">Periksa koneksi internet lalu coba lagi.</p>
            <Button className="mt-4" variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
              Coba lagi
            </Button>
          </div>
        )}

        {state.kind === 'ready' && token && (
          <ReadyBody info={state.info} checkedAt={state.checkedAt} token={token} />
        )}
      </section>
      <p className="max-w-md text-center text-xs text-muted">
        Dibagikan lewat Taskify. Buka berkas hanya bila kamu mempercayai pengirimnya.
      </p>
    </main>
  );
}

function ReadyBody({
  info,
  checkedAt,
  token,
}: {
  info: PublicFileInfo;
  checkedAt: number;
  token: string;
}) {
  return (
    <div>
      <FileGlyph mime={info.mime_type} name={info.file_name} size="lg" className="mx-auto mb-4" />
      <h1 className="text-lg font-semibold break-words">{info.file_name}</h1>
      <dl className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Ukuran</dt>
          <HardDrive className="size-4" aria-hidden="true" />
          <dd>{formatBytes(info.size_bytes)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Masa berlaku</dt>
          <Clock className="size-4" aria-hidden="true" />
          <dd>{expiryLabel(info.expires_at, checkedAt)}</dd>
        </div>
      </dl>
      <a
        href={directDownloadUrl(env.supabaseUrl, token)}
        rel="noreferrer noopener"
        className="shine mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-6 text-base font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110"
      >
        <Download className="size-5" aria-hidden="true" /> Unduh
      </a>
      {isExecutableName(info.file_name) && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/12 p-3 text-left text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Ini berkas program yang bisa dijalankan. Jangan buka bila kamu tidak yakin isinya.
        </p>
      )}
    </div>
  );
}
