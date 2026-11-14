import { cn } from '@/lib/utils';
import { elapsedPercent, formatClock } from './music-view';

/**
 * Dua bilah yang tampak mirip tapi **berbeda arti**, dan karena itu berbeda semantiknya.
 * Dikumpulkan di satu berkas supaya keputusan ARIA-nya tidak perlu diulang di bilah mini dan
 * di layar "Sedang diputar" — kalau diulang, salah satunya akan menyimpang.
 */

/**
 * Progres **menyiapkan audio** — determinate, berangka, diumumkan sebagai `progressbar`.
 *
 * Lagu pertama butuh 12–28 detik. Itu tidak bisa disembunyikan, jadi harus dijelaskan: angka
 * yang bergerak adalah satu-satunya bukti bahwa aplikasinya tidak macet. Dan angkanya tidak
 * akan mundur — `api-client` hanya melaporkan nilai tertinggi yang pernah dilihat.
 *
 * Wajib berangka, bukan hiasan: `prefers-reduced-motion` di repo ini mematikan semua animasi,
 * jadi ikon pemuat di sebelahnya **diam**.
 */
export function PrepareProgress({
  percent,
  label,
  size = 'sm',
}: {
  percent: number;
  /** Kalimat dari klien, mis. "Menyiapkan audio… 45%". Hanya dipakai pada ukuran besar. */
  label?: string;
  size?: 'sm' | 'lg';
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="flex flex-col gap-1.5">
      {size === 'lg' && label && <p className="text-center text-xs text-muted">{label}</p>}
      <div className="flex items-center gap-2">
        <div
          role="progressbar"
          aria-label="Menyiapkan audio"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped}
          aria-valuetext={`${clamped} persen`}
          className={cn(
            'min-w-0 flex-1 overflow-hidden rounded-full bg-surface',
            size === 'lg' ? 'h-2' : 'h-1.5',
          )}
        >
          <div
            className="h-full rounded-full bg-gradient-music transition-[width]"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-semibold text-muted tabular-nums">{clamped}%</span>
      </div>
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
 * `<input type="range">`, tidak ada handle, tidak ada `cursor-pointer`, dan garisnya tipis.
 *
 * `aria-hidden`: angka di sebelahnya menyampaikan informasi yang sama dalam bentuk yang bisa
 * dibaca, dan nilai yang berubah empat kali sedetik tidak perlu dua wakil.
 *
 * Durasinya dari metadata lagu, bukan `audio.duration` — respons konverter tidak memuat
 * `Content-Length`, jadi peramban tidak selalu tahu panjang berkasnya.
 */
export function PositionProgress({
  elapsed,
  totalSeconds,
  size = 'sm',
}: {
  elapsed: number;
  totalSeconds: number;
  size?: 'sm' | 'lg';
}) {
  const line = (
    <div
      aria-hidden="true"
      className={cn(
        'min-w-0 flex-1 overflow-hidden rounded-full bg-surface',
        size === 'lg' ? 'h-1.5' : 'h-1',
      )}
    >
      <div
        className="h-full rounded-full bg-gradient-music"
        style={{ width: `${elapsedPercent(elapsed, totalSeconds)}%` }}
      />
    </div>
  );
  const clock = (from: number) => (
    <span className="shrink-0 text-xs text-muted tabular-nums">{formatClock(from)}</span>
  );

  // Di ukuran besar waktunya dipisah ke dua ujung di bawah garis — bentuk yang sudah dikenal
  // dari pemutar musik mana pun, dan garisnya jadi selebar mungkin.
  if (size === 'lg') {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center">{line}</div>
        <div className="flex items-center justify-between">
          {clock(elapsed)}
          {clock(totalSeconds)}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {line}
      <span className="shrink-0 text-xs text-muted tabular-nums">
        {formatClock(elapsed)} / {formatClock(totalSeconds)}
      </span>
    </div>
  );
}
