import {
  AlertCircle,
  BadgeCheck,
  Check,
  Clapperboard,
  Download,
  Heart,
  Images,
  Music2,
  Play,
  RotateCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { tiktokClient } from './api-client';
import { PhotoCarousel } from './PhotoCarousel';
import type { TikTokPost } from './types';
import { useTikTokPost, type ProgressMap } from './useTikTokPost';

const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

const duration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function progressLabel(value: number | null | undefined, idle: string) {
  if (value === undefined) return idle;
  return value === null ? 'Mengunduh…' : `Mengunduh ${Math.round(value * 100)}%`;
}

/**
 * Kartu "Dari TikTok": pratinjau + tombol unduh. `input` = link atau teks bagikan apa adanya.
 * Dipakai di /bagikan (otomatis bila teks berisi link TikTok) dan di panel "Unduh TikTok".
 */
export function TikTokCard({ input, className }: { input: string; className?: string }) {
  const { state, progress, done, bulk, retry, download, downloadAllPhotos, loadPhoto } =
    useTikTokPost(input);

  return (
    <Card className={cn('animate-fade-up', className)}>
      <div className="mb-4 flex items-center gap-3">
        <span className="shine flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-tiktok text-white">
          <Clapperboard className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Dari TikTok</span>
          <span className="block text-xs text-muted">
            {state.status === 'ready' ? kindLabel(state.post) : 'Video & foto tanpa watermark'}
          </span>
        </span>
      </div>

      {state.status === 'loading' && <LoadingBody />}
      {state.status === 'error' && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="flex gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {state.message}
          </p>
          <Button variant="secondary" size="sm" onClick={retry}>
            <RotateCw /> Coba lagi
          </Button>
        </div>
      )}
      {state.status === 'ready' && (
        <ReadyBody
          post={state.post}
          progress={progress}
          done={done}
          bulk={bulk}
          loadPhoto={loadPhoto}
          onDownload={download}
          onDownloadAllPhotos={downloadAllPhotos}
        />
      )}
    </Card>
  );
}

function kindLabel(post: TikTokPost) {
  if (post.type === 'photo') return `Foto · ${post.photo_count} gambar`;
  return post.video ? `Video · ${duration(post.video.duration_seconds)}` : 'Video';
}

function LoadingBody() {
  return (
    <div role="status" aria-label="Mengambil info dari TikTok…" className="flex gap-4">
      <div className="aspect-[3/4] w-24 shrink-0 animate-pulse rounded-2xl glass sm:w-28" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-4 w-2/5 animate-pulse rounded-full glass" />
        <div className="h-3 w-full animate-pulse rounded-full glass" />
        <div className="h-3 w-4/5 animate-pulse rounded-full glass" />
        <p className="pt-2 text-xs text-muted">Mengambil info dari TikTok…</p>
      </div>
    </div>
  );
}

