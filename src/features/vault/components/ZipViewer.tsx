import {
  ChevronRight,
  Download,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  ImageIcon,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Sheet } from '@/components/ui/Sheet';
import type { Attachment } from '@/db/schema';
import { useFileBlob } from '@/features/attachments/useFileBlob';
import { formatBytes } from '@/lib/bytes';
import { saveBlob } from '@/lib/files';
import { languageFromPath } from '@/lib/prism';
import { cn } from '@/lib/utils';
import { buildTree, isImagePath, isTextPath, readZip, type TreeNode, type ZipInfo } from '../zip';

const PREVIEW_LIMIT = 512 * 1024;

/** Lihat isi zip versi project tanpa mengekstrak: pohon folder + pratinjau file. */
export function ZipViewer({ att, onClose }: { att: Attachment | null; onClose: () => void }) {
  return (
    <Sheet
      open={att !== null}
      onClose={onClose}
      wide
      title={att ? `${att.version_label ?? ''} ${att.file_name}`.trim() : ''}
    >
      {att && <ZipBody key={att.id} att={att} />}
    </Sheet>
  );
}

function ZipBody({ att }: { att: Attachment }) {
  const { blob, loading, error } = useFileBlob(att);
  const [info, setInfo] = useState<ZipInfo | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) return;
    let alive = true;
    readZip(blob)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setZipError('File ini bukan arsip zip yang valid.'));
    return () => {
      alive = false;
    };
  }, [blob]);

  const tree = useMemo(() => (info ? buildTree(info.entries) : null), [info]);

  if (loading || (blob && !info && !zipError)) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Memuat arsip ({formatBytes(att.size_bytes)})…
      </p>
    );
  }
  if (error || zipError) return <p className="py-6 text-sm text-danger">{error ?? zipError}</p>;
  if (!info || !tree) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {info.files} file · {formatBytes(info.totalSize)} setelah diekstrak · tersimpan offline di
        perangkat ini
      </p>
      {info.warnings.length > 0 && <ZipWarnings info={info} />}
      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <div className="max-h-[60dvh] overflow-auto rounded-2xl p-1.5 text-sm glass">
          <Tree node={tree} depth={0} selected={selected} onSelect={setSelected} defaultOpen />
        </div>
        <FilePreview info={info} path={selected} />
      </div>
      {blob && (
        <Button variant="secondary" onClick={() => saveBlob(blob, att.file_name)}>
          <Download /> Unduh zip
        </Button>
      )}
    </div>
  );
}

export function ZipWarnings({ info }: { info: Pick<ZipInfo, 'warnings'> }) {
  return (
    <ul className="space-y-1.5">
      {info.warnings.map((w) => (
        <li
          key={w.title}
          className={cn(
            'rounded-xl px-3 py-2 text-xs',
            w.level === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
          )}
        >
          <p className="flex items-center gap-1.5 font-bold">
            <TriangleAlert className="size-3.5" /> {w.title}
          </p>
          <p className="mt-0.5 opacity-90">{w.detail}</p>
          <p className="mt-0.5 truncate font-mono opacity-80">{w.paths.join(', ')}</p>
        </li>
      ))}
    </ul>
  );
}

function Tree({
  node,
  depth,
  selected,
  onSelect,
  defaultOpen,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (p: string) => void;
  defaultOpen?: boolean;
}) {
  // Akar: tampilkan anak langsung; folder tunggal di akar dibuka otomatis
  const autoOpen =
    defaultOpen ||
    (depth === 1 && node.dir && node.name !== 'node_modules' && node.name !== '.git');
  const [open, setOpen] = useState(Boolean(autoOpen));
  if (depth === 0) {
    return (
      <>
        {node.children.map((c) => (
          <Tree
            key={c.path}
            node={c}
            depth={1}
            selected={selected}
            onSelect={onSelect}
            defaultOpen={node.children.length === 1}
          />
        ))}
      </>
    );
  }
  const pad = { paddingLeft: `${(depth - 1) * 14 + 6}px` };
  if (!node.dir) {
    const Icon = isImagePath(node.path) ? ImageIcon : isTextPath(node.path) ? FileCode2 : File;
    return (
      <button
        type="button"
        aria-current={selected === node.path ? 'true' : undefined}
        onClick={() => onSelect(node.path)}
        style={pad}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left',
          selected === node.path ? 'bg-gradient-vault text-white' : 'hover:bg-surface',
        )}
      >
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={pad}
        className="flex w-full items-center gap-1 rounded-lg py-1 pr-2 text-left font-semibold hover:bg-surface"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition', open && 'rotate-90')}
          aria-hidden="true"
        />
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-mod-vault" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-mod-vault" />
        )}
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 text-xs font-normal text-muted">
          {formatBytes(node.size)}
        </span>
      </button>
      {open &&
        node.children.map((c) => (
          <Tree key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </div>
  );
}

function FilePreview({ info, path }: { info: ZipInfo; path: string | null }) {
  const [content, setContent] = useState<{
    path: string;
    text?: string;
    url?: string;
    blob?: Blob;
  } | null>(null);
  const entry = path ? info.entries.find((e) => e.path === path) : undefined;

  useEffect(() => {
    if (!path || !entry) return;
    let alive = true;
    let url: string | undefined;
    const file = info.zip.file(path);
    if (!file) return;
    void (async () => {
      const blob = await file.async('blob');
      if (!alive) return;
      if (isImagePath(path)) {
        url = URL.createObjectURL(
          path.endsWith('.svg') ? new Blob([blob], { type: 'image/svg+xml' }) : blob,
        );
        setContent({ path, url, blob });
      } else if (isTextPath(path) && entry.size <= PREVIEW_LIMIT) {
        setContent({ path, text: await blob.text(), blob });
      } else {
        setContent({ path, blob });
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [info, path, entry]);

  if (!path) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl p-6 text-sm text-muted glass">
        Pilih file untuk melihat isinya.
      </div>
    );
  }
  const current = content?.path === path ? content : null;
  return (
    <div className="min-w-0 rounded-2xl glass">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs">
        <span className="truncate font-mono font-semibold">{path}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted">
          {formatBytes(entry?.size)}
          {current?.blob && (
            <button
              type="button"
              aria-label="Unduh file ini"
              onClick={() => saveBlob(current.blob!, path.split('/').pop()!)}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-surface"
            >
              <Download className="size-4" />
            </button>
          )}
        </span>
      </div>
      <div className="max-h-[55dvh] overflow-auto p-3">
        {!current && <Loader2 className="size-4 animate-spin text-muted" />}
        {current?.text !== undefined && (
          <CodeBlock code={current.text} language={languageFromPath(path)} />
        )}
        {current?.url && <img src={current.url} alt={path} className="max-h-[50dvh]" />}
        {current && current.text === undefined && !current.url && (
          <p className="text-sm text-muted">
            {entry && entry.size > PREVIEW_LIMIT && isTextPath(path)
              ? 'File terlalu besar untuk dipratinjau.'
              : 'Pratinjau tidak tersedia untuk jenis file ini.'}
          </p>
        )}
      </div>
    </div>
  );
}
