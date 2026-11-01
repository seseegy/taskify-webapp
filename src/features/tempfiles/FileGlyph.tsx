import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fileKind, type FileKind } from './tempfile-utils';

function KindIcon({ kind, className }: { kind: FileKind; className: string }) {
  switch (kind) {
    case 'image':
      return <FileImage className={className} />;
    case 'video':
      return <FileVideo className={className} />;
    case 'audio':
      return <FileAudio className={className} />;
    case 'archive':
      return <FileArchive className={className} />;
    case 'sheet':
      return <FileSpreadsheet className={className} />;
    case 'code':
      return <FileCode className={className} />;
    case 'document':
      return <FileText className={className} />;
    default:
      return <File className={className} />;
  }
}

/** Ikon berkas menurut jenisnya (hanya tampilan; tipe MIME dari pengunggah tidak dipercaya). */
export function FileGlyph({
  mime,
  name,
  size = 'md',
  className,
}: {
  mime: string;
  name: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'shine flex shrink-0 items-center justify-center bg-gradient-files text-white shadow-md',
        size === 'lg' ? 'size-16 rounded-3xl' : 'size-11 rounded-2xl',
        className,
      )}
    >
      <KindIcon kind={fileKind(mime, name)} className={size === 'lg' ? 'size-8' : 'size-5'} />
    </span>
  );
}
