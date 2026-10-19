/**
 * Klien REST Worker ttdl-taskify (repo `seseegy/ttdl-taskify`, kontrak di README-nya).
 *
 * - Tanpa token: Worker hanya melayani Origin Taskify (dicek dari header `Origin` yang dipasang
 *   browser), jadi tidak ada yang perlu dikirim selain body.
 * - File diunduh lewat `fetch` → Blob → `saveBlob`, BUKAN dengan membuka link Worker langsung:
 *   navigasi ke domain lain dari PWA terpasang bisa membuka tab/Custom Tab, dan bila link sudah
 *   kedaluwarsa pengguna hanya melihat JSON error. Dengan fetch, progres bisa ditampilkan dan
 *   error ditangani di aplikasi.
 */
import { env } from '@/lib/env';
import type { TikTokPost } from './types';

export type TikTokErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_URL'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'PRIVATE'
  | 'BLOCKED'
  | 'UPSTREAM'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'NETWORK'
  | 'UNKNOWN';

export class TikTokError extends Error {
  readonly code: TikTokErrorCode;
  readonly status: number;
  constructor(message: string, code: TikTokErrorCode, status = 0) {
    super(message);
    this.name = 'TikTokError';
    this.code = code;
    this.status = status;
  }
}

/** Link unduhan perlu dibuat ulang (`/v1/extract` lagi) — bukan kegagalan permanen. */
export const isStaleLink = (e: unknown) =>
  e instanceof TikTokError &&
  (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID' || e.code === 'UPSTREAM');

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/** `loaded` byte; `fraction` 0–1, atau null bila ukuran total tidak diketahui. */
export type ProgressFn = (fraction: number | null, loaded: number) => void;

export interface TikTokClient {
  extract(input: string, signal?: AbortSignal): Promise<TikTokPost>;
  download(
    url: string,
    fallbackName: string,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<DownloadedFile>;
  /** Gambar cover sebagai Blob (ditampilkan lewat `blob:` — CSP img-src tidak perlu dibuka). */
  image(url: string, signal?: AbortSignal): Promise<Blob>;
}

/** `attachment; filename="a.mp4"; filename*=UTF-8''a.mp4` → `a.mp4`. */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  let name = '';
  const star = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) {
    try {
      name = decodeURIComponent(star[1]!.trim());
    } catch {
      /* lanjut ke filename biasa */
    }
  }
  if (!name) {
    const plain =
      header.match(/filename\s*=\s*"([^"]+)"/i) ?? header.match(/filename\s*=\s*([^;]+)/i);
    name = plain?.[1]?.trim() ?? '';
  }
  // Nama dari server tetap dibersihkan: tanpa folder, tanpa karakter kendali
  const clean = [...name.replace(/[/\\]/g, '_')].filter((c) => c.charCodeAt(0) >= 0x20).join('');
  return clean || fallback;
}

/** Baca body sambil melaporkan progres. */
export async function readWithProgress(res: Response, onProgress?: ProgressFn): Promise<Blob> {
  const type = res.headers.get('Content-Type') ?? '';
  if (!res.body || !onProgress) return res.blob();
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    loaded += value.length;
    onProgress(total ? Math.min(1, loaded / total) : null, loaded);
  }
  return new Blob(chunks, { type });
}

const MESSAGES: Partial<Record<TikTokErrorCode, string>> = {
  ORIGIN_NOT_ALLOWED:
    'Server TikTok menolak alamat aplikasi ini. Tambahkan origin Taskify ke ALLOWED_ORIGINS Worker ttdl-taskify.',
};

async function toError(res: Response): Promise<TikTokError> {
  let code: TikTokErrorCode = 'UNKNOWN';
  let message = `Server TikTok membalas HTTP ${res.status}.`;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    if (data.error?.code) code = data.error.code as TikTokErrorCode;
    if (data.error?.message) message = data.error.message;
  } catch {
    /* bukan JSON — pakai pesan umum */
  }
  return new TikTokError(MESSAGES[code] ?? message, code, res.status);
}

export function createTikTokClient(
  baseUrl: string,
  doFetch: typeof fetch = (...a) => fetch(...a),
): TikTokClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function send(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      // credentials: 'omit' — Worker tidak memakai cookie, dan link /v1/media tidak boleh
      // membawa apa pun dari browser.
      res = await doFetch(url, { ...init, credentials: 'omit' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new TikTokError('Tidak bisa menghubungi server TikTok. Periksa koneksi.', 'NETWORK');
    }
    if (!res.ok) throw await toError(res);
    return res;
  }

  return {
    async extract(input, signal) {
      const res = await send(`${base}/v1/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
        signal,
      });
      return ((await res.json()) as { data: TikTokPost }).data;
    },

    async download(url, fallbackName, onProgress, signal) {
      const res = await send(url, { signal });
      const fileName = fileNameFromDisposition(
        res.headers.get('Content-Disposition'),
        fallbackName,
      );
      return { blob: await readWithProgress(res, onProgress), fileName };
    },

    async image(url, signal) {
      return (await send(url, { signal })).blob();
    },
  };
}

export const isTikTokConfigured = Boolean(env.tiktokApiUrl);

/** Klien tunggal, atau null bila `VITE_TIKTOK_API_URL` kosong. */
export const tiktokClient: TikTokClient | null = isTikTokConfigured
  ? createTikTokClient(env.tiktokApiUrl)
  : null;
