import { formatLocalDate } from '@/lib/date';
import { formatDecimal } from '@/lib/number';
import type { MoodPoint } from '../journal-queries';
import { moodOf } from '../mood';

const W = 300;
const H = 110;
const PAD = 10;

/** Garis mood 30 hari (SVG). Hari tanpa jurnal = celah pada garis. */
export function MoodChart({ points }: { points: MoodPoint[] }) {
  const step = (W - PAD * 2) / Math.max(1, points.length - 1);
  const y = (m: number) => H - PAD - ((m - 1) / 4) * (H - PAD * 2);
  const x = (i: number) => PAD + i * step;

  // Segmen garis: putus di hari tanpa mood
  const segments: string[] = [];
  let current = '';
  points.forEach((p, i) => {
    if (p.mood === null) {
      if (current) segments.push(current);
      current = '';
    } else {
      current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`;
    }
  });
  if (current) segments.push(current);

  // Penghubung tipis antar titik yang terpisah hari kosong
  const bridge = points
    .map((p, i) => (p.mood === null ? null : `${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  // Teks alternatif: ringkasan singkat sebagai nama grafik + tabel lengkap untuk pembaca layar
  const recorded = points.filter((p): p is MoodPoint & { mood: number } => p.mood !== null);
  const avg = recorded.length
    ? recorded.reduce((sum, p) => sum + p.mood, 0) / recorded.length
    : null;
  const avgText = avg === null ? null : formatDecimal(avg);
  const summary =
    avg === null
      ? `Grafik mood ${points.length} hari terakhir: belum ada data`
      : `Grafik mood ${points.length} hari terakhir: ${recorded.length} hari tercatat, rata-rata ${avgText} (${moodOf(Math.round(avg))?.label ?? ''})`;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label={summary}>
        <defs>
          <linearGradient
            id="moodLine"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={PAD}
            x2="0"
            y2={H - PAD}
          >
            <stop offset="0" stopColor="#10b981" />
            <stop offset="0.5" stopColor="#eab308" />
            <stop offset="1" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
        {[1, 2, 3, 4, 5].map((m) => (
          <line
            key={m}
            x1={PAD}
            x2={W - PAD}
            y1={y(m)}
            y2={y(m)}
            stroke="currentColor"
            className="text-line"
            strokeDasharray="2 4"
          />
        ))}
        {bridge && (
          <polyline
            points={bridge}
            fill="none"
            stroke="url(#moodLine)"
            strokeWidth={1.5}
            strokeDasharray="3 4"
            opacity={0.6}
          />
        )}
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="url(#moodLine)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {points.map((p, i) =>
          p.mood === null ? null : (
            <circle
              key={p.day}
              cx={x(i)}
              cy={y(p.mood)}
              r={3.5}
              fill={moodOf(p.mood)?.color}
              stroke="white"
              strokeWidth={1.2}
            >
              <title>{`${formatLocalDate(p.day, 'd MMM')}: ${moodOf(p.mood)?.label}`}</title>
            </circle>
          ),
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between gap-2 text-xs text-muted" aria-hidden="true">
        <span>{points.length > 0 ? formatLocalDate(points[0]!.day, 'd MMM') : ''}</span>
        <span>Makin tinggi = makin senang</span>
        <span>
          {points.length > 0 ? formatLocalDate(points[points.length - 1]!.day, 'd MMM') : ''}
        </span>
      </figcaption>
      {recorded.length > 0 && (
        <div className="sr-only">
          {/* <table> mengabaikan width/height `sr-only`; dibungkus div 1×1px agar tidak memperpanjang area scroll */}
          <table>
            <caption>Data mood {points.length} hari terakhir</caption>
            <thead>
              <tr>
                <th scope="col">Tanggal</th>
                <th scope="col">Mood</th>
              </tr>
            </thead>
            <tbody>
              {recorded.map((p) => (
                <tr key={p.day}>
                  <td>{formatLocalDate(p.day, 'EEEE, d MMMM yyyy')}</td>
                  <td>{moodOf(p.mood)?.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
