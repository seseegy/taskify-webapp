/**
 * Transfer file ke/dari Cloudflare R2 lewat Edge Function `files` (presigned URL).
 * Key R2 tidak pernah ada di browser.
 */
import { supabase } from './supabase';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Cache Storage berisi isi file lampiran yang pernah dibuka/diunggah di perangkat ini. */
export const FILE_CACHE_NAME = 'taskify-files-v1';

async function callFiles<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('files', { body });
  if (error) {
    // FunctionsHttpError membawa body JSON {error}
    const ctx = (error as { context?: Response }).context;
    const detail = ctx
      ? await ctx
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null)
      : null;
    throw new Error(detail ?? (navigator.onLine ? error.message : 'Butuh koneksi internet'));
  }
  return data as T;
}

/** "<user>/<lampiran>/<nama aman>" — format yang divalidasi Edge Function. */
export function storageKey(userId: string, attachmentId: string, fileName: string) {
  // Ganti pemisah path & karakter kontrol; nama tidak boleh diawali titik
  const cleaned = [...fileName]
    .map((c) => (c === '/' || c === '\\' || c.charCodeAt(0) < 32 ? '_' : c))
    .join('')
    .replace(/^\.+/, '_');
  const safe = cleaned.slice(-200) || 'file';
  return `${userId}/${attachmentId}/${safe}`;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Unggah dengan progres (XHR — fetch belum mendukung progres upload). */
export async function uploadToR2(
  key: string,
  file: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { url } = await callFiles<{ url: string }>({
    action: 'upload',
    key,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload gagal (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload gagal — periksa koneksi atau CORS bucket R2'));
    xhr.onabort = () => reject(new DOMException('Dibatalkan', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export async function downloadUrl(key: string, fileName: string, inline = false): Promise<string> {
  const { url } = await callFiles<{ url: string }>({ action: 'download', key, fileName, inline });
  return url;
}

export async function deleteFromR2(key: string): Promise<void> {
  await callFiles<{ ok: boolean }>({ action: 'delete', key });
}

// --------------------------------------------------------------------------- cache offline
const cacheReq = (attachmentId: string) =>
  new Request(`https://taskify.local/files/${attachmentId}`);

export async function putCachedFile(attachmentId: string, blob: Blob) {
  if (!('caches' in window)) return;
  const cache = await caches.open(FILE_CACHE_NAME);
  await cache.put(
    cacheReq(attachmentId),
    new Response(blob, { headers: { 'Content-Type': blob.type } }),
  );
}

export async function getCachedFile(attachmentId: string): Promise<Blob | null> {
  if (!('caches' in window)) return null;
  const res = await (await caches.open(FILE_CACHE_NAME)).match(cacheReq(attachmentId));
  return res ? res.blob() : null;
}

export async function deleteCachedFile(attachmentId: string) {
  if ('caches' in window) await (await caches.open(FILE_CACHE_NAME)).delete(cacheReq(attachmentId));
}

/** Ambil isi file: cache lokal dulu (offline), lalu R2 (lalu disimpan ke cache). */
export async function fetchFileBlob(
  attachmentId: string,
  key: string,
  fileName: string,
): Promise<Blob> {
  const cached = await getCachedFile(attachmentId);
  if (cached) return cached;
  const res = await fetch(await downloadUrl(key, fileName, true));
  if (!res.ok) throw new Error(`Gagal mengunduh (${res.status})`);
  const blob = await res.blob();
  await putCachedFile(attachmentId, blob).catch(() => undefined);
  return blob;
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Perkecil foto (struk, dll.) sebelum upload: sisi terpanjang maks. 2000 px, JPEG 0,85.
 * Hanya jika gambar > 1,5 MB dan bisa didekode browser; selain itu file asli dipakai.
 */
export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    if (blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    return file;
  }
}
