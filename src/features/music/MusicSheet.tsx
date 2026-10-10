import { ChevronRight, Music } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { MusicClient } from './api-client';
import { LyricsTab } from './LyricsTab';
import { useMusicPanel, type MusicTab } from './music-store';
import { NowPlayingView } from './NowPlayingView';
import { QueueTab } from './QueueTab';
import { SearchTab } from './SearchTab';
import { thumbUrl } from './search-core';
import type { MusicPlayerApi } from './useMusicPlayer';

/**
 * Panel musik: **satu** `Sheet` yang menampung semua isi — layar "Sedang diputar" dan tiga
 * tab (Cari lagu, Antrean, Lirik). Tiga tab, bukan empat: tab Radio dibatalkan bersama
 * radionya.
 *
 * `Sheet` sudah menangani fokus terkunci, Esc, dan klik backdrop; membuat panel sendiri
 * berarti menulis ulang semua itu. Di mobile `variant="side"` sudah berbentuk bottom sheet
 * `max-h-[88dvh]`, yang persis bentuk yang dibutuhkan.
 *
 * ## Kenapa SATU `Sheet`, bukan dua
 *
 * Versi pertama memakai dua `<dialog>` terpisah yang dikendalikan satu field `panel`.
 * Hasilnya bug: menekan "Antrean" dari layar Sedang diputar **menutup segalanya**.
 *
 * Sebabnya ada di `ui/Sheet.tsx`: `onClose` dipanggil oleh event `close` native, dan event
 * itu ikut terpicu saat dialog ditutup **secara terprogram** (`dialog.close()` di efeknya) —
 * bukan hanya saat pengguna menutupnya. Jadi:
 *
 * ```
 * panel = 'antrean'      → layar Sedang diputar jadi open=false
 * dialog.close()         → event `close` native
 * onClose → hide()       → panel = 'none'      ← menghapus keadaan milik Sheet satunya
 * Sheet tiga tab         → open=false lagi, tidak pernah terbuka
 * ```
 *
 * Dengan satu dialog, perpindahan antar panel hanya **mengganti isi** — tidak ada
 * `dialog.close()`, jadi tidak ada event `close`, jadi tidak ada yang menghapus keadaan.
 * Tipe `MusicPanel` sudah menjanjikan "satu panel sekaligus"; sekarang implementasinya
 * benar-benar begitu, bukan hanya namanya.
 */
export function MusicSheet({ client, player }: { client: MusicClient; player: MusicPlayerApi }) {
  const { panel, tab, show, hide } = useMusicPanel();
  const open = panel !== 'none';
  const nowPlaying = panel === 'sekarang';

  return (
    /*
      `title` WAJIB diisi: `Sheet` tanpa judul tidak punya nama aksesibel, jadi pembaca layar
      hanya mengumumkan "dialog" tanpa memberi tahu dialog apa. Judulnya ikut panel supaya
      yang diumumkan tetap benar setelah berpindah isi.
    */
    <Sheet
      open={open}
      onClose={hide}
      title={nowPlaying ? 'Sedang diputar' : 'Musik'}
      variant="side"
    >
      {nowPlaying ? (
        <NowPlayingView player={player} />
      ) : (
        <div className="flex flex-col gap-3">
          {/*
            Jalan kembali ke layar Sedang diputar. Tanpa ini, perjalanannya satu arah: dari
            layar itu bisa ke Antrean, tapi dari Antrean harus menutup panel dan mengetuk
            bilah mini lagi — dan itu persis jenis jalan buntu yang mudah tidak terlihat
            saat menulis kodenya.
          */}
          {player.song && (
            <button
              type="button"
              onClick={() => show('sekarang')}
              className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left glass transition hover:bg-surface-strong"
            >
              <span className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-surface">
                {thumbUrl(player.song) ? (
                  <img
                    src={thumbUrl(player.song)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                  />
                ) : (
                  <Music className="absolute inset-0 m-auto size-4 text-muted" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{player.song.title}</span>
                <span className="block truncate text-xs text-muted">Sedang diputar</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
            </button>
          )}

          {/*
            Tanpa ikon, dan itu diukur: pada 320px panel ini selebar 280px, dan tiga label
            dengan ikon butuh ~312px — teksnya akan terbungkus jadi dua baris. Menyembunyikan
            teks dan menyisakan ikon bukan pilihan: tombol radio tanpa teks kehilangan nama
            aksesibelnya. Jadi yang dibuang ikonnya, karena itu yang hiasan.
          */}
          <SegmentedControl<MusicTab>
            value={tab}
            onChange={show}
            label="Bagian panel musik"
            options={[
              { value: 'cari', label: 'Cari lagu' },
              {
                value: 'antrean',
                // Jumlah antrean ikut di label: ia menjawab "masih ada berapa lagi" tanpa
                // perlu membuka tabnya.
                label: player.queue.length > 0 ? `Antrean (${player.queue.length})` : 'Antrean',
              },
              { value: 'lirik', label: 'Lirik' },
            ]}
          />

          {/*
            Hanya tab yang aktif yang dirender. Itu memang berarti keadaan tab pencarian
            hilang saat berpindah tab — konsekuensi yang dipilih sadar, karena alternatifnya
            menjaga tiga tab tetap hidup sekaligus (termasuk permintaan lirik yang tidak
            sedang dilihat siapa pun). Hasil pencarian yang hilang mudah didapat kembali;
            yang penting — antrean dan audionya — hidup di `MusicBar`, bukan di sini.
          */}
          {tab === 'cari' && <SearchTab client={client} player={player} />}
          {tab === 'antrean' && <QueueTab player={player} onSearch={() => show('cari')} />}
          {tab === 'lirik' && <LyricsTab client={client} player={player} />}
        </div>
      )}
    </Sheet>
  );
}
