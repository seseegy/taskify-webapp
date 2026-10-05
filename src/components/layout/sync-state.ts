import { useStatus } from '@powersync/react';

export type SyncState = 'offline' | 'syncing' | 'uploading' | 'synced' | 'connecting';

/** Turunkan satu status ringkas dari SyncStatus PowerSync. */
export function useSyncState() {
  const status = useStatus();
  const flow = status.dataFlowStatus;

  let state: SyncState;
  if (!status.connected) state = status.connecting ? 'connecting' : 'offline';
  else if (flow.uploading) state = 'uploading';
  else if (flow.downloading || !status.hasSynced) state = 'syncing';
  else state = 'synced';

  return { state, lastSyncedAt: status.lastSyncedAt, status };
}
