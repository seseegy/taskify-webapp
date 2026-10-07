import {
  Download,
  FileArchive,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import type { Attachment, EntityType } from '@/db/schema';
import { formatBytes } from '@/lib/bytes';
import { saveBlob } from '@/lib/files';
import { useAttachmentActions, useAttachments, useUploads } from './attachment-actions';
import { useFileBlob } from './useFileBlob';

const isImage = (a: Pick<Attachment, 'mime_type'>) => a.mime_type?.startsWith('image/') ?? false;

/** Lampiran umum (foto struk, gambar jurnal, dokumen) untuk satu entitas. */
export function AttachmentList({
  type,
  id,
  accept = 'image/*,application/pdf',
  label = 'Lampirkan',
}: {
  type: EntityType;
  id: string;
  accept?: string;
  label?: string;
}) {
  const items = useAttachments(type, id);
  const actions = useAttachmentActions();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  const onFiles = async (files: FileList | null) => {
    for (const f of [...(files ?? [])]) await actions.upload(type, id, f);
    if (input.current) input.current.value = '';
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((a) => (
          <AttachmentTile key={a.id} att={a} onOpen={() => setViewing(a)} />
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold text-muted glass transition hover:text-fg"
        >
          <Paperclip className="size-5" />
          {label}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        // capture tidak dipaksa → di HP muncul pilihan kamera atau galeri
        onChange={(e) => void onFiles(e.target.files)}
      />
      <AttachmentViewer att={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function AttachmentTile({ att, onOpen }: { att: Attachment; onOpen: () => void }) {
  const progress = useUploads((s) => s.progress[att.id]);
  const hasFile = useUploads((s) => Boolean(s.files[att.id]));
  const actions = useAttachmentActions();
  const { url } = useFileBlob(att, isImage(att));
  const uploading = progress !== undefined;

  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl glass">
      <button
        type="button"
        onClick={onOpen}
        disabled={att.status !== 'uploaded'}
        className="flex size-full items-center justify-center"
      >
        {url ? (
          <img src={url} alt={att.file_name} className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-muted">
            {isImage(att) ? (
              <ImageIcon className="size-6" />
            ) : att.mime_type?.includes('zip') ? (
              <FileArchive className="size-6" />
            ) : (
              <FileText className="size-6" />
            )}
            <span className="line-clamp-2 break-all">{att.file_name}</span>
          </span>
        )}
      </button>
      {uploading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-xs font-bold text-white">
          <Loader2 className="size-5 animate-spin" />
          {Math.round(progress * 100)}%
          <button
            type="button"
            aria-label="Batalkan upload"
            onClick={() => actions.cancel(att.id)}
            className="absolute top-1 right-1 rounded-full bg-black/40 p-0.5"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {!uploading && att.status !== 'uploaded' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-800/90 p-1 text-center text-[10px] font-bold text-white">
          {att.status === 'failed' ? 'Gagal' : 'Menunggu'}
          {hasFile && (
            <button
              type="button"
              onClick={() => void actions.retry(att)}
              className="flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5"
            >
              <RotateCcw className="size-3" /> Ulangi
            </button>
          )}
          <button type="button" onClick={() => void actions.remove(att)} className="underline">
            Hapus
          </button>
        </div>
      )}
    </div>
  );
}

export function AttachmentViewer({
  att,
  onClose,
}: {
  att: Attachment | null;
  onClose: () => void;
}) {
  const { url, blob, loading, error } = useFileBlob(att);
  const actions = useAttachmentActions();
  return (
    <Sheet open={att !== null} onClose={onClose} variant="palette" title={att?.file_name}>
      {att && (
        <div className="space-y-3">
          <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-2xl glass">
            {loading && <Loader2 className="size-6 animate-spin text-muted" />}
            {error && <p className="p-4 text-sm text-danger">{error}</p>}
            {url && isImage(att) && (
              <img src={url} alt={att.file_name} className="max-h-[60dvh] w-auto" />
            )}
            {url && att.mime_type === 'application/pdf' && (
              <iframe src={url} title={att.file_name} className="h-[60dvh] w-full" />
            )}
            {url && !isImage(att) && att.mime_type !== 'application/pdf' && (
              <p className="p-4 text-sm text-muted">Pratinjau tidak tersedia.</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted">{formatBytes(att.size_bytes)}</span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => {
                  if (!window.confirm(`Hapus ${att.file_name}?`)) return;
                  void actions.remove(att);
                  onClose();
                }}
              >
                <Trash2 /> Hapus
              </Button>
              <Button
                variant="secondary"
                disabled={!blob}
                onClick={() => blob && saveBlob(blob, att.file_name)}
              >
                <Download /> Unduh
              </Button>
            </span>
          </div>
        </div>
      )}
    </Sheet>
  );
}
