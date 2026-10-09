import { FileText, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import type { MusicClient } from './api-client';
import type { MusicPlayerApi } from './useMusicPlayer';

/**
 * Lirik yang sudah pernah diambil, bertahan selama tab dibuka-tutup.
 *
 * Tab ini di-unmount setiap kali pengguna berpindah tab, jadi tanpa ini membuka tab Lirik
 * dua kali untuk lagu yang sama berarti dua permintaan. Cache tepi Worker memang
 * menanggungnya (TTL 1 jam), tapi tidak ada gunanya mengirim permintaan yang jawabannya
 * sudah ada di memori.
 *
 * Di luar modul supaya tidak ikut hilang bersama komponennya. Isinya hanya bertambah dan
 * tidak pernah berubah untuk `lyricsId` yang sama, jadi membacanya saat render tetap
 * memberikan hasil yang sama. Satu sesi saja — tidak ada yang ditulis ke penyimpanan apa pun.
 */
const cache = new Map<string, string>();

/** Hasil permintaan terakhir. Disimpan bersama id-nya supaya hasil lagu lama tidak terpakai. */
interface Fetched {
  id: string;
  text?: string;
  error?: string;
}

/**
 * Tab "Lirik".
 *
 * Ikut dibawa karena hampir gratis: `/v1/track` yang sudah dipanggil setiap lagu berganti
 * mengembalikan `lyricsId`, jadi yang perlu ditambahkan hanya satu permintaan teks.
 *
 * **Liriknya tidak bisa bergulir mengikuti lagu.** Lirik YouTube Music hanya teks, tanpa
 * penanda waktu sama sekali — itu batas hulu, bukan fitur yang belum dibuat. Jadi tidak ada
 * baris aktif yang disorot, dan tidak ada yang berjalan sendiri.
 */
export function LyricsTab({ client, player }: { client: MusicClient; player: MusicPlayerApi }) {
  const { lyricsId, song, status } = player;
  const [fetched, setFetched] = useState<Fetched>({ id: '' });

  /**
   * Efek ini HANYA mengambil data; tidak ada `setState` di badannya. Keadaan yang bisa
   * dihitung dari props dihitung saat render di bawah — kalau disalin ke state lewat efek,
   * setiap pergantian lagu memicu render berantai dan satu frame dengan lirik lagu lama.
   */
  useEffect(() => {
    if (!lyricsId || cache.has(lyricsId)) return;
    let alive = true;
    client
      .lyrics(lyricsId)
      .then((value) => {
        cache.set(lyricsId, value);
        if (alive) setFetched({ id: lyricsId, text: value });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // Pesan dari Worker sudah berbahasa Indonesia dan siap ditampilkan.
        setFetched({
          id: lyricsId,
          error: err instanceof Error ? err.message : 'Gagal memuat lirik.',
        });
      });
    return () => {
      alive = false;
    };
  }, [client, lyricsId]);

  const forThisSong = fetched.id === lyricsId ? fetched : null;
  const text = lyricsId ? (cache.get(lyricsId) ?? forThisSong?.text) : undefined;
  const error = forThisSong?.error ?? '';

  if (!song) {
    return (
      <EmptyState
        icon={FileText}
        title="Belum ada lagu"
        description="Lirik muncul di sini setelah ada lagu yang diputar."
        gradient="bg-gradient-music"
      />
    );
  }

  /*
   * Tiga keadaan yang perlu dibedakan, bukan disamakan jadi "tidak ada lirik":
   *   - keterangan lagunya belum tiba → sedang diambil, tunggu
   *   - `lyricsId` ada, teks belum    → permintaan liriknya sedang jalan
   *   - `lyricsId` kosong             → lagu ini memang tidak punya lirik
   * `/v1/track` diambil begitu lagu mulai berbunyi, jadi yang pertama hanya sekejap.
   */
  const detailsPending = (status === 'playing' || status === 'paused') && !lyricsId;
  const loading = detailsPending || (Boolean(lyricsId) && text === undefined && !error);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="truncate text-sm font-bold">{song.title}</h3>
        <p className="truncate text-xs text-muted">{song.artist}</p>
      </div>

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat lirik…
        </p>
      ) : error ? (
        <p className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : !lyricsId ? (
        <EmptyState
          icon={FileText}
          title="Tidak ada lirik"
          description="YouTube Music tidak punya lirik untuk lagu ini."
          gradient="bg-gradient-music"
        />
      ) : text?.trim() ? (
        <>
          {/* `whitespace-pre-wrap`: baris dipisah \n, dan jeda antar bait ikut dipertahankan. */}
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
          <p className="border-t border-line pt-3 text-xs text-muted">
            Lirik dari YouTube Music tidak punya penanda waktu, jadi tidak bisa bergulir mengikuti
            lagu.
          </p>
        </>
      ) : (
        <EmptyState
          icon={FileText}
          title="Lirik kosong"
          description="Liriknya ada tapi tidak berisi teks — biasanya lagu instrumental."
          gradient="bg-gradient-music"
        />
      )}
    </div>
  );
}
