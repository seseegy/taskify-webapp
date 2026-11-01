// =============================================================================
// Edge Function: tempfiles — simpan berkas di R2 & bagikan lewat tautan publik
// =============================================================================
// Pemilik (Authorization: Bearer <JWT Supabase aal2>), POST JSON:
//   { action: 'create',   name, size, mime?, expiry }  → { file, uploadUrl }   (PUT 15–60 menit)
//   { action: 'complete', id }                         → { file }              (ukuran objek dicek)
//   { action: 'update',   id, name?, isPublic?, expiry?, regenerate? } → { file }
//   { action: 'delete',   id }                         → { ok }                (tautan mati seketika)
//   { action: 'download', id }                         → { url }               (presigned GET, 5 menit)
//
// Publik (tanpa login):
//   POST { action: 'info', token }                     → { file_name, size_bytes, … }
//   GET  /functions/v1/tempfiles/d/<token>             → 302 ke presigned GET (dihitung 1 unduhan)
//
// Cron (header x-cron-secret): POST { action: 'cleanup' } → hapus yang kedaluwarsa/dihapus/
//   ditinggalkan + objek yatim di prefix temp/.
//
// Keamanan:
//   * Semua tulisan memakai fungsi SQL service_role (kuota atomik per akun, lihat migrasi
//     …_temp_files.sql); setiap fungsi menerima user_id dari JWT yang sudah divalidasi, BUKAN
//     dari body.
//   * Akun ber-MFA wajib token aal2 (../_shared/mfa.ts), sama dengan RLS.
//   * Ukuran ditegakkan dengan menandatangani Content-Length, lalu DIPERIKSA lagi di R2 (HEAD)
//     sebelum berkas dianggap siap.
//   * Unduhan SELALU `attachment` + application/octet-stream: berkas publik tidak pernah
//     ditampilkan/dijalankan sebagai halaman.
//   * Pesan error internal tidak dikirim ke klien.
//
// Secret: R2_* (lihat ../_shared/r2.ts), CRON_SECRET
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { mfaRequirementMet } from '../_shared/mfa.ts';
import { bucketUrl, objectUrl, parseListing, r2, decodeXml } from '../_shared/r2.ts';
import {
  attachmentDisposition,
  DOWNLOAD_TTL_SECONDS,
  expiresAtFor,
  isExpiryOption,
  isShareToken,
  isUuid,
  isValidSize,
  newShareToken,
  safeEqual,
  sanitizeFileName,
  sanitizeMime,
  TEMP_KEY_RE,
  TEMPFILE_ERROR,
  TEMPFILE_ERROR_STATUS,
  tokenFromPath,
  normalizeEtag,
  uploadTtlFor,
} from '../_shared/tempfiles.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const CRON_SECRET = env('CRON_SECRET');
const MAX_LIST_PAGES = 10;
const MAX_ORPHAN_DELETES = 500;

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const PRIVATE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};

type FileRow = {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  status: 'pending' | 'ready';
  etag: string | null;
  share_token: string;
  is_public: boolean;
  expires_at: string | null;
  deleted_at: string | null;
  download_count: number;
  created_at: string;
  updated_at: string;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
const invalid = (msg: string) => new HttpError(400, msg, TEMPFILE_ERROR.invalid);

/** Error dari fungsi SQL (kode TFnnn) → HttpError dengan pesannya; lainnya dilempar apa adanya. */
function fromDb(error: { code?: string; message?: string } | null): never | void {
  if (!error) return;
  const status = error.code ? TEMPFILE_ERROR_STATUS[error.code] : undefined;
  if (status) throw new HttpError(status, error.message ?? 'Ditolak', error.code);
  throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return await publicDownload(new URL(req.url).pathname, req.method === 'GET');
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (safeEqual(req.headers.get('x-cron-secret'), CRON_SECRET)) {
      if (body.action === 'cleanup') return json(await cleanup());
      return json({ error: 'Bad request' }, 400);
    }

    if (body.action === 'info') return json(await publicInfo(body.token));

    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Unauthorized' }, 401);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ error: 'Unauthorized' }, 401);
    if (!mfaRequirementMet(data.user, token))
      return json({ error: 'Verifikasi dua langkah diperlukan' }, 403);
    const userId = data.user.id;

    switch (body.action) {
      case 'create':
        return json(await create(userId, body));
      case 'complete':
        return json(await complete(userId, body.id));
      case 'update':
        return json(await update(userId, body));
      case 'delete':
        return json(await remove(userId, body.id));
      case 'download':
        return json(await ownerDownload(userId, body.id));
      default:
        throw invalid('Aksi tidak dikenal');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error('[tempfiles]', e);
    return json({ error: 'Terjadi kesalahan di server. Coba lagi.' }, 500);
  }
});

