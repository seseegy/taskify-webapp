// =============================================================================
// Edge Function: send-reminders
// =============================================================================
// Dua mode:
//   1. CRON  — header `x-cron-secret: <CRON_SECRET>` (dari pg_cron tiap menit).
//              Klaim pengingat jatuh tempo → kirim Web Push ke perangkat pemiliknya.
//   2. TES   — header `Authorization: Bearer <JWT user>` + body {"test": true}
//              (tombol "Kirim notifikasi uji" di Pengaturan).
//
// Secret yang dibutuhkan (`supabase secrets set ...`, lihat docs/SETUP.md §7):
//   VAPID_KEYS_JSON   JSON {publicKey, privateKey} format JWK (scripts/generate-vapid-keys.mjs)
//   VAPID_SUBJECT     mis. "mailto:kamu@email.com"
//   CRON_SECRET       string acak, sama dengan yang disimpan di Vault untuk pg_cron
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';
import { processReminders } from './process.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const VAPID_KEYS_JSON = Deno.env.get('VAPID_KEYS_JSON') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DueReminder {
  task_id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  remind_at: string;
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

let appServerPromise: Promise<webpush.ApplicationServer> | null = null;

function getAppServer() {
  appServerPromise ??= (async () => {
    if (!VAPID_KEYS_JSON) throw new Error('VAPID_KEYS_JSON belum di-set');
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(VAPID_KEYS_JSON));
    return webpush.ApplicationServer.new({ contactInformation: VAPID_SUBJECT, vapidKeys });
  })();
  return appServerPromise;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET) {
      return json(await runCron());
    }

    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (token) {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json().catch(() => ({}));
      if (body?.test === true) return json(await runTest(data.user.id));
      return json({ error: 'Bad request' }, 400);
    }

    return json({ error: 'Unauthorized' }, 401);
  } catch (e) {
    console.error('[send-reminders]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Batas kerja satu eksekusi cron. Edge Function punya batas waktu; berhenti sebelum itu agar
// pengingat yang belum sempat diproses diklaim ulang dengan bersih (bukan mati di tengah push).
const TIME_BUDGET_MS = 90_000;
const PUSH_TIMEOUT_MS = 10_000;
// Ditandai terkirim tiap sekian pengingat, bukan sekali di akhir: jika fungsi mati di tengah batch,
// paling banyak satu kelompok kecil yang terkirim ulang (bukan seluruh batch).
const MARK_BATCH = 5;

async function runCron() {
  const { data, error } = await admin.rpc('claim_due_reminders', { p_limit: 200 });
  if (error) throw error;
  const reminders = (data ?? []) as DueReminder[];

  // Sesekali (±1x/jam) bersihkan log lama
  if (new Date().getUTCMinutes() === 0) await admin.rpc('prune_reminder_log');

  if (reminders.length === 0) return { reminders: 0, sent: 0, removed: 0, delivered: 0, retry: 0 };

  const userIds = [...new Set(reminders.map((r) => r.user_id))];
  const result = await processReminders(reminders, {
    subsByUser: await loadSubscriptions(userIds),
    send: (sub, r) => sendPush(sub, buildReminderPayload(r)),
    mark: async (batch) => {
      const { error: markError } = await admin.rpc('mark_reminders_delivered', {
        p_task_ids: batch.map((r) => r.task_id),
        p_remind_ats: batch.map((r) => r.remind_at),
      });
      // Push sudah terkirim, jadi jangan dilempar. Tetapi kegagalan ini berarti baris tetap
      // "belum terkirim" dan akan diklaim ulang (sampai 4 kali lagi) → terkirim berulang. Perlu
      // dilihat di log bila sering muncul.
      if (markError) console.error('[send-reminders] gagal menandai terkirim', markError.message);
      return !markError;
    },
    budgetMs: TIME_BUDGET_MS,
    markBatch: MARK_BATCH,
  });
  return { reminders: reminders.length, ...result };
}

async function runTest(userId: string) {
  const subs = (await loadSubscriptions([userId])).get(userId) ?? [];
  let sent = 0;
  for (const sub of subs) {
    const result = await sendPush(sub, {
      title: '🔔 Notifikasi Taskify aktif',
      body: 'Pengingat tugas akan muncul seperti ini.',
      url: '/tugas',
      tag: 'taskify-test',
    });
    if (result === 'sent') sent++;
  }
  return { devices: subs.length, sent };
}

async function loadSubscriptions(userIds: string[]) {
  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds);
  if (error) throw error;

  const map = new Map<string, Subscription[]>();
  for (const s of (data ?? []) as Subscription[]) {
    map.set(s.user_id, [...(map.get(s.user_id) ?? []), s]);
  }
  return map;
}

async function sendPush(
  sub: Subscription,
  payload: PushPayload,
): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const server = await getAppServer();
    const subscriber = server.subscribe({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    });
    // Layanan push yang menggantung tidak boleh menahan seluruh batch.
    await withTimeout(
      subscriber.pushTextMessage(JSON.stringify(payload), {
        urgency: webpush.Urgency.High,
        ttl: 60 * 60 * 12,
        // Topic (RFC 8030, maks 32 char): pesan baru dengan topic sama menggantikan yang belum terkirim
        topic: payload.tag.replace(/[^A-Za-z0-9]/g, '').slice(-32),
      }),
      PUSH_TIMEOUT_MS,
    );
    await admin
      .from('push_subscriptions')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', sub.id);
    return 'sent';
  } catch (e) {
    const status = e instanceof webpush.PushMessageError ? e.response.status : 0;
    if (status === 404 || status === 410) {
      // Langganan sudah tidak berlaku (browser di-uninstall / izin dicabut)
      await admin.from('push_subscriptions').delete().eq('id', sub.id);
      return 'gone';
    }
    console.error('[send-reminders] push gagal', status, String(e));
    return 'failed';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Tanggal hari ini di WIB (UTC+7, tanpa DST). */
function todayWib() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function dayLabel(date: string) {
  const today = todayWib();
  const tomorrow = new Date(Date.parse(today) + 86400_000).toISOString().slice(0, 10);
  if (date === today) return 'Hari ini';
  if (date === tomorrow) return 'Besok';
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function buildReminderPayload(r: DueReminder): PushPayload {
  const parts: string[] = [];
  if (r.due_date) parts.push(dayLabel(r.due_date));
  if (r.due_time) parts.push(`pukul ${r.due_time.slice(0, 5)}`);
  return {
    title: `⏰ ${r.title}`,
    body: parts.length ? `Jatuh tempo ${parts.join(' ')}` : 'Pengingat tugas',
    url: `/tugas?task=${r.task_id}`,
    tag: `task-${r.task_id}`,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
