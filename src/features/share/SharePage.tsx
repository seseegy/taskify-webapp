import { useQuery } from '@powersync/react';
import {
  CodeXml,
  FileArchive,
  FileText,
  ImageIcon,
  ChevronDown,
  Inbox,
  ListChecks,
  NotebookPen,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Listbox } from '@/components/ui/Listbox';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { useAttachmentActions } from '@/features/attachments/attachment-actions';
import { useJournalActions } from '@/features/journal/journal-actions';
import { usePalette } from '@/features/search/palette-store';
import { useTaskActions } from '@/features/tasks/task-actions';
import { isTikTokConfigured } from '@/features/tiktok/api-client';
import { findTikTokLink } from '@/features/tiktok/tiktok-link';
import { TikTokCard } from '@/features/tiktok/TikTokCard';
import { useProjects, useVaultActions } from '@/features/vault/vault-data';
import { nextVersionLabel } from '@/features/vault/zip';
import { formatBytes } from '@/lib/bytes';
import { formatLocalDate, todayLocal } from '@/lib/date';
import { formatIDR } from '@/lib/money';
import { languageFromPath } from '@/lib/prism';
import {
  clearShareInbox,
  readShareInbox,
  readSharedFile,
  sharedFileKind,
  sharedText,
  type ShareInbox,
  type SharedFile,
} from './share-inbox';

/** Halaman tujuan "Bagikan ke Taskify": arahkan teks/URL/file ke modul yang tepat. */
export function SharePage() {
  const [inbox, setInbox] = useState<ShareInbox | null | undefined>(undefined);
  const [done, setDone] = useState<Set<string>>(new Set());
  /** Dibagikan dari TikTok: opsi simpan teks (Tugas/Jurnal/…) disembunyikan sampai diminta. */
  const [showTextTargets, setShowTextTargets] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    void readShareInbox().then(setInbox);
  }, []);

  const finish = async () => {
    await clearShareInbox();
    setInbox(null);
    navigate('/');
  };

  if (inbox === undefined) return null;

  const text = inbox ? sharedText(inbox) : '';
  const pendingFiles = inbox?.files.filter((f) => !done.has(f.key)) ?? [];
  // Teks berisi link TikTok → niatnya hampir pasti mengunduh: kartu TikTok tampil paling atas
  const fromTikTok = isTikTokConfigured && findTikTokLink(text) !== null;
  const textPending = Boolean(text) && !done.has('text') && (!fromTikTok || showTextTargets);

  return (
    <>
      <PageHeader
        title="Dibagikan ke Taskify"
        subtitle="Pilih tujuan untuk setiap item"
        icon={Share2}
        gradient="bg-gradient-brand"
      />
      {!inbox || (!text && inbox.files.length === 0) ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="Tidak ada yang dibagikan"
            description='Dari aplikasi lain (galeri, file manager, browser), pilih Bagikan → "Taskify". Fitur ini aktif setelah Taskify dipasang dari Chrome di Android.'
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {fromTikTok && <TikTokCard input={text} />}
          {fromTikTok && !showTextTargets && !done.has('text') && (
            <Button variant="ghost" size="sm" onClick={() => setShowTextTargets(true)}>
              <ChevronDown /> Simpan teksnya ke Tugas / Jurnal…
            </Button>
          )}
          {textPending && (
            <TextTargets
              text={text}
              title={inbox.title}
              url={inbox.url}
              onDone={() => setDone(new Set([...done, 'text']))}
            />
          )}
          {inbox.files.map((f) =>
            done.has(f.key) ? null : (
              <FileTarget key={f.key} file={f} onDone={() => setDone(new Set([...done, f.key]))} />
            ),
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant={pendingFiles.length || textPending ? 'ghost' : 'primary'}
              onClick={() => void finish()}
            >
              {pendingFiles.length || textPending ? <Trash2 /> : null}
              {pendingFiles.length || textPending ? 'Abaikan sisanya' : 'Selesai'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function TextTargets({
  text,
  title,
  url,
  onDone,
}: {
  text: string;
  title: string;
  url: string;
  onDone: () => void;
}) {
  const tasks = useTaskActions();
  const journal = useJournalActions();
  const vault = useVaultActions();
  const showPalette = usePalette((s) => s.show);
  const firstLine = (title || text.split('\n')[0] || 'Dibagikan').slice(0, 200);
  const today = todayLocal();

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    await fn();
    toast(msg, { tone: 'success' });
    onDone();
  };

  return (
    <Card className="animate-fade-up">
      <CardTitle className="mb-2">Teks / tautan</CardTitle>
      <pre className="mb-4 max-h-40 overflow-auto rounded-xl p-3 font-sans text-sm whitespace-pre-wrap glass">
        {text}
      </pre>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button
          variant="secondary"
          onClick={() =>
            void act(
              () =>
                tasks.create({
                  title: firstLine,
                  notes: text === firstLine ? null : text,
                  due_date: today,
                }),
              'Tugas dibuat untuk hari ini',
            )
          }
        >
          <ListChecks /> Tugas
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void act(
              () =>
                journal.create({
                  entry_date: today,
                  title: title || null,
                  content: [text, url && !text.includes(url) ? url : '']
                    .filter(Boolean)
                    .join('\n\n'),
                }),
              'Disimpan ke jurnal hari ini',
            )
          }
        >
          <NotebookPen /> Jurnal
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void act(
              () =>
                vault.saveSnippet({
                  title: firstLine,
                  language: 'plaintext',
                  code: text,
                  description: url || null,
                }),
              'Disimpan sebagai snippet',
            )
          }
        >
          <CodeXml /> Snippet
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            showPalette(text.replace(/\s+/g, ' ').slice(0, 300));
            onDone();
          }}
        >
          <Search /> Catat cepat…
        </Button>
      </div>
    </Card>
  );
}

