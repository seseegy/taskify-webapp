import { wrapPowerSyncWithDrizzle, type PowerSyncSQLiteDatabase } from '@powersync/drizzle-driver';
import { createConsoleLogger, LogLevels, PowerSyncDatabase, WASQLiteVFS } from '@powersync/web';
import { AppSchema, drizzleSchema } from './schema';
import { setupSearchIndex } from './search-index';

export type AppDatabase = PowerSyncSQLiteDatabase<typeof drizzleSchema>;

export interface DatabaseHandle {
  powerSync: PowerSyncDatabase;
  db: AppDatabase;
  vfs: WASQLiteVFS;
  /** true jika indeks FTS5 aktif (lihat search-index.ts) */
  fts: boolean;
}

const DB_FILENAME = 'taskify.db';

/**
 * Cek apakah OPFS benar-benar bisa dipakai (bukan sekadar API-nya ada).
 * Safari Private Browsing mengekspos API OPFS tetapi menolak getDirectory().
 */
async function isOPFSUsable(): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage?.getDirectory !== 'function' ||
    typeof Worker !== 'function'
  ) {
    return false;
  }
  try {
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

let handlePromise: Promise<DatabaseHandle> | null = null;

/**
 * Membuka database lokal (singleton). Belum terhubung ke server —
 * koneksi sync dilakukan oleh PowerSyncProvider setelah user login.
 *
 * VFS: OPFSCoopSyncVFS (cepat, multi-tab, kompatibel Safari) dengan fallback IndexedDB.
 */
export function openDatabase(): Promise<DatabaseHandle> {
  handlePromise ??= (async () => {
    const vfs = (await isOPFSUsable())
      ? WASQLiteVFS.OPFSCoopSyncVFS
      : WASQLiteVFS.IDBBatchAtomicVFS;

    const logger = createConsoleLogger({
      minLevel: import.meta.env.DEV ? LogLevels.debug : LogLevels.warn,
    });

    const powerSync = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: DB_FILENAME, vfs },
      logger,
    });
    await powerSync.init();

    const fts = await setupSearchIndex(powerSync).catch((e: unknown) => {
      console.error('[search] gagal menyiapkan indeks', e);
      return false;
    });

    const db = wrapPowerSyncWithDrizzle(powerSync, { schema: drizzleSchema });
    return { powerSync, db, vfs, fts };
  })();
  return handlePromise;
}
