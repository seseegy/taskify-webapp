/**
 * Mengunduh satu file dari postingan TikTok — MURNI (klien & penyegar disuntik) agar bisa diuji.
 *
 * Link unduhan Worker berlaku 10 menit, dan link CDN TikTok di dalamnya juga punya umur sendiri.
 * Pengguna bisa saja membuka kartu, meninggalkannya, lalu menekan "Unduh" jauh kemudian. Maka:
 *   1. link yang sudah lewat LINK_MAX_AGE_MS diperbarui dulu (`/v1/extract` lagi), dan
 *   2. bila tetap ditolak sebagai kedaluwarsa, diperbarui SEKALI lalu dicoba lagi.
 */
import { isStaleLink, type DownloadedFile, type ProgressFn, type TikTokClient } from './api-client';
import type { TikTokAsset, TikTokPost } from './types';

/** Lebih pendek dari TOKEN_TTL_SECONDS Worker (600 dtk), supaya tidak mepet. */
export const LINK_MAX_AGE_MS = 8 * 60_000;

export function assetUrl(post: TikTokPost, asset: TikTokAsset): string | null {
  if (asset.kind === 'video') return post.downloads.video;
  if (asset.kind === 'audio') return post.downloads.audio;
  return post.downloads.photos[asset.index] ?? null;
}

/** Dipakai bila server tidak mengirim nama file. */
export function assetFallbackName(post: TikTokPost, asset: TikTokAsset): string {
  const base = `${post.author.unique_id || 'tiktok'}_${post.id}`;
  if (asset.kind === 'video') return `${base}.mp4`;
  if (asset.kind === 'audio') return `${base}_audio.mp3`;
  return `${base}_${String(asset.index + 1).padStart(2, '0')}.jpg`;
}

export const assetKey = (asset: TikTokAsset) =>
  asset.kind === 'photo' ? `photo:${asset.index}` : asset.kind;

export interface DownloadDeps {
  client: TikTokClient;
  /** Postingan yang sedang tampil + kapan diekstrak (ms). */
  current: { post: TikTokPost; at: number };
  /** Ekstrak ulang; mengembalikan postingan dengan link baru. */
  refresh: () => Promise<TikTokPost>;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
  now?: () => number;
}

export async function downloadAsset(
  asset: TikTokAsset,
  deps: DownloadDeps,
): Promise<DownloadedFile> {
  const now = deps.now ?? Date.now;
  let post = deps.current.post;
  let refreshed = false;
  if (now() - deps.current.at > LINK_MAX_AGE_MS) {
    post = await deps.refresh();
    refreshed = true;
  }

  const attempt = (p: TikTokPost) => {
    const url = assetUrl(p, asset);
    if (!url) throw new Error('File ini tidak tersedia untuk postingan ini.');
    return deps.client.download(url, assetFallbackName(p, asset), deps.onProgress, deps.signal);
  };

  try {
    return await attempt(post);
  } catch (e) {
    if (refreshed || !isStaleLink(e)) throw e;
    return attempt(await deps.refresh());
  }
}
