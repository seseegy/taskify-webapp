import { createContext, useContext } from 'react';
import type { DatabaseHandle } from './database';

export const DatabaseContext = createContext<DatabaseHandle | null>(null);

/** Akses database lokal (Drizzle `db` + instance `powerSync`). Hanya di dalam PowerSyncProvider. */
export function useDatabase(): DatabaseHandle {
  const handle = useContext(DatabaseContext);
  if (!handle) throw new Error('useDatabase() harus dipakai di dalam <PowerSyncProvider>');
  return handle;
}
