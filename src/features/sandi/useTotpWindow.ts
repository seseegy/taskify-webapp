import { useEffect, useState } from 'react';
import { clampPeriod, counterAt, totpWindow, type TotpConfig, type TotpWindow } from './totp';
import { totpNow } from './totp-clock';

/**
 * Kode TOTP yang hidup. Dihitung ulang hanya saat periode berganti; sisa waktu diperbarui tiap
 * detik untuk hitung mundur. Memakai jam yang sudah dikoreksi (`totpNow`), bukan `Date.now()`.
 */
export function useTotpWindow(config: TotpConfig) {
  const [win, setWin] = useState<TotpWindow | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const period = clampPeriod(config.period);
  const counter = counterAt(totpNow(), period);

  useEffect(() => {
    let cancelled = false;
    void totpWindow(config, totpNow()).then((w) => {
      if (!cancelled) setWin(w);
    });
    return () => {
      cancelled = true;
    };
    // `counter` memaksa hitung ulang tepat saat periode berganti
  }, [config, counter]);

  if (!win) return null;
  const now = totpNow();
  const remainingMs = Math.max(0, (counterAt(now, period) + 1) * period * 1000 - now);
  return { ...win, remainingMs };
}
