import { useCallback, useEffect, useState } from 'react';

export interface StorageInfo {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

async function readStorageInfo(): Promise<StorageInfo> {
  const storage = navigator.storage;
  const [persisted, estimate] = await Promise.all([
    storage?.persisted?.() ?? Promise.resolve(null),
    storage?.estimate?.() ?? Promise.resolve(null),
  ]);
  return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
}

/** Status penyimpanan browser: apakah persisten (tidak akan dihapus otomatis) & pemakaian. */
export function useStorageInfo() {
  const [info, setInfo] = useState<StorageInfo>({ persisted: null, usage: null, quota: null });

  useEffect(() => {
    let alive = true;
    void readStorageInfo().then((next) => alive && setInfo(next));
    return () => {
      alive = false;
    };
  }, []);

  const requestPersist = useCallback(async () => {
    await navigator.storage?.persist?.();
    setInfo(await readStorageInfo());
  }, []);

  return { info, requestPersist };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${units[unit]}`;
}
