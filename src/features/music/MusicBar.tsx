import {
  Loader2,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { musicClient } from './api-client';
import { barAnnouncement, barControls, barStatus, elapsedPercent, formatClock } from './music-view';
import { bindMusicToggle, openMusicSheet, publishMusicRemote } from './music-store';
import { MusicSheet } from './MusicSheet';
import { useMusicPlayer } from './useMusicPlayer';

/**
 * Bilah pemutar musik — titik pasang pemutar di seluruh aplikasi.
 *
 * Dipasang di `AppShell`, **bukan** di dalam halaman: router meng-unmount halaman saat pindah
 * menu, dan itu akan memutus musik di tengah lagu. Pola yang sama seperti `Toaster` dan
 * `ConfirmDialog`. Karena itu komponen ini juga yang memegang `useMusicPlayer()` dan elemen
 * `<audio>`-nya — satu-satunya di aplikasi, supaya tidak ada dua pemutar yang berbunyi
 * bersamaan.
 *
 * Penempatannya **berbeda di desktop dan mobile**, dan itu diukur bukan dirasa:
 *
 *  - **Desktop** (`lg`): bilah selalu ada, menempel di dasar kolom konten (bukan di sidebar —
 *    sidebar sudah kehabisan tinggi, lihat komentar di `AppShell.tsx`). Saat tidak ada yang
 *    diputar bentuknya ramping dan berfungsi sebagai pintu masuk; di desktop ruangnya ada,
 *    dan pintu masuk yang terlihat lebih baik daripada yang harus diingat.
 *  - **Mobile**: hanya muncul saat ada yang diputar. Header mobile sudah kehabisan lebar dan
 *    pita di atas navigasi bawah sudah diperebutkan Toaster, UpdatePrompt, dan FAB Keuangan.
 *    Jadi di mobile pemutar membayar ruang hanya saat benar-benar dipakai; pintu masuknya
 *    CommandPalette.
 *
 * Tinggi bilah diumumkan ke `--music-bar-h` supaya Toaster, UpdatePrompt, dan FAB menyingkir
 * ke atasnya — lihat `styles/index.css`.
 */
export function MusicBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const player = useMusicPlayer(musicClient, audioRef);
  const online = useOnline();
  const barRef = useRef<HTMLDivElement>(null);
  useMusicBarHeight(barRef);

  const { song, status, percent, elapsed, totalSeconds } = player;
  const active = status !== 'idle';
  const preparing = status === 'preparing';
  const playing = status === 'playing';

  const controls = barControls({
    status,
    online,
    hasUrl: player.hasUrl,
    hasNext: player.hasNext,
    hasPrev: player.hasPrev,
  });
  const statusText = barStatus({
    status,
    label: player.label,
    error: player.error,
    awaitingMore: player.awaitingMore,
    online,
    artist: song?.artist ?? '',
    position: player.queueIndex + 1,
    total: player.queue.length,
  });
  const announcement = barAnnouncement({
    status,
    error: player.error,
    awaitingMore: player.awaitingMore,
    title: song?.title ?? '',
  });

  /*
    Mengabarkan ringkasan pemutar ke luar, untuk CommandPalette. Ini memang pekerjaan efek:
    menyinkronkan sistem di luar React dengan keadaan React terbaru. `publishMusicRemote`
    tidak menulis apa-apa kalau ringkasannya tidak berubah, jadi laporan progres dan
    `timeupdate` (empat kali sedetik) tidak memicu render di palette.
  */
  const hasLyrics = Boolean(player.lyricsId);
  useEffect(() => {
    publishMusicRemote({ active, playing, hasLyrics });
  }, [active, playing, hasLyrics]);

  /*
    Putar/jeda dari palette. Diikat ulang setiap `toggle` berubah identitasnya, karena
    `toggle` memutuskan peristiwa mana yang dikirim dari status saat itu — handler yang basi
    akan mengambil keputusan dari status lama.
  */
  const toggle = player.toggle;
  useEffect(() => {
    bindMusicToggle(toggle);
    return () => bindMusicToggle(null);
  }, [toggle]);

  return (
    <>
      {/*
        Elemen audio tunggal, SELALU terpasang — juga saat bilahnya tidak terlihat di mobile.
        Kalau ia ikut hilang, memutar musik lalu pindah ke keadaan apa pun yang
        menyembunyikan bilah akan memutus suaranya.
      */}
      <audio ref={audioRef} preload="none" className="hidden" />

      {/*
        Panel musik dirender di sini, bukan di `AppShell`: ia perlu API pemutar yang sama
        dengan bilah ini. `musicClient` dipersempit di sini supaya tab-tabnya tidak perlu
        menangani kemungkinan "klien tidak ada" yang sebenarnya mustahil — komponen ini hanya
        dipasang saat `VITE_MUSIC_API_URL` diisi.

        Letaknya di LUAR pembungkus bilah dengan sengaja: pembungkus itu `display: none` di
        mobile saat tidak ada yang diputar, dan `<dialog>` di dalam subtree yang tidak
        dirender tidak bisa dibuka — padahal justru di keadaan itulah panel pencarian
        dipanggil dari CommandPalette.
      */}
      {musicClient && <MusicSheet client={musicClient} player={player} />}

      {/*
        Satu live region, dan sengaja di LUAR bilah: elemen di dalam subtree `display: none`
        tidak diumumkan pembaca layar. Isinya kosong pada keadaan biasa — lihat
        `barAnnouncement` untuk alasan kenapa pergantian lagu tidak diumumkan.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div
        ref={barRef}
        className={cn(
          // `pointer-events-none` pada pembungkus: ia selebar layar dan punya jarak bawah
          // sendiri, jadi tanpa ini pita kosong di sekitar bilah akan menelan klik.
          'pointer-events-none fixed inset-x-0 bottom-[var(--bottom-nav-h)] z-40 px-3 pb-[var(--stack-gap)] lg:left-72 lg:px-10',
          active ? 'block' : 'hidden lg:block',
        )}
      >
        {/* max-w-6xl menyamai <main> di AppShell, supaya bilah lurus dengan isi halaman. */}
        <div className="pointer-events-auto mx-auto flex max-w-6xl flex-col gap-2 rounded-2xl p-2 glass-strong">
          <div className="flex items-center gap-2">
            {active ? (
              <button
                type="button"
                onClick={player.toggle}
                disabled={!controls.canPlay || preparing}
                aria-label={playing ? 'Jeda' : 'Putar'}
                className="shine flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-music text-white shadow-md transition active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                {preparing ? (
                  // Di perangkat yang meminta reduced-motion, blok global di styles/index.css
                  // mematikan animasi — ikon ini jadi diam. Itu alasan bilah progres berangka
                  // di bawah bukan hiasan, melainkan satu-satunya tanda ada kemajuan.
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                ) : playing ? (
                  <Pause className="size-5" aria-hidden="true" />
                ) : (
                  <Play className="size-5" aria-hidden="true" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openMusicSheet('cari')}
                aria-label="Buka pemutar musik"
                className="shine flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-music text-white shadow-md transition active:scale-95"
              >
                <Music className="size-5" aria-hidden="true" />
              </button>
            )}

            {/*
              Judul sebagai <h3>: memberi pembaca layar titik navigasi, dan membedakannya dari
              judul yang sama di daftar hasil pencarian. Yang bisa diklik adalah tombol
              transparan di atas seluruh blok — <button> tidak boleh memuat heading, dan
              tombol seluas blok memberi target ≥44px (tingginya ikut tombol putar).
            */}
            <div className="relative flex min-w-0 flex-1 flex-col justify-center self-stretch">
              <h3 className="truncate text-sm font-bold">{song?.title ?? 'Musik'}</h3>
              {statusText && <p className="truncate text-xs text-muted">{statusText}</p>}
              <button
                type="button"
                onClick={() => openMusicSheet(active ? 'antrean' : 'cari')}
                aria-label={song ? `Buka panel musik — ${song.title}` : 'Cari lagu'}
                className="absolute inset-0 rounded-lg"
              />
            </div>

            {active && (
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  label="Lagu sebelumnya"
                  onClick={player.prev}
                  disabled={!controls.canPrev}
                >
                  <SkipBack className="size-5" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="Lagu berikutnya"
                  onClick={player.next}
                  disabled={!controls.canNext}
                >
                  <SkipForward className="size-5" aria-hidden="true" />
                </IconButton>
                {/*
                  Di bawah sm tombol-tombol ini disembunyikan: pada 320px, bilah hanya cukup
                  untuk putar + judul + dua tombol pindah lagu. Bisu dan hentikan tetap
                  terjangkau dari panel musik.
                */}
                <IconButton
                  label={player.muted ? 'Nyalakan suara' : 'Bisukan'}
                  pressed={player.muted}
                  onClick={player.toggleMute}
                  className="hidden sm:flex"
                >
                  {player.muted ? (
                    <VolumeX className="size-5" aria-hidden="true" />
                  ) : (
                    <Volume2 className="size-5" aria-hidden="true" />
                  )}
                </IconButton>
                {/* Slider digambar ulang sepenuhnya di styles/index.css, jadi ikut tema. */}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={player.volume}
                  onChange={(e) => player.setVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="hidden w-20 lg:block"
                />
                <IconButton label="Hentikan musik" onClick={player.stop} className="hidden sm:flex">
                  <X className="size-5" aria-hidden="true" />
                </IconButton>
              </div>
            )}
          </div>

          {preparing ? (
            <PrepareRow percent={percent} />
          ) : status === 'error' ? (
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={player.resume} disabled={!online}>
                Coba lagi
              </Button>
            </div>
          ) : active && totalSeconds > 0 ? (
            <PositionRow elapsed={elapsed} totalSeconds={totalSeconds} />
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * Bilah progres konversi — determinate, berangka, dan diumumkan sebagai `progressbar`.
 *
 * Lagu pertama butuh 12–28 detik. Itu tidak bisa disembunyikan, jadi harus dijelaskan:
 * angka yang bergerak adalah satu-satunya bukti bahwa aplikasinya tidak macet. Angkanya
 * tidak akan mundur — `api-client` hanya melaporkan nilai tertinggi yang pernah dilihat.
 */
function PrepareRow({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label="Menyiapkan audio"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} persen`}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface"
      >
        <div
          className="h-full rounded-full bg-gradient-music transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-semibold text-muted tabular-nums">{clamped}%</span>
    </div>
  );
}

/**
 * Waktu berjalan + garis posisi lagu.
 *
 * **Garisnya tidak bisa diklik, dan itu bukan kelalaian.** CDN konverter tidak melayani
 * `Range` (`Range: bytes=…` dijawab 200 dengan seluruh berkas, tanpa `Accept-Ranges`), jadi
 * audionya memang tidak bisa digeser posisinya. Membuat bilah yang kelihatan bisa digeser
 * tapi diam lebih buruk daripada garis yang jelas-jelas hanya penunjuk — jadi tidak ada
 * `<input type="range">`, tidak ada kursor penunjuk, dan tidak ada handle.
 *
 * Garisnya `aria-hidden`: angka di sebelahnya sudah menyampaikan informasi yang sama dalam
 * bentuk yang bisa dibaca, dan nilai yang berubah empat kali sedetik tidak perlu dua wakil.
 *
 * Durasinya dari metadata lagu, bukan dari `audio.duration` — respons konverter tidak
 * memuat `Content-Length`, jadi peramban tidak selalu tahu panjang berkasnya.
 */
function PositionRow({ elapsed, totalSeconds }: { elapsed: number; totalSeconds: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        aria-hidden="true"
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface"
      >
        <div
          className="h-full rounded-full bg-gradient-music"
          style={{ width: `${elapsedPercent(elapsed, totalSeconds)}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-muted tabular-nums">
        {formatClock(elapsed)} / {formatClock(totalSeconds)}
      </span>
    </div>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // Tombol mode (bisu) mengumumkan keadaannya; tombol aksi biasa tidak punya keadaan.
      aria-pressed={pressed}
      className={cn(
        // size-11 (44px), bukan Button size="icon" yang 40px: target sentuh minimum di mobile
        // adalah 44px, dan ini kontrol yang paling sering ditekan sambil berjalan.
        'flex size-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-40',
        pressed && 'text-fg glass',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Mengumumkan tinggi bilah ke `--music-bar-h`, sumber kebenaran tumpukan bawah.
 *
 * Diukur, bukan ditulis sebagai angka tetap: tinggi bilah **berubah** — baris progres hanya
 * ada saat menyiapkan audio, dan jarak bawahnya ikut `--stack-gap` yang berbeda di `lg`.
 * Angka tetap pasti salah di salah satu keadaan itu, dan akibatnya Toaster atau UpdatePrompt
 * menempel atau menabrak bilah.
 *
 * Tinggi yang diukur mencakup `padding-bottom` pembungkus, jadi `--music-bar-h` sudah berisi
 * "bilah + jaraknya ke navigasi bawah" — itulah yang dibutuhkan `--stack-bottom`.
 *
 * Nol saat bilahnya `display: none` (mobile, tidak ada yang diputar): elemen yang tidak
 * dirender melaporkan kotak 0×0 ke `ResizeObserver`, dan observer-nya ikut terpanggil saat
 * elemen mulai/berhenti dirender — jadi berpindah lebar layar pun ikut terbaca.
 */
function useMusicBarHeight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty('--music-bar-h', `${el.offsetHeight}px`);
    const observer = new ResizeObserver(write);
    observer.observe(el);
    write();
    return () => {
      observer.disconnect();
      // Dihapus, bukan disetel '0px': nilainya kembali ke deklarasi di styles/index.css.
      root.style.removeProperty('--music-bar-h');
    };
  }, [ref]);
}

/**
 * Status koneksi.
 *
 * `navigator.onLine` bisa berbohong (true padahal tidak ada jalan keluar), jadi ini dipakai
 * untuk menonaktifkan kontrol yang pasti butuh jaringan — bukan sebagai satu-satunya
 * pengaman. Yang benar-benar menentukan tetap hasil permintaannya, dan pesannya datang dari
 * `MusicError`.
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
