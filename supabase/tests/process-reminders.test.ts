import { describe, expect, it } from 'vitest';
import {
  processReminders,
  type ProcessDeps,
  type PushResult,
  type Reminder,
} from '../functions/send-reminders/process';

const rem = (n: number, user = 'u1'): Reminder => ({
  task_id: `t${n}`,
  user_id: user,
  remind_at: `2026-10-07T01:0${n}:00+00:00`,
});

function harness(opts: {
  subs?: Record<string, string[]>;
  results?: Record<string, PushResult>;
  markOk?: boolean;
  tick?: number;
}) {
  const marked: string[][] = [];
  const sentTo: string[] = [];
  let clock = 0;
  const deps: ProcessDeps<Reminder, string> = {
    subsByUser: new Map(Object.entries(opts.subs ?? { u1: ['phone'] })),
    send: async (sub, r) => {
      sentTo.push(`${r.task_id}@${sub}`);
      clock += opts.tick ?? 0;
      return opts.results?.[sub] ?? 'sent';
    },
    mark: async (batch) => {
      marked.push(batch.map((r) => r.task_id));
      return opts.markOk ?? true;
    },
    now: () => clock,
    budgetMs: 1000,
    markBatch: 2,
  };
  return { deps, marked, sentTo };
}

describe('processReminders', () => {
  it('push sukses → ditandai terkirim, per kelompok kecil (bukan sekali di akhir)', async () => {
    const h = harness({});
    const r = await processReminders([rem(1), rem(2), rem(3), rem(4), rem(5)], h.deps);
    expect(h.marked).toEqual([['t1', 't2'], ['t3', 't4'], ['t5']]);
    expect(r).toMatchObject({ sent: 5, delivered: 5, retry: 0, stoppedEarly: false });
  });

  it('push gagal sementara di satu-satunya perangkat → TIDAK ditandai (diklaim ulang)', async () => {
    const h = harness({ results: { phone: 'failed' } });
    const r = await processReminders([rem(1)], h.deps);
    expect(h.marked).toEqual([]);
    expect(r).toMatchObject({ sent: 0, delivered: 0, retry: 1 });
  });

  it('sukses di satu perangkat walau perangkat lain gagal → selesai', async () => {
    const h = harness({
      subs: { u1: ['phone', 'laptop'] },
      results: { phone: 'sent', laptop: 'failed' },
    });
    const r = await processReminders([rem(1)], h.deps);
    expect(r).toMatchObject({ sent: 1, delivered: 1, retry: 0 });
  });

  it('user tanpa langganan → selesai (tidak ada tujuan, bukan kegagalan)', async () => {
    const h = harness({ subs: {} });
    const r = await processReminders([rem(1)], h.deps);
    expect(h.sentTo).toEqual([]);
    expect(r).toMatchObject({ delivered: 1, retry: 0 });
  });

  it('semua langganan sudah tidak berlaku (404/410) → selesai, dihitung removed', async () => {
    const h = harness({ results: { phone: 'gone' } });
    const r = await processReminders([rem(1)], h.deps);
    expect(r).toMatchObject({ removed: 1, delivered: 1, retry: 0 });
  });

  it('satu langganan kedaluwarsa + satu gagal sementara → belum selesai', async () => {
    const h = harness({
      subs: { u1: ['old', 'laptop'] },
      results: { old: 'gone', laptop: 'failed' },
    });
    const r = await processReminders([rem(1)], h.deps);
    expect(r).toMatchObject({ removed: 1, delivered: 0, retry: 1 });
  });

  it('gagal menandai di database → tidak dihitung delivered (akan diklaim ulang)', async () => {
    const h = harness({ markOk: false });
    const r = await processReminders([rem(1), rem(2)], h.deps);
    expect(r).toMatchObject({ sent: 2, delivered: 0, retry: 2 });
  });

  it('kehabisan anggaran waktu → berhenti memulai pengingat baru; yang sudah selesai tetap ditandai', async () => {
    const h = harness({ tick: 600 }); // tiap push memakan 600 ms, anggaran 1000 ms
    const r = await processReminders([rem(1), rem(2), rem(3), rem(4)], h.deps);
    // t1 (600ms) dan t2 (1200ms) diproses; sebelum t3 waktu sudah lewat anggaran
    expect(h.sentTo).toEqual(['t1@phone', 't2@phone']);
    expect(r).toMatchObject({ delivered: 2, retry: 2, stoppedEarly: true });
    expect(h.marked).toEqual([['t1', 't2']]);
  });

  it('daftar kosong aman', async () => {
    const h = harness({});
    expect(await processReminders([], h.deps)).toMatchObject({ delivered: 0, retry: 0 });
  });
});