// ----------------------------------------------------------------------------- pemilik
async function create(userId: string, body: Record<string, unknown>) {
  if (!isValidSize(body.size)) throw invalid('Ukuran berkas harus 1 byte – 1 GB');
  if (!isExpiryOption(body.expiry)) throw invalid('Masa berlaku tidak dikenal');
  const id = crypto.randomUUID();
  const { data, error } = await admin.rpc('temp_file_reserve', {
    p_user: userId,
    p_id: id,
    p_name: sanitizeFileName(body.name),
    p_mime: sanitizeMime(body.mime),
    p_size: body.size,
    p_expires_at: expiresAtFor(body.expiry, Date.now()),
    p_token: newShareToken((n) => crypto.getRandomValues(new Uint8Array(n))),
  });
  fromDb(error);
  const file = data as FileRow;
  const signed = await r2.sign(
    new Request(`${objectUrl(file.storage_key)}?X-Amz-Expires=${uploadTtlFor(file.size_bytes)}`, {
      method: 'PUT',
      // Content-Length ikut ditandatangani → browser wajib mengirim ukuran yang sama
      headers: { 'content-length': String(file.size_bytes) },
    }),
    { aws: { signQuery: true, allHeaders: true } },
  );
  return { file, uploadUrl: signed.url };
}

async function ownRow(userId: string, id: unknown): Promise<FileRow> {
  if (!isUuid(id)) throw invalid('id tidak valid');
  const { data, error } = await admin
    .from('temp_files')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Berkas tidak ditemukan', TEMPFILE_ERROR.notFound);
  return data as FileRow;
}

async function complete(userId: string, id: unknown) {
  const row = await ownRow(userId, id);
  if (row.status === 'ready') return { file: row };
  const head = await r2.fetch(objectUrl(row.storage_key), { method: 'HEAD' });
  if (head.status === 404)
    throw new HttpError(409, 'Unggahan belum diterima penyimpanan', TEMPFILE_ERROR.sizeMismatch);
  if (!head.ok) throw new Error(`R2 HEAD ${head.status}`);
  if (Number(head.headers.get('content-length')) !== Number(row.size_bytes)) {
    // Tidak sesuai pesanan: buang objek & pesanannya, jangan biarkan memakan kuota
    await r2.fetch(objectUrl(row.storage_key), { method: 'DELETE' });
    await admin.rpc('temp_file_mark_deleted', { p_user: userId, p_id: row.id });
    await admin.rpc('temp_files_purge', { p_ids: [row.id] });
    throw new HttpError(
      422,
      'Ukuran berkas tidak sesuai. Unggah ulang.',
      TEMPFILE_ERROR.sizeMismatch,
    );
  }
  // ETag dicatat: unduhan publik menolak bila objek kemudian ditimpa (presigned PUT masih berlaku)
  const { data, error } = await admin.rpc('temp_file_complete', {
    p_user: userId,
    p_id: row.id,
    p_etag: normalizeEtag(head.headers.get('etag')),
  });
  fromDb(error);
  return { file: data as FileRow };
}

