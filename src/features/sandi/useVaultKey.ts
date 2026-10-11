import { useStatus } from '@powersync/react';
import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast-store';
import type { PwKeys } from '@/db/schema';
import { loadTrustedDek } from './device-trust';
import { usePwKey } from './sandi-data';
import { useSandiStore } from './sandi-store';

export type VaultKeyStatus =
  /** Sinkron pertama belum selesai — brankas bisa saja sudah ada tapi belum tiba. */
  | 'syncing'
  /** Belum ada brankas di akun ini. */
  | 'absent'
  /** Sedang memeriksa apakah perangkat ini masih dipercaya. */
  | 'checking'
  | 'locked'
  | 'unlocked';

export interface VaultKeyState {
  status: VaultKeyStatus;
  /** DEK yang SAH untuk record kunci saat ini. `null` bila terkunci atau usang. */
  dek: CryptoKey | null;
  keyRow: PwKeys | null;
}

/**
 * Status kunci brankas Sandi — SATU sumber untuk semua layar yang memakainya (halaman Sandi dan
 * Konfigurasi di Vault).
 *
 * Tugas yang WAJIB hanya ada di sini, supaya tidak ada layar yang lupa melakukannya:
 *
 *  1. **Membuang DEK yang usang.** DEK di memori hanya sah untuk record kunci yang dipakai
 *     membukanya. Begitu `pw_keys.wrapped_key` berubah (kunci diganti / DEK dirotasi di perangkat
 *     mana pun), DEK itu tidak boleh dipakai lagi: data yang ditulis dengannya akan tidak bisa
 *     dibuka setelah sinkron. Kalau pemeriksaan ini hanya ada di satu layar, layar lain bisa
 *     diam-diam menulis dengan kunci usang.
 *  2. **Membuka otomatis untuk perangkat yang dipercaya** ("Ingat perangkat ini 30 hari").
 *
 * `rekeying` dikecualikan: saat perangkat INI yang sedang mengganti kunci, record memang berubah
 * dengan sengaja dan DEK barunya sudah dipasang bersama record-nya.
 */
export function useVaultKey(): VaultKeyState {
  const { row, isLoading } = usePwKey();
  const hasSynced = Boolean(useStatus().hasSynced);
  const storedDek = useSandiStore((s) => s.dek);
  const stamp = useSandiStore((s) => s.stamp);
  const rekeying = useSandiStore((s) => s.rekeying);
  const unlock = useSandiStore((s) => s.unlock);

  const keyRow = row ?? null;
  const currentStamp = keyRow?.wrapped_key;

  // --- kepercayaan perangkat: coba buka tanpa master password
  const [trustChecked, setTrustChecked] = useState(false);
  useEffect(() => {
    if (!currentStamp || storedDek) return;
    let cancelled = false;
    void loadTrustedDek(currentStamp).then((key) => {
      if (cancelled) return;
      if (key) unlock(key, currentStamp);
      setTrustChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [currentStamp, storedDek, unlock]);

  // --- DEK usang: kunci dan minta buka lagi
  const stale = storedDek !== null && keyRow !== null && stamp !== keyRow.wrapped_key && !rekeying;
  useEffect(() => {
    if (!stale) return;
    const s = useSandiStore.getState();
    if (s.dek && !s.rekeying && s.stamp !== currentStamp) {
      s.lock();
      toast('Kunci brankas diganti di perangkat lain. Buka lagi dengan master password terbaru.');
    }
  }, [stale, currentStamp]);

  const dek = stale ? null : storedDek;

  const status: VaultKeyStatus =
    isLoading || (!keyRow && !hasSynced)
      ? 'syncing'
      : !keyRow
        ? 'absent'
        : dek
          ? 'unlocked'
          : trustChecked
            ? 'locked'
            : 'checking';

  return { status, dek, keyRow };
}
