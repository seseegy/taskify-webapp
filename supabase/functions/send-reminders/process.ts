// =============================================================================
// Orkestrasi pengiriman pengingat — MURNI (tanpa impor eksternal) agar bisa diuji Vitest
// (supabase/tests/process-reminders.test.ts) walau Edge Function berjalan di Deno.
// =============================================================================

export type PushResult = 'sent' | 'gone' | 'failed';

export interface Reminder {
  task_id: string;
  user_id: string;
  remind_at: string;
}

export interface ProcessDeps<R extends Reminder, S> {
  /** Langganan push per user */
  subsByUser: Map<string, S[]>;
  /** Kirim satu push */
  send: (sub: S, reminder: R) => Promise<PushResult>;
  /** Tandai sekelompok pengingat terkirim di database. true = berhasil. */
  mark: (batch: R[]) => Promise<boolean>;
  now?: () => number;
  /** Berhenti memulai pengingat baru setelah ini (ms) agar tidak mati di tengah push */
  budgetMs?: number;
  /** Tandai terkirim tiap sekian pengingat, bukan sekali di akhir */
  markBatch?: number;
}

export interface ProcessResult {
  sent: number;
  removed: number;
  delivered: number;
  /** Pengingat yang tidak ditandai terkirim → diklaim ulang database */
  retry: number;
  stoppedEarly: boolean;
}

/**
 * Aturan "selesai" per pengingat:
 *  - ada ≥ 1 push yang terkirim → selesai
 *  - user tanpa langganan → selesai (tidak ada tujuan; bukan kegagalan)
 *  - semua langganan sudah tidak berlaku (404/410) dan tak ada yang gagal sementara → selesai
 *  - selain itu (gagal sementara di semua perangkat) → TIDAK selesai, akan diklaim ulang
 */
export async function processReminders<R extends Reminder, S>(
  reminders: R[],
  deps: ProcessDeps<R, S>,
): Promise<ProcessResult> {
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? 90_000;
  const markBatch = deps.markBatch ?? 5;
  const startedAt = now();

  let sent = 0;
  let removed = 0;
  let delivered = 0;
  let stoppedEarly = false;
  let pending: R[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    if (await deps.mark(batch)) delivered += batch.length;
  };

  for (const r of reminders) {
    if (now() - startedAt > budgetMs) {
      stoppedEarly = true;
      break; // sisanya diklaim ulang 3 menit lagi
    }
    const subs = deps.subsByUser.get(r.user_id) ?? [];
    let done = subs.length === 0;
    let failed = false;
    for (const sub of subs) {
      const result = await deps.send(sub, r);
      if (result === 'sent') {
        sent++;
        done = true;
      } else if (result === 'gone') {
        removed++;
      } else {
        failed = true;
      }
    }
    if (!done && !failed) done = true;
    if (done) {
      pending.push(r);
      if (pending.length >= markBatch) await flush();
    }
  }
  await flush();

  return { sent, removed, delivered, retry: reminders.length - delivered, stoppedEarly };
}