async function update(userId: string, body: Record<string, unknown>) {
  if (!isUuid(body.id)) throw invalid('id tidak valid');
  if (body.name !== undefined && typeof body.name !== 'string') throw invalid('Nama tidak valid');
  if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean')
    throw invalid('isPublic harus boolean');
  if (body.expiry !== undefined && !isExpiryOption(body.expiry))
    throw invalid('Masa berlaku tidak dikenal');
  if (body.regenerate !== undefined && body.regenerate !== true)
    throw invalid('regenerate tidak valid');

  const { data, error } = await admin.rpc('temp_file_update', {
    p_user: userId,
    p_id: body.id,
    p_name: typeof body.name === 'string' ? sanitizeFileName(body.name) : null,
    p_is_public: typeof body.isPublic === 'boolean' ? body.isPublic : null,
    p_set_expiry: body.expiry !== undefined,
    p_expires_at: isExpiryOption(body.expiry) ? expiresAtFor(body.expiry, Date.now()) : null,
    p_token:
      body.regenerate === true
        ? newShareToken((n) => crypto.getRandomValues(new Uint8Array(n)))
        : null,
  });
  fromDb(error);
  return { file: data as FileRow };
}

async function remove(userId: string, id: unknown) {
  if (!isUuid(id)) throw invalid('id tidak valid');
  // 1) Tandai dulu: tautan publik mati SEKETIKA, apa pun hasil langkah berikutnya
  const { data: key, error } = await admin.rpc('temp_file_mark_deleted', {
    p_user: userId,
    p_id: id,
  });
  if (error) throw error;
  if (!key) throw new HttpError(404, 'Berkas tidak ditemukan', TEMPFILE_ERROR.notFound);
  // 2) Objek & baris. Gagal di sini tidak apa-apa: pembersih terjadwal mengulanginya.
  const res = await r2.fetch(objectUrl(String(key)), { method: 'DELETE' });
  if (res.ok || res.status === 404) await admin.rpc('temp_files_purge', { p_ids: [id] });
  return { ok: true };
}

/**
 * Isi objek masih yang diperiksa saat unggahan selesai? Presigned PUT bisa saja dipakai lagi
 * (sampai kedaluwarsa) untuk menimpa berkas yang tautannya sudah dibagikan; yang seperti itu
 * tidak diserahkan ke pengunduh.
 */
async function assertUnchanged(row: { storage_key: string; etag: string | null }) {
  if (!row.etag) return;
  const head = await r2.fetch(objectUrl(row.storage_key), { method: 'HEAD' });
  if (head.status === 404)
    throw new HttpError(
      404,
      'Berkas tidak ditemukan atau sudah kedaluwarsa',
      TEMPFILE_ERROR.notFound,
    );
  if (!head.ok) throw new Error(`R2 HEAD ${head.status}`);
  if (normalizeEtag(head.headers.get('etag')) !== row.etag)
    throw new HttpError(
      409,
      'Isi berkas berubah setelah diunggah; unduhan dihentikan',
      TEMPFILE_ERROR.sizeMismatch,
    );
}

async function presignGet(row: Pick<FileRow, 'storage_key' | 'file_name'>) {
  const url = new URL(objectUrl(row.storage_key));
  url.searchParams.set('X-Amz-Expires', String(DOWNLOAD_TTL_SECONDS));
  url.searchParams.set('response-content-disposition', attachmentDisposition(row.file_name));
  url.searchParams.set('response-content-type', 'application/octet-stream');
  const signed = await r2.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
  return signed.url;
}

async function ownerDownload(userId: string, id: unknown) {
  const row = await ownRow(userId, id);
  if (row.status !== 'ready')
    throw new HttpError(409, 'Unggahan belum selesai', TEMPFILE_ERROR.sizeMismatch);
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now())
    throw new HttpError(410, 'Berkas sudah kedaluwarsa', TEMPFILE_ERROR.expired);
  await assertUnchanged(row);
  return { url: await presignGet(row) };
}

// ----------------------------------------------------------------------------- publik
type Resolved = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  expires_at: string | null;
  created_at: string;
  etag: string | null;
};

