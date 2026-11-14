import {
  CloudOff,
  CloudUpload,
  Copy,
  EyeOff,
  Loader2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/toast-store';
import type { TempFile } from '@/db/schema';
import { formatBytes } from '@/lib/bytes';
import { cn } from '@/lib/utils';
import { FileGlyph } from './FileGlyph';
import { TempFileSheet } from './TempFileSheet';
import {
  cancelUpload,
  startUpload,
  useTempFiles,
  useTempFileStore,
  type UploadJob,
} from './tempfile-store';
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  expiryLabel,
  expiryShort,
  fileState,
  isShareable,
  quotaProblem,
  shareUrl,
  TEMP_QUOTA_BYTES,
  usedBytes,
  type ExpiryOption,
} from './tempfile-utils';
import { useNow, useOnlineStatus } from './useNow';

/**
 * Berkas publik (tempfile): simpan berkas di server dan bagikan lewat tautan yang bisa dibuka
 * siapa saja. Hanya pemilik akun yang bisa mengunggah; total 1 GB.
 *
 * Daftar dibaca dari database lokal (tetap tampil offline), tetapi setiap perubahan butuh
 * internet: kuota & pencabutan tautan ditegakkan server saat itu juga (lihat tempfile-api.ts).
 */
export function TempFilesPage() {
  const { files, isLoading } = useTempFiles();
  const jobs = useTempFileStore((s) => s.jobs);
  const now = useNow(30_000);
  const online = useOnlineStatus();
  const [expiry, setExpiry] = useState<ExpiryOption>(DEFAULT_EXPIRY);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const used = usedBytes(files, now);
  const detail = files.find((f) => f.id === detailId) ?? null;
  // Berkas yang sedang diunggah dari perangkat ini sudah tampil sebagai baris progres
  const uploading = new Set(
    jobs.filter((j) => j.fileId && j.phase !== 'done').map((j) => j.fileId),
  );
  const listed = files.filter((f) => !uploading.has(f.id));

  const onFiles = async (list: FileList | File[] | null) => {
    const picked = [...(list ?? [])];
    if (input.current) input.current.value = '';
    if (picked.length === 0) return;
    if (!navigator.onLine) {
      toast('Mengunggah butuh koneksi internet.', { tone: 'danger' });
      return;
    }
    // Pemeriksaan awal saja; server tetap menegakkan kuota secara atomik
    let planned = 0;
    for (const file of picked) {
      const problem = quotaProblem(file.size, files, Date.now(), planned);
      if (problem) {
        toast(`${file.name}: ${problem}`, { tone: 'danger' });
        continue;
      }
      planned += file.size;
      await startUpload(file, expiry);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void onFiles(e.dataTransfer.files);
  };

  return (
    <>
      <PageHeader
        title="Berkas"
        subtitle="Simpan & bagikan berkas lewat tautan publik"
        icon={CloudUpload}
        gradient="bg-gradient-files"
      />

      <div className="max-w-3xl space-y-4">
        {!online && (
          <div
            role="status"
            className="flex gap-3 rounded-2xl bg-warning/12 p-3.5 text-sm text-warning"
          >
            <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>Sedang offline. Daftar tetap bisa dilihat; unggah dan ubah butuh internet.</p>
          </div>
        )}

        <QuotaCard used={used} count={files.length} />

        <Card
          onDragOver={(e) => {
            e.preventDefault();
            if (online) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('space-y-4 transition', dragging && 'ring-2 ring-primary')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight">Unggah berkas</h2>
              <p className="text-sm text-muted">
                Maks. 1 GB total. Tautan publik langsung dibuat; bisa dicabut kapan saja.
              </p>
            </div>
            <Button onClick={() => input.current?.click()} disabled={!online}>
              <Upload aria-hidden="true" /> Pilih berkas
            </Button>
          </div>
          <div>
            <p id="tf-expiry" className="mb-1.5 text-xs font-semibold text-muted">
              Masa berlaku tautan & berkas
            </p>
            <ExpiryChoices value={expiry} onChange={setExpiry} labelledBy="tf-expiry" />
            <p className="mt-1.5 text-xs text-muted">
              Setelah lewat, tautan berhenti bekerja dan berkas dihapus otomatis.
            </p>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
        </Card>

        {jobs.length > 0 && (
          <ul aria-label="Unggahan berjalan" className="space-y-2">
            {jobs.map((j) => (
              <JobRow key={j.key} job={j} />
            ))}
          </ul>
        )}

        {isLoading ? (
          <ul aria-busy="true" aria-label="Memuat berkas" className="space-y-2">
            {[0, 1].map((i) => (
              <li key={i} className="h-[4.25rem] animate-pulse rounded-2xl glass" />
            ))}
          </ul>
        ) : listed.length === 0 ? (
          <Card>
            <EmptyState
              icon={CloudUpload}
              gradient="bg-gradient-files"
              title="Belum ada berkas"
              description="Unggah berkas untuk mendapatkan tautan yang bisa dibuka siapa saja, tanpa login."
            />
          </Card>
        ) : (
          <ul aria-label="Berkas" className="space-y-2">
            {listed.map((f) => (
              <FileRow key={f.id} file={f} now={now} onOpen={() => setDetailId(f.id)} />
            ))}
          </ul>
        )}
      </div>

      <TempFileSheet file={detail} now={now} online={online} onClose={() => setDetailId(null)} />
    </>
  );
}

function QuotaCard({ used, count }: { used: number; count: number }) {
  const pct = Math.min(100, (used / TEMP_QUOTA_BYTES) * 100);
  const tone = pct >= 95 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-gradient-files';
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">
          {formatBytes(used)} <span className="font-normal text-muted">dari 1 GB</span>
        </p>
        <p className="text-xs text-muted">{count} berkas</p>
      </div>
      <div
        role="progressbar"
        aria-label="Kuota penyimpanan berkas"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-2.5 overflow-hidden rounded-full bg-surface ring-1 ring-line ring-inset"
      >
        <div
          className={cn('h-full rounded-full transition-all', tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </Card>
  );
}

const PHASE_LABEL: Record<UploadJob['phase'], string> = {
  reserving: 'Memesan tempat…',
  uploading: 'Mengunggah',
  verifying: 'Memeriksa…',
  done: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};

function JobRow({ job }: { job: UploadJob }) {
  const dropJob = useTempFileStore((s) => s.dropJob);
  const active =
    job.phase === 'reserving' || job.phase === 'uploading' || job.phase === 'verifying';
  return (
    <li className="rounded-2xl p-3 glass">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface">
          {active ? (
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
          ) : job.phase === 'failed' ? (
            <TriangleAlert className="size-5 text-danger" aria-hidden="true" />
          ) : (
            <CloudUpload className="size-5 text-success" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{job.name}</p>
          <p className={cn('text-xs', job.phase === 'failed' ? 'text-danger' : 'text-muted')}>
            {PHASE_LABEL[job.phase]}
            {job.phase === 'uploading' && ` ${Math.round(job.progress * 100)}%`} ·{' '}
            {formatBytes(job.size)}
            {job.error && ` · ${job.error}`}
          </p>
        </div>
        {active ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Batalkan unggah ${job.name}`}
            onClick={() => cancelUpload(job.key)}
          >
            <X aria-hidden="true" />
          </Button>
        ) : (
          job.phase === 'failed' && (
            <Button variant="ghost" size="icon" aria-label="Tutup" onClick={() => dropJob(job.key)}>
              <X aria-hidden="true" />
            </Button>
          )
        )}
      </div>
      {job.phase === 'uploading' && (
        <div
          role="progressbar"
          aria-label={`Progres unggah ${job.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(job.progress * 100)}
          className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface ring-1 ring-line ring-inset"
        >
          <div
            className="h-full rounded-full bg-gradient-files transition-all"
            style={{ width: `${job.progress * 100}%` }}
          />
        </div>
      )}
    </li>
  );
}

function FileRow({ file, now, onOpen }: { file: TempFile; now: number; onOpen: () => void }) {
  const state = fileState(file, now);
  const shareable = isShareable(file, now);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(location.origin, file.share_token));
      toast('Tautan disalin', { tone: 'success' });
    } catch {
      toast('Tidak bisa menyalin. Buka detail berkas untuk menyalin manual.', { tone: 'danger' });
    }
  };
  return (
    <li className="flex items-center gap-1 rounded-2xl glass transition hover:bg-surface-strong">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
      >
        <FileGlyph mime={file.mime_type} name={file.file_name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{file.file_name}</span>
          {/*
            HP: dua baris tetap (ukuran · unduhan | sisa waktu + Privat) supaya tidak ada "·"
            menggantung di ujung baris saat teks membungkus. sm+: satu baris dengan pemisah.
          */}
          <span className="mt-0.5 flex flex-col gap-1 text-xs text-muted sm:flex-row sm:items-center sm:gap-2">
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span>{formatBytes(file.size_bytes)}</span>
              {state === 'ready' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{file.download_count}× diunduh</span>
                </>
              )}
              {state === 'pending' && <Badge tone="warning">Belum selesai</Badge>}
              {state === 'expired' && <Badge tone="danger">Kedaluwarsa</Badge>}
            </span>
            {state !== 'expired' && (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden="true" className="hidden sm:inline">
                  ·
                </span>
                <span title={expiryLabel(file.expires_at, now)}>
                  {expiryShort(file.expires_at, now)}
                </span>
                {state === 'ready' && file.is_public === 0 && (
                  <Badge>
                    <EyeOff aria-hidden="true" /> Privat
                  </Badge>
                )}
              </span>
            )}
          </span>
        </span>
      </button>
      {shareable && (
        <Button
          variant="ghost"
          size="icon"
          className="mr-2"
          aria-label={`Salin tautan ${file.file_name}`}
          onClick={() => void copy()}
        >
          <Copy aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

/**
 * Pilihan masa berlaku. Bukan SegmentedControl: lima pilihan tidak muat satu baris di HP
 * (≤ 400 px) — label patah dan "Tanpa batas" terpotong. Di sini membungkus menjadi 3 kolom di HP
 * dan 5 kolom di layar lebar. Pola ARIA sama (radiogroup + radio, panah kiri/kanan).
 */
function ExpiryChoices({
  value,
  onChange,
  labelledBy,
}: {
  value: ExpiryOption;
  onChange: (v: ExpiryOption) => void;
  labelledBy: string;
}) {
  const move = (dir: 1 | -1, from: number) => {
    const next = EXPIRY_CHOICES[(from + dir + EXPIRY_CHOICES.length) % EXPIRY_CHOICES.length]!;
    onChange(next.value);
    document.getElementById(`tf-exp-${next.value}`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid grid-cols-3 gap-1 rounded-xl p-1 glass sm:grid-cols-5"
    >
      {EXPIRY_CHOICES.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            id={`tf-exp-${opt.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(1, i);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1, i);
              }
            }}
            className={cn(
              'min-h-11 rounded-lg px-2 text-sm font-semibold whitespace-nowrap transition',
              active
                ? 'shine bg-gradient-brand text-white shadow-md shadow-fuchsia-500/20'
                : 'text-muted hover:text-fg',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
