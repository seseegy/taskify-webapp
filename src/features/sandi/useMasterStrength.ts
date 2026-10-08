import { useEffect, useMemo, useState } from 'react';
import {
  ensureStrengthEngine,
  evaluateMasterPassword,
  isStrengthEngineReady,
  type MasterStrength,
} from './master-password';

const DEBOUNCE_MS = 200;

/**
 * Kekuatan master password untuk meter. `null` selama pemeriksa (kamus) masih dimuat; layar
 * tidak boleh menampilkan penilaian pengganti yang lebih longgar. Pemeriksa dimuat begitu layar
 * muncul, jadi biasanya sudah siap sebelum pengguna selesai mengetik.
 */
export function useMasterStrength(password: string, userInputs: string[]): MasterStrength | null {
  const [ready, setReady] = useState(isStrengthEngineReady);

  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    ensureStrengthEngine().then(
      () => !cancelled && setReady(true),
      () => undefined, // gerbang `masterPasswordProblem` yang melaporkan kegagalan saat submit
    );
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // Penilaian sandi acak panjang bisa puluhan ms; tunda sampai pengguna berhenti mengetik sebentar.
  const [settled, setSettled] = useState(password);
  useEffect(() => {
    const t = setTimeout(() => setSettled(password), password ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [password]);

  const key = userInputs.join('\u0000');
  return useMemo(
    () => (ready && settled ? evaluateMasterPassword(settled, userInputs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` mewakili isi `userInputs`
    [ready, settled, key],
  );
}
