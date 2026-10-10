import {
  FileText,
  Infinity as InfinityIcon,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { ModeButton } from './ModeButton';
import { openMusicSheet } from './music-store';
import { barStatus } from './music-view';
import { PositionProgress, PrepareProgress } from './MusicProgress';
import { coverUrl } from './search-core';
import type { MusicPlayerApi } from './useMusicPlayer';

/**
 * Layar "Sedang diputar" — gambar album besar, judul, dan kontrol penuh.
 *
 * Dibuka dari bilah mini atau dari baris lagu yang sedang diputar. Panel terpisah, bukan tab
 * keempat: tiga label tab sudah hampir tidak muat di 320px (~246px dari 272px yang ada), jadi
 * label keempat pasti terbungkus dua baris. Dan `MusicPanel` memastikan ia tidak pernah
 * terbuka bersamaan dengan `Sheet` tiga tab.
 *
 * **Satu hal yang sengaja tidak ada: bilah geser posisi lagu.** Itu biasanya pusat layar
 * seperti ini, tapi CDN konverter tidak melayani `Range` — audionya memang tidak bisa
 * dipindah posisinya. Yang ada garis tipis tanpa handle; lihat `MusicProgress.tsx`.
 *
 * Tata letaknya satu kolom di semua lebar. Di `Sheet variant="side"` itu berarti lembar bawah
 * di HP dan panel kanan 440px di laptop — dua bentuk yang sama-sama sempit dan tinggi, jadi
 * kolom tunggal memang yang benar. Yang berbeda hanya **ukuran**: lihat `aspect-square` di
 * bawah.
 */
export function NowPlayingView({ player }: { player: MusicPlayerApi }) {
  const { song, status, album } = player;

  const playing = status === 'playing';
  const preparing = status === 'preparing';
  const cover = song ? coverUrl(song) : '';

  // Baris status yang sama dengan bilah mini, tapi tanpa artis (artisnya sudah tampil besar
  // di atas) — jadi yang tersisa justru keterangan yang berguna: posisi antrean, menunggu
  // lagu lanjutan, atau pesan error.
  const statusText = barStatus({
    status,
    label: player.label,
    error: player.error,
    awaitingMore: player.awaitingMore,
    online: true,
    artist: '',
    position: player.queueIndex + 1,
    total: player.queue.length,
  });

  if (!song) {
    return <p className="py-10 text-center text-sm text-muted">Belum ada lagu yang diputar.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/*
            Bingkai gambar MEMESAN RUANG lebih dulu (`aspect-square` + latar), jadi isi di
            bawahnya tidak melompat saat gambarnya selesai dimuat.

            Lebarnya dibatasi tiga hal sekaligus: lebar viewport, TINGGI viewport, dan satu
            nilai maksimum. Batas tinggi itu yang penting — tanpa `38dvh`, di layar 667px
            tombol putar jatuh di bawah lipatan dan harus digulir. `object-cover` menangani
            hasil dari tab "Video" yang rasionya 16:9, bukan kotak.
          */}
      <div className="mx-auto w-[min(72vw,38dvh,20rem)] sm:w-[min(100%,22rem)]">
        <div className="relative aspect-square overflow-hidden rounded-3xl bg-surface shadow-xl">
          {cover ? (
            <img
              src={cover}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <div
              className={cn('shine flex size-full items-center justify-center bg-gradient-music')}
            >
              <Music className="size-16 text-white/80" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>

      <div className="text-center">
        {/* Judul dua baris, bukan dipotong: judul lagu yang terpotong di HP tidak berguna. */}
        <h2 className="line-clamp-2 text-xl leading-tight font-bold">{song.title}</h2>
        <p className="mt-1 truncate text-sm text-muted">{song.artist}</p>
        {album && <p className="truncate text-xs text-muted">dari album {album}</p>}
      </div>

      {preparing ? (
        <PrepareProgress percent={player.percent} label={player.label} size="lg" />
      ) : (
        <div className="flex flex-col gap-2">
          {player.totalSeconds > 0 && (
            <PositionProgress
              elapsed={player.elapsed}
              totalSeconds={player.totalSeconds}
              size="lg"
            />
          )}
          {statusText && <p className="text-center text-xs text-muted">{statusText}</p>}
        </div>
      )}

      {status === 'error' && (
        <Button variant="secondary" onClick={player.resume} className="self-center">
          Coba lagi
        </Button>
      )}

      {/*
            Transport. Jarak 16px antar tombol — panduan target sentuh menyarankan minimum
            8px antar target yang berdampingan, dan ini kontrol yang paling sering ditekan
            tanpa melihat. Tombol utama 64px, bukan 44px: ia pusat layar ini.
          */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={player.prev}
          disabled={!player.hasPrev}
          aria-label="Lagu sebelumnya"
          className="flex size-12 items-center justify-center rounded-2xl text-fg glass transition hover:bg-surface-strong active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <SkipBack className="size-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={player.toggle}
          disabled={preparing}
          aria-label={playing ? 'Jeda' : 'Putar'}
          className="shine flex size-16 items-center justify-center rounded-3xl bg-gradient-music text-white shadow-xl transition active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {preparing ? (
            // Diam di perangkat yang meminta reduced-motion — itu alasan bilah progres
            // berangka di atas wajib ada.
            <Loader2 className="size-7 animate-spin" aria-hidden="true" />
          ) : playing ? (
            <Pause className="size-7" aria-hidden="true" />
          ) : (
            <Play className="size-7" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={player.next}
          disabled={!player.hasNext}
          aria-label="Lagu berikutnya"
          className="flex size-12 items-center justify-center rounded-2xl text-fg glass transition hover:bg-surface-strong active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <SkipForward className="size-6" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <ModeButton
          label={
            player.repeat === 'one'
              ? 'Ulang satu lagu'
              : player.repeat === 'all'
                ? 'Ulang semua'
                : 'Ulang: mati'
          }
          pressed={player.repeat !== 'off'}
          onClick={player.toggleRepeat}
        >
          {player.repeat === 'one' ? (
            <Repeat1 className="size-4" aria-hidden="true" />
          ) : (
            <Repeat className="size-4" aria-hidden="true" />
          )}
        </ModeButton>
        <ModeButton
          label={player.shuffle ? 'Acak: menyala' : 'Acak: mati'}
          pressed={player.shuffle}
          onClick={player.toggleShuffle}
        >
          <Shuffle className="size-4" aria-hidden="true" />
        </ModeButton>
        <ModeButton
          label={player.autoContinue ? 'Lanjut otomatis: menyala' : 'Lanjut otomatis: mati'}
          pressed={player.autoContinue}
          onClick={player.toggleAutoContinue}
        >
          <InfinityIcon className="size-4" aria-hidden="true" />
        </ModeButton>
      </div>

      <div className="flex items-center gap-2">
        <ModeButton
          label={player.muted ? 'Nyalakan suara' : 'Bisukan'}
          pressed={player.muted}
          onClick={player.toggleMute}
        >
          {player.muted ? (
            <VolumeX className="size-4" aria-hidden="true" />
          ) : (
            <Volume2 className="size-4" aria-hidden="true" />
          )}
        </ModeButton>
        {/* `<input type="range">` asli: panah keyboard, Home/End, dan pembaca layar sudah
                bawaan — jadi pengaturan volume tidak pernah hanya bisa lewat geser. */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={player.volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="min-w-0 flex-1"
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openMusicSheet('antrean')} className="flex-1">
            <ListMusic aria-hidden="true" />
            Antrean{player.queue.length > 0 && ` (${player.queue.length})`}
          </Button>
          <Button variant="secondary" onClick={() => openMusicSheet('lirik')} className="flex-1">
            <FileText aria-hidden="true" />
            Lirik
          </Button>
        </div>
        <Button variant="ghost" onClick={player.stop} className="self-center text-muted">
          <X aria-hidden="true" />
          Hentikan & kosongkan antrean
        </Button>
      </div>
    </div>
  );
}
