import { Clock3, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getClockOffset, isClockSkewed } from '../totp-clock';
import { useTotpWindow } from '../useTotpWindow';
import type { TotpConfig } from '../totp';
import { CopyButton } from './CopyButton';

/** Di bawah ini kode hampir habis: tampilkan juga kode berikutnya. */
const NEXT_HINT_MS = 5_000;

/** "123456" → "123 456" (8 digit → "1234 5678"), lebih mudah dibaca saat mengetik ulang. */
function groupCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

export function TotpCode({
  config,
  name,
  onUse,
  size = 'md',
}: {
  config: TotpConfig;
  /** Nama akun, untuk label aksesibel dan catatan riwayat. */
  name: string;
  /** Dipanggil setelah kode berhasil disalin — mencatat pemakaian ke riwayat. */
  onUse?: (code: string) => void;
  size?: 'md' | 'lg';
}) {
  const win = useTotpWindow(config);
  const skewed = isClockSkewed();

  if (!win)
    return (
      <p className="flex items-center gap-2 text-sm text-warning">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        Kunci TOTP tidak bisa dibaca. Perbaiki di layar ubah.
      </p>
    );

  const seconds = Math.ceil(win.remainingMs / 1000);
  const fraction = win.remainingMs / (win.period * 1000);
  const almostGone = win.remainingMs <= NEXT_HINT_MS;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'font-mono font-extrabold tabular-nums',
            size === 'lg' ? 'text-3xl tracking-wider' : 'text-2xl tracking-wide',
            almostGone ? 'text-warning' : 'text-fg',
          )}
          aria-label={`Kode ${name}: ${win.code.split('').join(' ')}`}
        >
          {groupCode(win.code)}
        </span>

        {/* Hitung mundur: cincin + angka detik, jadi tidak bergantung warna saja */}
        <span
          role="timer"
          aria-label="Sisa waktu kode"
          aria-valuetext={`${seconds} detik`}
          title={`Berganti dalam ${seconds} detik`}
          className="relative grid size-9 shrink-0 place-items-center"
        >
          <svg viewBox="0 0 36 36" className="absolute size-9 -rotate-90" aria-hidden="true">
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              strokeWidth="3"
              className="stroke-muted/25"
            />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 16}
              strokeDashoffset={2 * Math.PI * 16 * (1 - fraction)}
              className={cn(
                'transition-[stroke-dashoffset] duration-1000 ease-linear',
                almostGone ? 'stroke-warning' : 'stroke-primary',
              )}
            />
          </svg>
          <span className="text-[11px] font-bold tabular-nums">{seconds}</span>
        </span>

        <CopyButton
          value={win.code}
          label={`Salin kode ${name}`}
          what="Kode"
          secret
          showLabel={size === 'lg'}
          onCopied={() => onUse?.(win.code)}
        />
      </div>

      {almostGone && (
        <p className="flex items-center gap-1.5 text-xs text-muted" role="status">
          <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
          Berikutnya <span className="font-mono font-semibold">{groupCode(win.next)}</span>
        </p>
      )}

      {skewed && (
        <p className="flex items-start gap-1.5 text-xs text-warning" role="alert">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Jam perangkat ini selisih {Math.round(getClockOffset() / 1000)} detik dari server. Kode
          bisa ditolak — betulkan jam perangkat.
        </p>
      )}
    </div>
  );
}

/** Lencana kecil di daftar brankas: item ini punya kode TOTP. */
export function TotpBadge() {
  return (
    <span
      title="Punya kode TOTP"
      className="flex items-center gap-1 rounded-lg bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
    >
      <ShieldCheck className="size-3" aria-hidden="true" />
      <span className="sr-only">Punya kode TOTP</span>
      2FA
    </span>
  );
}
