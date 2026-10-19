import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast-store';
import { saveBlob } from '@/lib/files';
import { tiktokClient } from './api-client';
import { assetKey, downloadAsset } from './download-asset';
import type { TikTokAsset, TikTokPost } from './types';

export type PostState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; post: TikTokPost };

/** Progres per file: `null` = berjalan tanpa ukuran diketahui, angka 0–1, tidak ada = diam. */
export type ProgressMap = Record<string, number | null>;

/** Jeda antar-file saat mengunduh semua foto: Chrome menahan banyak unduhan beruntun. */
const BETWEEN_FILES_MS = 500;

/**
 * Ekstrak satu link TikTok lalu sediakan aksi unduh. Dipakai kartu di /bagikan dan di panel
 * "Unduh TikTok". `input` = teks/link apa adanya; null = belum ada yang diminta.
 */
export function useTikTokPost(input: string | null) {
  const [state, setState] = useState<PostState>({ status: 'loading' });
  const [progress, setProgress] = useState<ProgressMap>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  /** "Unduh semua foto" sedang berjalan: foto ke-`current` dari `total` (termasuk jeda antar-file). */
  const [bulk, setBulk] = useState<{ current: number; total: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = useRef<{ post: TikTokPost; at: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Link lain / "Coba lagi" → mulai dari keadaan memuat (disetel saat render, bukan di effect)
  const requestKey = `${attempt}:${input ?? ''}`;
  const [seenKey, setSeenKey] = useState(requestKey);
  if (seenKey !== requestKey) {
    setSeenKey(requestKey);
    setState({ status: 'loading' });
    setProgress({});
    setDone(new Set());
    setBulk(null);
  }

  useEffect(() => {
    if (!input || !tiktokClient) return;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    current.current = null;
    tiktokClient
      .extract(input, controller.signal)
      .then((post) => {
        current.current = { post, at: Date.now() };
        setState({ status: 'ready', post });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => controller.abort();
  }, [input, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const refresh = useCallback(async () => {
    const post = await tiktokClient!.extract(input!, abort.current?.signal);
    current.current = { post, at: Date.now() };
    setState({ status: 'ready', post });
    return post;
  }, [input]);

  /** Unduh lalu simpan ke perangkat. true = tersimpan. */
  const saveOne = useCallback(
    async (asset: TikTokAsset): Promise<boolean> => {
      const snapshot = current.current;
      if (!tiktokClient || !snapshot) return false;
      const key = assetKey(asset);
      setProgress((p) => ({ ...p, [key]: null }));
      try {
        const file = await downloadAsset(asset, {
          client: tiktokClient,
          current: snapshot,
          refresh,
          signal: abort.current?.signal,
          onProgress: (fraction) => setProgress((p) => ({ ...p, [key]: fraction })),
        });
        saveBlob(file.blob, file.fileName);
        setDone((d) => new Set(d).add(key));
        return true;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return false;
        toast(e instanceof Error ? e.message : 'Gagal mengunduh', { tone: 'danger' });
        return false;
      } finally {
        setProgress((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
      }
    },
    [refresh],
  );

  const download = useCallback(
    async (asset: TikTokAsset) => {
      if (await saveOne(asset)) toast('Tersimpan ke folder Download', { tone: 'success' });
    },
    [saveOne],
  );

  /** Semua foto, satu per satu (masing-masing jadi file sendiri → langsung masuk galeri). */
  const downloadAllPhotos = useCallback(async () => {
    const post = current.current?.post;
    if (!post) return;
    const total = post.downloads.photos.length;
    let saved = 0;
    try {
      for (let index = 0; index < total; index++) {
        setBulk({ current: index + 1, total });
        if (index > 0) await new Promise((r) => setTimeout(r, BETWEEN_FILES_MS));
        if (await saveOne({ kind: 'photo', index })) saved++;
      }
    } finally {
      setBulk(null);
    }
    if (saved > 0) {
      toast(`${saved} dari ${total} foto tersimpan ke folder Download`, {
        tone: 'success',
      });
    }
  }, [saveOne]);

  return { state, progress, done, bulk, retry, download, downloadAllPhotos };
}
