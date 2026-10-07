import { CodeXml, FolderGit2, HardDrive, Plus, Search, Star } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { Snippet } from '@/db/schema';
import { useTagMap } from '@/features/tags/tag-actions';
import { TagChip } from '@/features/tags/TagPicker';
import { formatBytes } from '@/lib/bytes';
import { parseTimestamp, relativeDayLabel, todayLocal } from '@/lib/date';
import { languageLabel } from '@/lib/prism';
import { cn } from '@/lib/utils';
import { CopySnippet } from './components/CopySnippet';
import { ProjectDialog, ProjectPanel } from './components/ProjectPanel';
import { SnippetSheet } from './components/SnippetSheet';
import {
  useProject,
  useProjects,
  useSnippet,
  useSnippetLanguages,
  useSnippets,
  useStorageUsage,
  useVaultActions,
} from './vault-data';

type Tab = 'snippet' | 'project';
const R2_FREE_BYTES = 10 * 1024 ** 3;

/** URL: ?tab=snippet|project · ?snippet=<id|baru> · ?project=<id> */
export function VaultPage() {
  const [params, setParams] = useSearchParams();
  const snippetParam = params.get('snippet');
  const projectId = params.get('project');
  const tab: Tab = projectId || params.get('tab') === 'project' ? 'project' : 'snippet';
  const usage = useStorageUsage();
  const [creatingProject, setCreatingProject] = useState(false);

  const set = (next: Record<string, string> | null) =>
    setParams(() => new URLSearchParams(next ?? {}), { replace: false });
  const snippet = useSnippet(snippetParam && snippetParam !== 'baru' ? snippetParam : null);

  return (
    <>
      <PageHeader
        title="Vault Kode"
        subtitle="Snippet kode & arsip project"
        icon={CodeXml}
        gradient="bg-gradient-vault"
        actions={
          <Button
            // Di HP tombol hanya berupa ikon → wajib punya nama aksesibel
            aria-label={tab === 'snippet' ? 'Snippet baru' : 'Project baru'}
            onClick={() =>
              tab === 'snippet'
                ? set({ tab: 'snippet', snippet: 'baru' })
                : setCreatingProject(true)
            }
          >
            <Plus />{' '}
            <span className="hidden sm:inline">{tab === 'snippet' ? 'Snippet' : 'Project'}</span>
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<Tab>
          label="Bagian vault"
          value={tab}
          onChange={(t) => set({ tab: t })}
          className="w-full sm:w-80"
          options={[
            { value: 'snippet', label: 'Snippet', icon: <CodeXml /> },
            { value: 'project', label: 'Project', icon: <FolderGit2 /> },
          ]}
        />
        <span
          className="flex items-center gap-2 text-xs text-muted"
          title="Kuota gratis Cloudflare R2: 10 GB"
        >
          <HardDrive className="size-4" />
          R2: {formatBytes(usage.bytes)} / 10 GB · {usage.files} file
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface">
            <span
              className="block h-full rounded-full bg-gradient-vault"
              style={{ width: `${Math.min(100, (usage.bytes / R2_FREE_BYTES) * 100)}%` }}
            />
          </span>
        </span>
      </div>

      {tab === 'snippet' ? (
        <SnippetsTab onOpen={(id) => set({ tab: 'snippet', snippet: id })} />
      ) : (
        <ProjectsTab
          activeId={projectId}
          onOpen={(id) => set(id ? { tab: 'project', project: id } : { tab: 'project' })}
        />
      )}

      <SnippetSheet
        open={snippetParam !== null}
        loading={snippetParam !== 'baru' && !snippet}
        snippet={snippet}
        onClose={() => set({ tab: 'snippet' })}
        onCreated={(id) =>
          setParams(() => new URLSearchParams({ tab: 'snippet', snippet: id }), { replace: true })
        }
      />
      <ProjectDialog
        open={creatingProject}
        onClose={() => setCreatingProject(false)}
        onCreated={(id) => set({ tab: 'project', project: id })}
      />
    </>
  );
}

// ============================================================================ Snippet
function SnippetsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('');
  const [favorites, setFavorites] = useState(false);
  const { snippets, isLoading } = useSnippets({ search, language: language || null, favorites });
  const languages = useSnippetLanguages();
  const tagMap = useTagMap('snippet');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 glass">
          <Search className="size-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul, deskripsi, atau isi kode…"
            aria-label="Cari snippet"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
          />
        </label>
        <Select
          aria-label="Bahasa"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-44"
        >
          <option value="">Semua bahasa</option>
          {languages.map((l) => (
            <option key={l.language} value={l.language}>
              {languageLabel(l.language)} ({l.n})
            </option>
          ))}
        </Select>
        <Button
          variant={favorites ? 'primary' : 'secondary'}
          className="h-11"
          aria-pressed={favorites}
          onClick={() => setFavorites(!favorites)}
        >
          <Star /> Favorit
        </Button>
      </div>

      {!isLoading && snippets.length === 0 ? (
        <Card>
          <EmptyState
            icon={CodeXml}
            gradient="bg-gradient-vault"
            title={search || language || favorites ? 'Tidak ada yang cocok' : 'Belum ada snippet'}
            description="Simpan potongan kode yang sering dipakai. Gunakan {{variabel}} untuk template yang bisa diisi saat disalin."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {snippets.map((s) => (
            <SnippetCard
              key={s.id}
              snippet={s}
              tags={tagMap.get(s.id)}
              onOpen={() => onOpen(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SnippetCard({
  snippet,
  tags,
  onOpen,
}: {
  snippet: Snippet;
  tags?: { id: string; name: string; color: string | null }[];
  onOpen: () => void;
}) {
  const actions = useVaultActions();
  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-bold">{snippet.title}</span>
          {snippet.description && (
            <span className="block truncate text-xs text-muted">{snippet.description}</span>
          )}
        </button>
        <button
          type="button"
          aria-label={snippet.is_favorite ? 'Hapus dari favorit' : 'Favoritkan'}
          onClick={() => void actions.toggleSnippetFavorite(snippet)}
          className="rounded-lg p-1 hover:bg-surface"
        >
          <Star
            className={cn(
              'size-4',
              snippet.is_favorite ? 'fill-amber-400 text-amber-400' : 'text-muted',
            )}
          />
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="min-h-24 overflow-hidden rounded-xl px-3 py-2 text-left glass"
      >
        {snippet.code ? (
          <CodeBlock
            code={snippet.code}
            language={snippet.language}
            maxLines={7}
            lineNumbers={false}
            className="pointer-events-none overflow-x-hidden"
          />
        ) : (
          <span className="text-xs text-muted">Kosong</span>
        )}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>{languageLabel(snippet.language)}</Badge>
        {tags?.map((t) => (
          <TagChip key={t.id} tag={t} size="sm" />
        ))}
        <span className="flex-1" />
        <CopySnippet code={snippet.code} />
      </div>
    </Card>
  );
}

// ============================================================================ Project
function ProjectsTab({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const { projects, isLoading } = useProjects(search);
  const active = useProject(activeId);
  const today = todayLocal();

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
      <div className={cn('min-w-0 space-y-3', active && 'hidden lg:block')}>
        <label className="flex h-11 items-center gap-2 rounded-xl px-3 glass">
          <Search className="size-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari project…"
            aria-label="Cari project"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {!isLoading && projects.length === 0 && (
          <Card>
            <EmptyState
              icon={FolderGit2}
              gradient="bg-gradient-vault"
              title="Belum ada project"
              description="Buat project lalu unggah arsip zip (maks. 100 MB) sebagai versi."
            />
          </Card>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl p-3 text-left glass transition',
              p.id === activeId ? 'ring-2 ring-mod-vault/60' : 'hover:bg-surface-strong',
            )}
          >
            <span className="shine flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-vault text-white shadow-md">
              <FolderGit2 className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold">{p.name}</span>
                {p.is_favorite ? (
                  <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                ) : null}
              </span>
              <span className="block truncate text-xs text-muted">
                {p.versions
                  ? `${p.latest_label ?? 'Versi terbaru'} · ${formatBytes(p.latest_size)} · ${relativeDayLabel(todayLocal(parseTimestamp(p.latest_at!)), today).toLowerCase()}`
                  : 'Belum ada versi'}
              </span>
            </span>
            {p.versions > 0 && <Badge>{p.versions}</Badge>}
          </button>
        ))}
      </div>
      <div className={cn('min-w-0', !active && 'hidden lg:block')}>
        {active ? (
          <ProjectPanel key={active.id} project={active} onBack={() => onOpen(null)} />
        ) : (
          <Card>
            <EmptyState
              icon={FolderGit2}
              gradient="bg-gradient-vault"
              title="Pilih project"
              description="Lihat versi, isi zip, dan catatan perubahan di sini."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