async function resolve(token: unknown, count: boolean): Promise<Resolved | null> {
  if (!isShareToken(token)) return null;
  const { data, error } = await admin.rpc('temp_file_resolve', { p_token: token, p_count: count });
  if (error) throw error;
  return ((data ?? []) as Resolved[])[0] ?? null;
}

async function publicInfo(token: unknown) {
  const f = await resolve(token, false);
  if (!f)
    throw new HttpError(
      404,
      'Berkas tidak ditemukan atau sudah kedaluwarsa',
      TEMPFILE_ERROR.notFound,
    );
  // Hanya yang perlu dilihat penerima: tanpa id, key, atau pemilik
  return {
    file_name: f.file_name,
    mime_type: f.mime_type,
    size_bytes: Number(f.size_bytes),
    expires_at: f.expires_at,
    created_at: f.created_at,
  };
}

async function publicDownload(pathname: string, count: boolean): Promise<Response> {
  const f = await resolve(tokenFromPath(pathname), count);
  if (!f)
    return new Response('Berkas tidak ditemukan atau sudah kedaluwarsa.\n', {
      status: 404,
      headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  try {
    await assertUnchanged(f);
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return new Response(`${e.message}.\n`, {
      status: e.status,
      headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  // Key = temp/<id berkas>: URL presigned tidak mengungkap pemilik
  return new Response(null, {
    status: 302,
    headers: { ...PRIVATE, Location: await presignGet(f) },
  });
}

// ----------------------------------------------------------------------------- cron
async function cleanup() {
  // 1) Dihapus, kedaluwarsa, atau pesanan unggah yang ditinggalkan (> 6 jam)
  const { data, error } = await admin.rpc('temp_files_to_purge', { p_limit: 500 });
  if (error) throw error;
  const done: string[] = [];
  for (const row of (data ?? []) as { id: string; storage_key: string }[]) {
    const res = await r2.fetch(objectUrl(row.storage_key), { method: 'DELETE' });
    if (res.ok || res.status === 404) done.push(row.id);
  }
  let purged = 0;
  if (done.length) {
    const { data: n, error: e2 } = await admin.rpc('temp_files_purge', { p_ids: done });
    if (e2) throw e2;
    purged = Number(n ?? 0);
  }

  // 2) Objek yatim di prefix temp/ (unggahan yang barisnya sudah tidak ada), berumur > 1 hari
  const objects: { key: string; modified: number }[] = [];
  let next: string | null = null;
  let listFailed = false;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const params = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000', prefix: 'temp/' });
    if (next) params.set('continuation-token', next);
    const list = await r2.fetch(`${bucketUrl()}?${params}`);
    if (!list.ok) {
      listFailed = true;
      console.error('[tempfiles] ListObjectsV2 gagal', list.status);
      break;
    }
    const xml = await list.text();
    objects.push(...parseListing(xml));
    next = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? decodeXml(
          xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '',
        )
      : null;
    if (!next) break;
  }
  const old = objects.filter(
    (o) => TEMP_KEY_RE.test(o.key) && Date.now() - o.modified > 86_400_000,
  );
  const known = new Set<string>();
  for (let i = 0; i < old.length; i += 500) {
    const { data: keys, error: e3 } = await admin.rpc('temp_file_keys', {
      p_keys: old.slice(i, i + 500).map((o) => o.key),
    });
    if (e3) throw e3;
    for (const k of (keys ?? []) as string[]) known.add(k);
  }
  let orphans = 0;
  for (const o of old) {
    if (known.has(o.key)) continue;
    if (orphans >= MAX_ORPHAN_DELETES) break;
    const res = await r2.fetch(objectUrl(o.key), { method: 'DELETE' });
    if (res.ok) orphans++;
  }
  return { purged, orphans, scanned: objects.length, listFailed, truncated: next !== null };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...PRIVATE, 'Content-Type': 'application/json' },
  });
}
