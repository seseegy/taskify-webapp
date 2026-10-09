import { Sheet } from '@/components/ui/Sheet';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { MusicClient } from './api-client';
import { LyricsTab } from './LyricsTab';
import { useMusicPanel, type MusicTab } from './music-store';
import { QueueTab } from './QueueTab';
import { SearchTab } from './SearchTab';
import type { MusicPlayerApi } from './useMusicPlayer';

/**
 * Panel musik: tiga tab di dalam `Sheet`.
 *
 * Semua yang berat ada di sini, bukan di bilah mini — pencarian, antrean, dan lirik. `Sheet`
 * sudah menangani fokus terkunci, Esc, dan klik backdrop; membuat panel sendiri berarti
 * menulis ulang semua itu. Di mobile `variant="side"` sudah berbentuk bottom sheet
 * `max-h-[88dvh]`, yang persis bentuk yang dibutuhkan.
 *
 * Tiga tab, bukan empat: tab Radio dibatalkan bersama radionya.
 */
export function MusicSheet({ client, player }: { client: MusicClient; player: MusicPlayerApi }) {
  const { panel, tab, show, hide } = useMusicPanel();
  // `panel === 'sekarang'` berarti layar Sedang diputar yang terbuka, bukan Sheet ini.
  const open = panel !== 'none' && panel !== 'sekarang';

  return (
    /*
      `title` WAJIB diisi: `Sheet` tanpa judul tidak punya nama aksesibel, jadi pembaca layar
      hanya mengumumkan "dialog" tanpa memberi tahu dialog apa.
    */
    <Sheet open={open} onClose={hide} title="Musik" variant="side">
      <div className="flex flex-col gap-3">
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
          Hanya tab yang aktif yang dirender. Itu memang berarti keadaan tab pencarian hilang
          saat berpindah tab — konsekuensi yang dipilih sadar, karena alternatifnya menjaga
          tiga tab tetap hidup sekaligus (termasuk permintaan lirik yang tidak sedang dilihat
          siapa pun). Hasil pencarian yang hilang mudah didapat kembali; yang penting —
          antrean dan audionya — hidup di `MusicBar`, bukan di sini.
        */}
        {tab === 'cari' && <SearchTab client={client} player={player} />}
        {tab === 'antrean' && <QueueTab player={player} onSearch={() => show('cari')} />}
        {tab === 'lirik' && <LyricsTab client={client} player={player} />}
      </div>
    </Sheet>
  );
}
