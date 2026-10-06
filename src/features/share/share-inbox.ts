/** Kotak masuk "Bagikan ke Taskify" — diisi service worker (public/sw-extra.js). */
const SHARE_CACHE = 'taskify-share';

export interface SharedFile {
  key: string;
  name: string;
  type: string;
  size: number;
}

export interface ShareInbox {
  title: string;
  text: string;
  url: string;
  files: SharedFile[];
  received_at: string;
}

export async function readShareInbox(): Promise<ShareInbox | null> {
  if (!('caches' in window)) return null;
  const cache = await caches.open(SHARE_CACHE);
  const res = await cache.match('/__share/meta');
  return res ? ((await res.json()) as ShareInbox) : null;
}

export async function readSharedFile(f: SharedFile): Promise<File | null> {
  const res = await (await caches.open(SHARE_CACHE)).match(f.key);
  if (!res) return null;
  return new File([await res.blob()], f.name, { type: f.type });
}

export async function clearShareInbox() {
  if ('caches' in window) await caches.delete(SHARE_CACHE);
}

export type FileKind = 'zip' | 'image' | 'text' | 'other';

export function sharedFileKind(f: Pick<SharedFile, 'name' | 'type'>): FileKind {
  if (/zip/.test(f.type) || /\.zip$/i.test(f.name)) return 'zip';
  if (f.type.startsWith('image/') || f.type === 'application/pdf') return 'image';
  if (
    f.type.startsWith('text/') ||
    /\.(md|json|ts|tsx|js|jsx|py|sql|sh|ya?ml|toml|go|rs|php|java|kt|css|html)$/i.test(f.name)
  )
    return 'text';
  return 'other';
}

/** Gabungkan judul/teks/URL bersama jadi satu teks rapi (tanpa duplikat). */
export function sharedText(s: Pick<ShareInbox, 'title' | 'text' | 'url'>): string {
  const parts = [s.title, s.text, s.url].map((p) => p.trim()).filter(Boolean);
  return [...new Set(parts)]
    .filter((p, i, arr) => !arr.some((o, j) => j !== i && o.length > p.length && o.includes(p)))
    .join('\n');
}
