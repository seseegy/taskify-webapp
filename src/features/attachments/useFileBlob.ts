import { useEffect, useState } from 'react';
import type { Attachment } from '@/db/schema';
import { fetchFileBlob } from '@/lib/files';

/** Isi file lampiran sebagai Blob + object URL (cache offline → R2). */
export function useFileBlob(
  att: Pick<Attachment, 'id' | 'storage_key' | 'file_name' | 'status'> | null,
  enabled = true,
) {
  const [state, setState] = useState<{
    id: string | null;
    blob: Blob | null;
    url: string | null;
    error: string | null;
  }>({
    id: null,
    blob: null,
    url: null,
    error: null,
  });
  const id = att?.id ?? null;
  const ready = enabled && att !== null && att.status === 'uploaded';

  useEffect(() => {
    if (!ready || !att) return;
    let alive = true;
    let url: string | null = null;
    fetchFileBlob(att.id, att.storage_key, att.file_name)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setState({ id: att.id, blob, url, error: null });
      })
      .catch(
        (e: unknown) =>
          alive &&
          setState({
            id: att.id,
            blob: null,
            url: null,
            error: e instanceof Error ? e.message : String(e),
          }),
      );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cukup bergantung pada id & status
  }, [id, ready]);

  const current = state.id === id ? state : { blob: null, url: null, error: null };
  return {
    blob: current.blob,
    url: current.url,
    error: current.error,
    loading: ready && !current.blob && !current.error,
  };
}
