import { Clock, Loader2, Music, Search } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { MusicClient, SearchFilter } from './api-client';
import { openNowPlaying } from './music-store';
import { SEARCH_TABS, canLoadMore, mergeSongPages } from './search-core';
import { SongRow } from './SongRow';
import type { Song } from './types';
import type { MusicPlayerApi } from './useMusicPlayer';

/**
 * Tab "Cari lagu": cari, lalu ketuk untuk memutar.
 *
 * Seluruh daftar hasil jadi antrean saat satu lagu diketuk, dengan lagu itu sebagai titik
 * mulai. Jadi mencari sekali sudah cukup untuk mendengarkan lama — dan penyambungan antrean
 * otomatis (`queue-settle`) akan melanjutkannya sendiri saat daftarnya habis.
 */
export function SearchTab({ client, player }: { client: MusicClient; player: MusicPlayerApi }) {
  const [tabKey, setTabKey] = useState(SEARCH_TABS[0]!.key);
  const [text, setText] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [state, setState] = useState<'idle' | 'loading' | 'more' | 'done'>('idle');
  const [error, setError] = useState('');
  /** Kata kunci & filter yang hasilnya sedang ditampilkan — bukan yang sedang diketik. */
  const [shown, setShown] = useState('');
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  /**
   * Menandai permintaan mana yang masih relevan. Pencarian cepat berurutan bisa kembali
   * tidak sesuai urutan, dan tanpa ini hasil pencarian lama bisa menimpa yang baru.
   */
  const seqRef = useRef(0);
  const filter = SEARCH_TABS.find((t) => t.key === tabKey)?.filter;

  async function search(query: string, nextFilter: SearchFilter | undefined) {
    const q = query.trim();
    if (!q) return;
    const token = (seqRef.current += 1);
    setState('loading');
    setError('');
    try {
      const page = await client.search(q, nextFilter);
      if (seqRef.current !== token) return;
      setSongs(mergeSongPages([], page.songs));
      setCursor(page.cursor);
      setShown(q);
      setState('done');
    } catch (err: unknown) {
      if (seqRef.current !== token) return;
      // Pesan dari klien/Worker sudah berbahasa Indonesia dan siap ditampilkan.
      setError(err instanceof Error ? err.message : 'Pencarian gagal.');
      setState('done');
    }
  }

  async function loadMore() {
    if (!cursor) return;
    const token = (seqRef.current += 1);
    setState('more');
    try {
      const page = await client.searchMore(cursor);
      if (seqRef.current !== token) return;
      // Dedupe antar halaman tugas klien — Worker tidak menyimpan status.
      setSongs((prev) => mergeSongPages(prev, page.songs));
      setCursor(page.cursor);
      setState('done');
    } catch (err: unknown) {
      if (seqRef.current !== token) return;
      setError(err instanceof Error ? err.message : 'Gagal memuat halaman berikutnya.');
      setState('done');
    }
  }

  const loading = state === 'loading';
  const currentId = player.song?.videoId ?? '';

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(text, filter);
        }}
        className="flex flex-col gap-2"
      >
        <label
          htmlFor={inputId}
          className="flex h-12 items-center gap-2 rounded-2xl px-3.5 glass focus-within:ring-4 focus-within:ring-primary/15"
        >
          <Search className="size-5 shrink-0 text-muted" aria-hidden="true" />
          <input
            id={inputId}
            // Sheet memindahkan fokus ke elemen bertanda ini saat dibuka.
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Judul lagu atau nama penyanyi…"
            /*
              `aria-label` wajib walau sudah ada `<label htmlFor>`: label-nya hanya memuat
              ikon yang `aria-hidden`, jadi tanpa ini kolomnya tidak punya nama aksesibel
              sama sekali. Label-nya tetap ada supaya mengetuk seluruh kotak memfokuskan
              kolom. Placeholder bukan nama — ia hilang begitu ada teks.
            */
            aria-label="Cari lagu"
            aria-describedby={hintId}
            enterKeyHint="search"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
          />
        </label>

        <div className="flex items-center gap-2">
          <SegmentedControl
            value={tabKey}
            options={SEARCH_TABS.map((t) => ({ value: t.key, label: t.label }))}
            onChange={(key) => {
              setTabKey(key);
              // Hasil lama milik filter lain; dibuang supaya tidak terlihat seperti hasil
              // filter yang baru dipilih.
              setSongs([]);
              setCursor(undefined);
              setShown('');
              const next = SEARCH_TABS.find((t) => t.key === key)?.filter;
              void search(text, next);
            }}
            label="Jenis hasil pencarian"
            className="min-w-0 flex-1"
          />
          <Button type="submit" loading={loading} disabled={!text.trim()}>
            Cari
          </Button>
        </div>
      </form>

      {/*
        Dikatakan apa adanya, bukan disembunyikan: lagu PERTAMA memang perlu belasan detik,
        dan harapan yang dikelola lebih baik daripada kejutan. Lagu berikutnya terasa
        seketika karena disiapkan di latar belakang selagi yang sekarang berbunyi.
      */}
      <p id={hintId} className="flex items-start gap-1.5 text-xs text-muted">
        <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Lagu pertama perlu ±15 detik untuk disiapkan. Lagu setelahnya terasa langsung.
      </p>

      {error && (
        <p className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {/* Jumlah hasil untuk pembaca layar; daftarnya sendiri sudah terlihat. */}
      <div role="status" className="sr-only">
        {state === 'done' && shown
          ? songs.length > 0
            ? `${songs.length} lagu ditemukan untuk ${shown}`
            : `Tidak ada lagu untuk ${shown}`
          : ''}
      </div>

      {loading && songs.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Mencari…
        </p>
      ) : songs.length > 0 ? (
        <>
          <ul className="-mx-1">
            {songs.map((song, i) => (
              <SongRow
                key={song.videoId}
                song={song}
                current={song.videoId === currentId}
                // Lagu yang sedang diputar tidak dimulai ulang — ia membuka layar
                // "Sedang diputar", sama seperti di tab Antrean.
                onPlay={() =>
                  song.videoId === currentId ? openNowPlaying() : player.play(songs, i)
                }
              />
            ))}
          </ul>
          {/*
            Hanya muncul kalau masih ada cursor. Tab "Semua" pun bisa dilanjutkan: Worker
            mengirim cursor gabungan untuk hasil campuran, jadi `canLoadMore` benar di
            semua tab selama cursor-nya ada. Lihat `search-core.ts`.
          */}
          {canLoadMore(filter, cursor) && (
            <Button
              variant="secondary"
              onClick={() => void loadMore()}
              loading={state === 'more'}
              className="self-center"
            >
              Muat lagi
            </Button>
          )}
        </>
      ) : shown ? (
        <EmptyState
          icon={Search}
          title="Tidak ada hasil"
          description={`Tidak ada lagu untuk “${shown}”. Coba kata kunci lain atau tab yang berbeda.`}
          gradient="bg-gradient-music"
        />
      ) : (
        <EmptyState
          icon={Music}
          title="Cari lagu"
          description="Ketik judul lagu atau nama penyanyi, lalu ketuk hasilnya untuk memutar."
          gradient="bg-gradient-music"
          className="py-8"
        />
      )}
    </div>
  );
}
