import {
  Infinity as InfinityIcon,
  ListMusic,
  Repeat,
  Repeat1,
  Shuffle,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ModeButton } from './ModeButton';
import { openNowPlaying } from './music-store';
import { REPEAT_LABEL } from './queue-core';
import { SongRow } from './SongRow';
import type { MusicPlayerApi } from './useMusicPlayer';

/**
 * Tab "Antrean": daftar lagu, lompat lagu, dan mode pemutaran.
 *
 * Mode pemutaran (ulang, acak, lanjut otomatis) ada di sini dan bukan di bilah mini: bilah
 * di mobile hanya cukup untuk putar, judul, dan dua tombol pindah lagu. Bisu dan volume juga
 * diulang di sini karena keduanya disembunyikan dari bilah di bawah `sm`.
 */
export function QueueTab({
  player,
  onSearch,
}: {
  player: MusicPlayerApi;
  /** Mengarahkan ke tab pencarian saat antreannya kosong. */
  onSearch: () => void;
}) {
  const { queue, queueIndex } = player;

  if (queue.length === 0) {
    return (
      <EmptyState
        icon={ListMusic}
        title="Antrean kosong"
        description="Belum ada lagu yang diputar. Cari lagu dulu, lalu seluruh hasilnya jadi antrean."
        gradient="bg-gradient-music"
      >
        <Button onClick={onSearch}>Cari lagu</Button>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <ModeButton
          label={REPEAT_LABEL[player.repeat]}
          // Mode ulang punya tiga keadaan, jadi `aria-pressed` hanya membedakan mati/menyala;
          // keadaan mana yang menyala disampaikan oleh namanya yang ikut berubah.
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
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={player.volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="ml-1 w-24 min-w-0 flex-1"
        />
      </div>

      {player.autoContinue && (
        <p className="text-xs text-muted">
          Antrean akan disambung sendiri saat lagu terakhir habis, jadi musiknya tidak berhenti.
        </p>
      )}

      <ul className="-mx-1">
        {queue.map((song, i) => (
          <SongRow
            key={song.videoId}
            song={song}
            index={i + 1}
            current={i === queueIndex}
            /*
              Baris yang SEDANG diputar tidak melompat ke dirinya sendiri — itu praktis
              tidak melakukan apa-apa. Ia membuka layar "Sedang diputar", yang memang
              perilaku yang diharapkan dari pemutar musik mana pun.
            */
            onPlay={() => (i === queueIndex ? openNowPlaying() : player.jumpTo(i))}
          />
        ))}
      </ul>

      <Button variant="secondary" onClick={player.stop} className="self-center">
        <X aria-hidden="true" />
        Hentikan & kosongkan antrean
      </Button>
    </div>
  );
}