function FileTarget({ file, onDone }: { file: SharedFile; onDone: () => void }) {
  const kind = sharedFileKind(file);
  const attachments = useAttachmentActions();
  const vault = useVaultActions();
  const journal = useJournalActions();
  const { projects } = useProjects('');
  const { powerSync } = useDatabase();
  const { data: recentTx } = useQuery<{
    id: string;
    title: string | null;
    amount: number;
    occurred_on: string;
  }>(
    `SELECT id, title, amount, occurred_on FROM transactions WHERE deleted_at IS NULL AND kind = 'expense'
      ORDER BY occurred_on DESC, created_at DESC LIMIT 15`,
  );
  const [target, setTarget] = useState(
    kind === 'zip' ? 'project:new' : kind === 'text' ? 'snippet' : 'journal',
  );
  const [busy, setBusy] = useState(false);
  const Icon =
    kind === 'zip'
      ? FileArchive
      : kind === 'image'
        ? ImageIcon
        : kind === 'text'
          ? FileText
          : FileText;

  const run = async () => {
    const f = await readSharedFile(file);
    if (!f) return toast('File tidak ditemukan di kotak masuk', { tone: 'danger' });
    setBusy(true);
    try {
      if (target.startsWith('project:')) {
        let projectId = target.slice(8);
        if (projectId === 'new')
          projectId = await vault.saveProject({
            name: f.name.replace(/\.zip$/i, ''),
            description: null,
            repo_url: null,
          });
        const labels = (
          await powerSync.getAll<{ version_label: string | null }>(
            `SELECT version_label FROM attachments WHERE entity_type = 'code_project' AND entity_id = ? AND deleted_at IS NULL`,
            [projectId],
          )
        ).map((r) => r.version_label);
        await attachments.upload('code_project', projectId, f, {
          versionLabel: nextVersionLabel(labels),
          compress: false,
        });
      } else if (target === 'snippet') {
        await vault.saveSnippet({
          title: f.name,
          language: languageFromPath(f.name),
          code: await f.text(),
          description: 'Dibagikan dari aplikasi lain',
        });
        toast('Snippet dibuat', { tone: 'success' });
      } else if (target === 'journal') {
        const id = await journal.create({
          entry_date: todayLocal(),
          title: `Lampiran: ${f.name}`,
          content: '',
        });
        await attachments.upload('journal_entry', id, f);
      } else if (target.startsWith('tx:')) {
        await attachments.upload('transaction', target.slice(3), f);
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="animate-fade-up">
      <div className="mb-3 flex items-center gap-3">
        <span className="shine flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-vault text-white">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{file.name}</span>
          <span className="text-xs text-muted">{formatBytes(file.size)}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Listbox
          aria-label={`Tujuan ${file.name}`}
          value={target}
          onChange={setTarget}
          className="min-w-56 flex-1"
          options={[
            ...(kind === 'zip'
              ? [
                  {
                    value: 'project:new',
                    label: `Project baru: ${file.name.replace(/\.zip$/i, '')}`,
                    group: 'Versi project baru',
                  },
                  ...projects.map((p) => ({
                    value: `project:${p.id}`,
                    label: p.name,
                    group: 'Versi project baru',
                  })),
                ]
              : []),
            ...(kind === 'text' ? [{ value: 'snippet', label: 'Snippet baru' }] : []),
            ...(kind !== 'zip' ? [{ value: 'journal', label: 'Lampiran jurnal hari ini' }] : []),
            ...(kind === 'image' || kind === 'other'
              ? recentTx.map((t) => ({
                  value: `tx:${t.id}`,
                  label: `${t.title || 'Pengeluaran'} · ${formatIDR(t.amount)} · ${formatLocalDate(t.occurred_on, 'd MMM')}`,
                  group: 'Struk untuk transaksi',
                }))
              : []),
          ]}
        />
        <Button loading={busy} onClick={() => void run()}>
          Simpan
        </Button>
      </div>
    </Card>
  );
}
