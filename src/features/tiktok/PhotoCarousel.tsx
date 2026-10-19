import { Check, Download, ImageOff, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { ProgressMap } from './useTikTokPost';

interface Props {
  count: number;
  loadPhoto: (index: number) => Promise<Blob>;
  onDownload: (index: number) => void;
  progress: ProgressMap;
  done: Set<string>;
  /** Unduhan lain sedang berjalan */
  busy: boolean;
}

/**
 * Pratinjau setiap foto slideshow. HP: digeser ke samping (snap per foto, seperti TikTok);
 * layar lebar: grid. Gambar dimuat saat foto mendekati area terlihat, dan hasilnya disimpan di
 * cache hook (`loadPhoto`) sehingga tombol unduh tidak mengunduh ulang.
 */
export function PhotoCarousel({ count, loadPhoto, onDownload, progress, done, busy }: Props) {
  const scroller = useRef<HTMLUListElement>(null);
  return (
    <ul
      ref={scroller}
      aria-label={`${count} foto dalam postingan`}
      className="-mx-5 flex snap-x snap-mandatory scroll-px-5 [scrollbar-width:thin] gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0"
    >
      {Array.from({ length: count }, (_, index) => {
        const key = `photo:${index}`;
        return (
          <PhotoTile
            key={key}
            index={index}
            count={count}
            root={scroller}
            loadPhoto={loadPhoto}
            saving={progress[key] !== undefined}
            saved={done.has(key)}
            disabled={busy && progress[key] === undefined}
            onDownload={() => onDownload(index)}
          />
        );
      })}
    </ul>
  );
}

function PhotoTile({
  index,
  count,
  root,
  loadPhoto,
  saving,
  saved,
  disabled,
  onDownload,
}: {
  index: number;
  count: number;
  root: RefObject<HTMLUListElement | null>;
  loadPhoto: (index: number) => Promise<Blob>;
  saving: boolean;
  saved: boolean;
  disabled: boolean;
  onDownload: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // Tanpa IntersectionObserver (browser lama): langsung dimuat
  const [visible, setVisible] = useState(() => typeof IntersectionObserver !== 'function');
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Mulai memuat saat foto mendekati area terlihat (satu layar ke kiri/kanan)
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { root: root.current, rootMargin: '0px 100% 0px 100%' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, visible]);

  useEffect(() => {
    if (!visible) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    loadPhoto(index)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, index, loadPhoto]);

  return (
    <li
      ref={ref}
      className="relative aspect-[3/4] w-[42%] shrink-0 snap-start overflow-hidden rounded-2xl glass sm:w-auto"
    >
      {src ? (
        <img
          src={src}
          alt={`Foto ${index + 1} dari ${count}`}
          className="size-full object-cover"
          draggable={false}
        />
      ) : failed ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted">
          <ImageOff className="size-5" aria-hidden />
          Pratinjau gagal
        </div>
      ) : (
        <div className="size-full animate-pulse" aria-hidden />
      )}

      {/* Overlay di atas gambar: warna tetap (bukan token tema), lihat docs/DESIGN.md */}
      <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">
        {index + 1}/{count}
      </span>
      <button
        type="button"
        onClick={onDownload}
        disabled={disabled || saving}
        aria-label={saved ? `Unduh lagi foto ${index + 1}` : `Unduh foto ${index + 1}`}
        className={cn(
          'absolute right-2 bottom-2 flex size-10 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95 disabled:opacity-60',
          saved ? 'bg-emerald-600' : 'bg-black/60 hover:bg-black/75',
        )}
      >
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : saved ? (
          <Check className="size-4" />
        ) : (
          <Download className="size-4" />
        )}
      </button>
    </li>
  );
}
