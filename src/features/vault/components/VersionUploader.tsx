import { CopyCheck, FileArchive, Loader2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast-store';
import {
  useAttachmentActions,
  type DuplicateInfo,
} from '@/features/attachments/attachment-actions';
import { formatBytes } from '@/lib/bytes';
import { MAX_FILE_BYTES } from '@/lib/files';
import { cn } from '@/lib/utils';
import { nextVersionLabel, readZip, type ZipInfo } from '../zip';
import { ZipWarnings } from './ZipViewer';

interface Picked {
  file: File;
  info: ZipInfo | null;
  sha: string;
  duplicate: DuplicateInfo | null;
}

/** Pilih zip → dianalisis di perangkat (isi, peringatan, duplikat) → beri label → unggah. */
export function VersionUploader({
  projectId,
  labels,
}: {
  projectId: string;
  labels: (string | null)[];
}) {
  const actions = useAttachmentActions();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES)
      return toast(`File ${formatBytes(file.size)} melebihi batas 100 MB`, { tone: 'danger' });
    setAnalyzing(true);
    try {
      const [info, sha] = await Promise.all([readZip(file).catch(() => null), actions.hash(file)]);
      setPicked({ file, info, sha, duplicate: await actions.findDuplicate(sha) });
      setLabel(nextVersionLabel(labels));
    } finally {
      setAnalyzing(false);
      if (input.current) input.current.value = '';
    }
  };

  const upload = async () => {
    if (!picked) return;
    setUploading(true);
    await actions.upload('code_project', projectId, picked.file, {
      versionLabel: label,
      note,
      compress: false,
    });
    setUploading(false);
    setPicked(null);
    setNote('');
  };

  if (!picked) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void pick(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition',
          dragging ? 'border-primary bg-primary/10' : 'border-line',
        )}
      >
        {analyzing ? (
          <Loader2 className="size-6 animate-spin text-muted" />
        ) : (
          <FileArchive className="size-7 text-mod-vault" />
        )}
        <p className="text-sm font-semibold">
          {analyzing ? 'Menganalisis arsip…' : 'Tarik file zip ke sini'}
        </p>
        <p className="text-xs text-muted">Maksimal 100 MB · isi dicek dulu sebelum diunggah</p>
        <Button
          size="sm"
          variant="secondary"
          disabled={analyzing}
          onClick={() => input.current?.click()}
        >
          <Upload /> Pilih file
        </Button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
    );
  }

  const { file, info, duplicate } = picked;
  const danger = info?.warnings.some((w) => w.level === 'danger');
  return (
    <div className="space-y-3 rounded-2xl p-4 glass">
      <div className="flex items-start gap-3">
        <FileArchive className="mt-0.5 size-6 shrink-0 text-mod-vault" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{file.name}</p>
          <p className="text-xs text-muted">
            {formatBytes(file.size)}
            {info
              ? ` · ${info.files} file · ${formatBytes(info.totalSize)} setelah diekstrak`
              : ' · bukan zip yang bisa dibaca (tetap bisa diunggah)'}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Batal"
          disabled={uploading}
          onClick={() => setPicked(null)}
        >
          <X />
        </Button>
      </div>
      {duplicate && (
        <p className="flex items-start gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
          <CopyCheck className="mt-px size-3.5 shrink-0" />
          File identik sudah tersimpan ({duplicate.version_label ?? duplicate.file_name}).
          Mengunggah lagi akan memakai ruang ganda.
        </p>
      )}
      {info && info.warnings.length > 0 && <ZipWarnings info={info} />}
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <div>
          <Label htmlFor="v-label">Versi</Label>
          <Input
            id="v-label"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="v-note">Catatan perubahan</Label>
          <Input
            id="v-note"
            value={note}
            placeholder="mis. tambah fitur login"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          variant={danger ? 'danger' : 'primary'}
          loading={uploading}
          onClick={() => void upload()}
        >
          <Upload /> {danger ? 'Tetap unggah' : 'Unggah'}
        </Button>
      </div>
    </div>
  );
}
