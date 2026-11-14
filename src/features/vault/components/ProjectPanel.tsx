import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FolderSearch,
  Loader2,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Field';
import { Input, Label } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import type { Attachment, CodeProject } from '@/db/schema';
import {
  downloadAttachment,
  useAttachmentActions,
  useAttachments,
  useUploads,
} from '@/features/attachments/attachment-actions';
import { LinksPanel } from '@/features/links/LinksPanel';
import { TagPicker } from '@/features/tags/TagPicker';
import { ConfigTab } from '../config/ConfigTab';
import { formatBytes } from '@/lib/bytes';
import { localeId, parseTimestamp } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useVaultActions } from '../vault-data';
import { VersionUploader } from './VersionUploader';
import { ZipViewer } from './ZipViewer';
import { askConfirm } from '@/components/ui/confirm-store';

export function ProjectPanel({ project, onBack }: { project: CodeProject; onBack: () => void }) {
  const navigate = useNavigate();
  const versions = useAttachments('code_project', project.id);
  const actions = useVaultActions();
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const total = versions.reduce((s, v) => s + v.size_bytes, 0);

  return (
    <Card className="animate-fade-up space-y-5 p-4 sm:p-6">
      <div className="flex items-start gap-2">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Kembali"
          onClick={onBack}
          className="lg:hidden"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold tracking-tight">{project.name}</h2>
          {project.description && (
            <p className="mt-0.5 text-sm text-muted">{project.description}</p>
          )}
          {project.repo_url && (
            <a
              href={project.repo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" /> {project.repo_url.replace(/^https?:\/\//, '')}
            </a>
          )}
          <p className="mt-1 text-xs text-muted">
            {versions.length} versi · {formatBytes(total)}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={project.is_favorite ? 'Hapus dari favorit' : 'Favoritkan'}
          onClick={() => void actions.toggleProjectFavorite(project)}
        >
          <Star className={cn(project.is_favorite && 'fill-amber-400 text-amber-400')} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Ubah project"
          onClick={() => setEditing(true)}
        >
          <Pencil />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Hapus project"
          className="text-danger"
          onClick={() => {
            void actions.removeProject(project.id);
            onBack();
          }}
        >
          <Trash2 />
        </Button>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-muted">Unggah versi baru</h3>
        <VersionUploader projectId={project.id} labels={versions.map((v) => v.version_label)} />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-muted">Versi</h3>
        {versions.length === 0 ? (
          <p className="text-sm text-muted">Belum ada arsip.</p>
        ) : (
          <ol className="space-y-1.5">
            {versions.map((v, i) => (
              <VersionRow key={v.id} att={v} latest={i === 0} onView={() => setViewing(v)} />
            ))}
          </ol>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-muted">Konfigurasi</h3>
          <Link
            to={`/vault?tab=konfigurasi`}
            className="min-h-9 rounded-lg px-2 text-xs font-semibold text-primary transition hover:bg-surface"
          >
            Semua konfigurasi
          </Link>
        </div>
        {/* Dibatasi ke project ini; isinya tetap butuh brankas Sandi terbuka */}
        <ConfigTab
          projectId={project.id}
          onOpen={(id) => navigate(`/vault?tab=konfigurasi&config=${id}`)}
        />
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted">Tag</h3>
          <TagPicker type="code_project" entityId={project.id} />
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted">Tautan</h3>
          <LinksPanel type="code_project" id={project.id} />
        </section>
      </div>

      <ZipViewer att={viewing} onClose={() => setViewing(null)} />
      <ProjectDialog open={editing} project={project} onClose={() => setEditing(false)} />
    </Card>
  );
}

function VersionRow({
  att,
  latest,
  onView,
}: {
  att: Attachment;
  latest: boolean;
  onView: () => void;
}) {
  const progress = useUploads((s) => s.progress[att.id]);
  const hasFile = useUploads((s) => Boolean(s.files[att.id]));
  const actions = useAttachmentActions();
  const uploading = progress !== undefined;
  const ready = att.status === 'uploaded';

  return (
    <li className={cn('rounded-2xl px-3 py-2.5 glass', !ready && !uploading && 'border-danger/40')}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-lg px-2 py-0.5 text-xs font-semibold',
            latest ? 'bg-gradient-vault text-white' : 'bg-surface',
          )}
        >
          {att.version_label ?? '—'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{att.note || att.file_name}</span>
          <span className="block truncate text-xs text-muted">
            {att.note ? `${att.file_name} · ` : ''}
            {formatBytes(att.size_bytes)} ·{' '}
            {formatDistanceToNow(parseTimestamp(att.created_at), {
              addSuffix: true,
              locale: localeId,
            })}
          </span>
        </span>
        {uploading ? (
          <span className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Loader2 className="size-4 animate-spin" /> {Math.round(progress * 100)}%
            <button
              type="button"
              aria-label="Batalkan upload"
              onClick={() => actions.cancel(att.id)}
              className="text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </span>
        ) : ready ? (
          <span className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={onView}>
              <FolderSearch /> Lihat isi
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Unduh"
              onClick={() => void downloadAttachment(att)}
            >
              <Download />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Hapus versi"
              className="text-danger"
              onClick={() =>
                void (async () => {
                  const ok = await askConfirm({
                    title: `Hapus versi ${att.version_label ?? att.file_name}?`,
                    description: 'Berkasnya ikut dihapus dari penyimpanan.',
                    confirmLabel: 'Hapus versi',
                  });
                  if (ok) await actions.remove(att);
                })()
              }
            >
              <Trash2 />
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-semibold text-danger">
            {att.status === 'failed' ? 'Gagal' : 'Belum terunggah'}
            {hasFile && (
              <Button size="sm" variant="ghost" onClick={() => void actions.retry(att)}>
                <RotateCcw /> Ulangi
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Hapus"
              onClick={() => void actions.remove(att)}
            >
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
      {uploading && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-gradient-vault transition-[width]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </li>
  );
}

export function ProjectDialog({
  open,
  project,
  onClose,
  onCreated,
}: {
  open: boolean;
  project?: CodeProject;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      title={project ? 'Ubah project' : 'Project baru'}
    >
      {open && (
        <ProjectForm
          key={project?.id ?? 'new'}
          project={project}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </Sheet>
  );
}

function ProjectForm({
  project,
  onClose,
  onCreated,
}: {
  project?: CodeProject;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const actions = useVaultActions();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [repo, setRepo] = useState(project?.repo_url ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = await actions.saveProject({ id: project?.id, name, description, repo_url: repo });
    if (!project) onCreated?.(id);
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="p-name">Nama</Label>
        <Input
          id="p-name"
          data-autofocus
          value={name}
          maxLength={120}
          placeholder="mis. taskify-webapp"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="p-desc">Deskripsi</Label>
        <Textarea
          id="p-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-16"
        />
      </div>
      <div>
        <Label htmlFor="p-repo">URL repo (opsional)</Label>
        <Input
          id="p-repo"
          type="url"
          value={repo}
          placeholder="https://github.com/…"
          onChange={(e) => setRepo(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!name.trim()}>
          {project ? 'Simpan' : 'Buat project'}
        </Button>
      </div>
    </form>
  );
}
