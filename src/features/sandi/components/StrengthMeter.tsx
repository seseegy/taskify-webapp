import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Strength } from '../generator';

/**
 * Meter kekuatan. Tidak bergantung pada warna saja: ada label teks, ikon berbeda, dan angka bit;
 * pembaca layar mendapat nilai lewat role="meter".
 */
export function StrengthMeter({
  strength,
  issues = [],
  className,
}: {
  strength: Strength;
  issues?: string[];
  className?: string;
}) {
  const color =
    strength.score <= 1 ? 'bg-danger' : strength.score === 2 ? 'bg-warning' : 'bg-success';
  const Icon = strength.score <= 1 ? ShieldAlert : strength.score === 2 ? Shield : ShieldCheck;
  const filled = Math.max(1, strength.score);

  return (
    <div className={className}>
      <div
        role="meter"
        aria-label="Kekuatan sandi"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength.score}
        aria-valuetext={`${strength.label}, sekitar ${Math.round(strength.bits)} bit`}
        className="flex gap-1"
      >
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i <= filled ? color : 'bg-muted/25',
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="size-3.5" aria-hidden="true" />
        {strength.label}
        <span className="font-normal text-muted">· ±{Math.round(strength.bits)} bit</span>
      </p>
      {issues.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