function ReadyBody({
  post,
  progress,
  done,
  bulk,
  loadPhoto,
  onDownload,
  onDownloadAllPhotos,
}: {
  post: TikTokPost;
  progress: ProgressMap;
  done: Set<string>;
  bulk: { current: number; total: number } | null;
  loadPhoto: (index: number) => Promise<Blob>;
  onDownload: ReturnType<typeof useTikTokPost>['download'];
  onDownloadAllPhotos: () => Promise<void>;
}) {
  // Jeda antar-foto saat "Unduh semua" tetap dihitung sibuk (progress kosong sesaat)
  const busy = Object.keys(progress).length > 0 || bulk !== null;

  return (
    <>
      <div className="flex gap-4">
        {/* Postingan foto: pratinjaunya carousel di bawah, cover tidak perlu diulang */}
        {post.type === 'video' && (
          <Cover
            key={post.id}
            url={post.cover}
            alt={post.description || `Postingan @${post.author.unique_id}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold">
            <span className="truncate">{post.author.nickname || post.author.unique_id}</span>
            {post.author.verified && (
              <BadgeCheck aria-label="Terverifikasi" className="size-4 shrink-0 text-sky-500" />
            )}
          </p>
          <p className="truncate text-xs text-muted">@{post.author.unique_id}</p>
          {post.description && (
            <p className="mt-2 line-clamp-3 text-sm break-words">{post.description}</p>
          )}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {post.stats.plays > 0 && (
              <span className="inline-flex items-center gap-1">
                <Play className="size-3.5" aria-hidden /> {compact.format(post.stats.plays)}
                <span className="sr-only">ditonton</span>
              </span>
            )}
            {post.stats.likes > 0 && (
              <span className="inline-flex items-center gap-1">
                <Heart className="size-3.5" aria-hidden /> {compact.format(post.stats.likes)}
                <span className="sr-only">suka</span>
              </span>
            )}
          </p>
          {post.music?.title && (
            <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted">
              <Music2 className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {post.music.title}
                {post.music.author ? ` — ${post.music.author}` : ''}
              </span>
            </p>
          )}
        </div>
      </div>

      {post.type === 'photo' && post.downloads.photos.length > 0 && (
        <div className="mt-4">
          <PhotoCarousel
            count={post.downloads.photos.length}
            loadPhoto={loadPhoto}
            onDownload={(index) => void onDownload({ kind: 'photo', index })}
            progress={progress}
            done={done}
            busy={busy}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {post.type === 'video' && post.downloads.video && (
          <Button
            className="min-w-44 flex-1"
            loading={progress.video !== undefined}
            disabled={busy && progress.video === undefined}
            onClick={() => void onDownload({ kind: 'video' })}
          >
            {progress.video === undefined && (done.has('video') ? <Check /> : <Download />)}
            {progressLabel(progress.video, done.has('video') ? 'Unduh lagi' : 'Unduh video')}
          </Button>
        )}
        {post.type === 'photo' && post.downloads.photos.length > 0 && (
          <Button
            className="min-w-44 flex-1"
            loading={bulk !== null}
            disabled={busy && bulk === null}
            onClick={() => void onDownloadAllPhotos()}
          >
            {bulk === null && <Images />}
            {bulk
              ? `Mengunduh foto ${bulk.current}/${bulk.total}…`
              : `Unduh ${post.downloads.photos.length} foto`}
          </Button>
        )}
        {post.downloads.audio && (
          <Button
            variant="secondary"
            loading={progress.audio !== undefined}
            disabled={busy && progress.audio === undefined}
            onClick={() => void onDownload({ kind: 'audio' })}
          >
            {progress.audio === undefined && (done.has('audio') ? <Check /> : <Music2 />)}
            {progressLabel(progress.audio, 'Audio')}
          </Button>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {busy ? 'Sedang mengunduh' : ''}
      </p>
      <p className="mt-3 text-xs text-muted">
        Tersimpan ke folder Download. Hak cipta tetap milik kreatornya.
      </p>
    </>
  );
}

/**
 * Cover diambil lewat fetch → `blob:` (CSP img-src tidak mengizinkan domain Worker).
 * Diambil sekali per postingan: link cover berganti setiap ekstrak ulang (link unduhan
 * diperbarui), tetapi gambarnya sama — tidak perlu berkedip memuat ulang. Pemanggil memasang
 * `key={post.id}`, jadi postingan lain = komponen baru.
 */
function Cover({ url, alt }: { url: string | null; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [firstUrl] = useState(url);

  useEffect(() => {
    const url = firstUrl;
    if (!url || !tiktokClient) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    tiktokClient
      .image(url, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => undefined); // cover hanya hiasan
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSrc(null);
    };
  }, [firstUrl]);

  return (
    <div className="aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-2xl glass sm:w-28">
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted">
          <Clapperboard className="size-6" aria-hidden />
        </div>
      )}
    </div>
  );
}
