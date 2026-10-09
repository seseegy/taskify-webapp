import { Music, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from './music-view';
import { thumbUrl } from './search-core';
import type { Song } from './types';

/**
 * Satu baris lagu, dipakai di tab Cari lagu dan tab Antrean.
 *
 * Lagu yang sedang diputar ditandai **tiga** cara sekaligus: ikon `▶`, latar kaca, dan
 * `aria-current`. Warna saja tidak cukup — dan di sini bahkan warna pun tidak dipakai
 * sebagai penanda, karena latar kaca sudah membedakannya tanpa bergantung pada persepsi
 * warna.
 */
export function SongRow({
  song,
  current,
  index,
  onPlay,
}: {
  song: Song;
  current: boolean;
  /** Nomor urut yang ditampilkan, berbasis 1. Dilewatkan untuk antrean saja. */
  index?: number;
  onPlay: () => void;
}) {
  const thumb = thumbUrl(song);
  const duration = formatDuration(song.duration);
  return (
    <li>
      <button
        type="button"
        onClick={onPlay}
        // `aria-current` menyatakan "ini yang sedang diputar" tanpa mengubah peran tombolnya.
        aria-current={current ? 'true' : undefined}
        className={cn(
          // min-h-14 memberi target sentuh jauh di atas 44px untuk baris yang dipenuhi teks.
          'flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition',
          current ? 'glass' : 'hover:bg-surface',
        )}
      >
        {index !== undefined && (
          <span className="w-5 shrink-0 text-right text-xs text-muted tabular-nums">
            {current ? (
              <Play className="ml-auto size-3.5 text-primary" aria-hidden="true" />
            ) : (
              index
            )}
          </span>
        )}
        <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-surface">
          {thumb ? (
            /*
              `alt=""`: judul lagu ada tepat di sebelahnya, jadi gambarnya hiasan — alt yang
              mengulang judul hanya membuat pembaca layar menyebutnya dua kali.
              `no-referrer` supaya URL aplikasi tidak ikut terkirim ke host gambar YouTube.
              Host-nya harus ada di `img-src` (lihat public/_headers).
            */
            <img
              src={thumb}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Music className="absolute inset-0 m-auto size-4 text-muted" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{song.title}</span>
          <span className="block truncate text-xs text-muted">
            {song.artist}
            {current && ' · sedang diputar'}
          </span>
        </span>
        {duration && <span className="shrink-0 text-xs text-muted tabular-nums">{duration}</span>}
      </button>
    </li>
  );
}
