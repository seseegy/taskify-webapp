// =============================================================================
// Edge Function: files — gerbang aman ke Cloudflare R2
// =============================================================================
// Key R2 HANYA ada di sini (secret). Browser hanya menerima presigned URL berumur pendek.
//
// Mode user (Authorization: Bearer <JWT Supabase>), body JSON:
//   { action: 'upload',   key, size, contentType } → { url }  (PUT, berlaku 15 menit)
//   { action: 'download', key, fileName? }         → { url }  (GET, berlaku 10 menit)
//   { action: 'delete',   key }                    → { ok }
// Keamanan: setiap key WAJIB berawalan "<user_id>/" → user hanya bisa menyentuh miliknya.
// Ukuran maksimal 100 MB ditegakkan dengan menandatangani header Content-Length.
//
// Mode cron (header x-cron-secret): { action: 'cleanup' } → hapus lampiran kedaluwarsa &
// objek yatim (lihat migrasi 20261007000100_attachments_cleanup.sql).
//
// Secret: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, CRON_SECRET
// Opsional: R2_ENDPOINT (default https://<account>.r2.cloudflarestorage.com)
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_TTL = 15 * 60;
const DOWNLOAD_TTL = 10 * 60;

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = env('CRON_SECRET');
const BUCKET = env('R2_BUCKET');
const ENDPOINT = (
  env('R2_ENDPOINT') || `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
).replace(/\/$/, '');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const objectUrl = (key: string) =>
  `${ENDPOINT}/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Key valid: "<uuid user>/<uuid lampiran>/<nama file>" tanpa ".." */
const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]{1,255}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    if (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET) {
      if (body.action === 'cleanup') return json(await cleanup());
      return json({ error: 'Bad request' }, 400);
    }

    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Unauthorized' }, 401);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ error: 'Unauthorized' }, 401);
    const userId = data.user.id;

    const key = String(body.key ?? '');
    if (!KEY_RE.test(key) || key.includes('..') || !key.startsWith(`${userId}/`)) {
      return json({ error: 'Key tidak valid' }, 403);
    }

    switch (body.action) {
      case 'upload': {
        const size = Number(body.size);
        if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) {
          return json({ error: 'Ukuran file harus 1 byte – 100 MB' }, 400);
        }
        const signed = await r2.sign(
          new Request(`${objectUrl(key)}?X-Amz-Expires=${UPLOAD_TTL}`, {
            method: 'PUT',
            // Content-Length ikut ditandatangani → browser wajib mengirim ukuran yang sama
            headers: { 'content-length': String(size) },
          }),
          { aws: { signQuery: true, allHeaders: true } },
        );
        return json({ url: signed.url, expiresIn: UPLOAD_TTL });
      }
      case 'download': {
        const name = String(body.fileName ?? key.split('/').pop() ?? 'file');
        const disposition = `${body.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`;
        const url = new URL(objectUrl(key));
        url.searchParams.set('X-Amz-Expires', String(DOWNLOAD_TTL));
        url.searchParams.set('response-content-disposition', disposition);
        const signed = await r2.sign(new Request(url, { method: 'GET' }), {
          aws: { signQuery: true },
        });
        return json({ url: signed.url, expiresIn: DOWNLOAD_TTL });
      }
      case 'delete': {
        const res = await r2.fetch(objectUrl(key), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) return json({ error: `R2 ${res.status}` }, 502);
        return json({ ok: true });
      }
      default:
        return json({ error: 'Aksi tidak dikenal' }, 400);
    }
  } catch (e) {
    console.error('[files]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function cleanup() {
  // 1) Lampiran kedaluwarsa menurut database
  const { data, error } = await admin.rpc('attachments_to_purge', { p_limit: 500 });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; storage_key: string }[];
  const removed: string[] = [];
  for (const row of rows) {
    const res = await r2.fetch(objectUrl(row.storage_key), { method: 'DELETE' });
    if (res.ok || res.status === 404) removed.push(row.id);
  }
  if (removed.length) {
    const { error: e2 } = await admin.rpc('purge_attachments', { p_ids: removed });
    if (e2) throw e2;
  }

  // 2) Objek yatim: ada di R2 tetapi tidak punya baris, dan berumur > 2 hari
  let orphans = 0;
  const list = await r2.fetch(`${ENDPOINT}/${BUCKET}?list-type=2&max-keys=1000`);
  if (list.ok) {
    const xml = await list.text();
    const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
      key: decodeXml(m[1]!.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? ''),
      modified: Date.parse(m[1]!.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? ''),
    }));
    const old = objects.filter((o) => o.key && Date.now() - o.modified > 2 * 86400_000);
    if (old.length) {
      const { data: known, error: e3 } = await admin.rpc('attachment_keys', {
        p_keys: old.map((o) => o.key),
      });
      if (e3) throw e3;
      const knownSet = new Set((known ?? []) as string[]);
      for (const o of old) {
        if (knownSet.has(o.key)) continue;
        const res = await r2.fetch(objectUrl(o.key), { method: 'DELETE' });
        if (res.ok) orphans++;
      }
    }
  }
  return { purged: removed.length, orphans };
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
