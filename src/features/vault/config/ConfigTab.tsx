import { FileCog, KeyRound, Lock, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useVaultKey } from '@/features/sandi/useVaultKey';
import { isoToLocal, relativeDayLabel } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useConfigEnvironments, useConfigFiles, type ConfigFileRow } from './config-data';
import { ConfigDialog } from './ConfigDialog';

/**
 * Daftar berkas konfigurasi.
 *
 * Metadata (nama, format, lingkungan, project, waktu) disimpan TEKS BIASA justru supaya layar ini
 * tetap berguna saat brankas terkunci: pengguna bisa melihat berkas apa saja yang ada dan kapan
 * terakhir berubah, lalu membuka brankas hanya ketika benar-benar perlu melihat isinya.
 */
export function ConfigTab({
  onOpen,
  projectId,
}: {
  onOpen: (id: string) => void;
  /** Dibatasi ke satu project (dipakai di panel Project). */
  projectId?: string | null;
}) {
  const [search, setSearch] = useState('');
  const [environment, setEnvironment] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { files, isLoading } = useConfigFiles({ search, environment, projectId });
  const environments = useConfigEnvironments();
  const { status, dek } = useVaultKey();

  const grouped = groupByProject(files);
  const filtering = search.trim() !== '' || environment !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 glass">
          <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama berkas atau lingkungan…"
            aria-label="Cari konfigurasi"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
          />
        </label>
        <Button
          aria-label="Konfigurasi baru"
          disabled={!dek}
          title={dek ? undefined : 'Buka brankas Sandi dulu'}
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" /> <span className="hidden sm:inline">Konfigurasi</span>
        </Button>
      </div>

      {/* Chip lingkungan: dibungkus (flex-wrap) supaya label tidak pernah terpotong di HP */}
      {environments.length > 0 && (
        <div role="group" aria-label="Filter lingkungan" className="flex flex-wrap gap-1.5">
          <FilterChip active={environment === null} onClick={() => setEnvironment(null)}>
            Semua
          </FilterChip>
          {environments.map((e) => (
            <FilterChip
              key={e.environment}
              active={environment === e.environment}
              onClick={() => setEnvironment(e.environment)}
            >
              {e.environment} ({e.n})
            </FilterChip>
          ))}
        </div>
      )}

      {status === 'absent' && files.length === 0 ? (
        <Card>
          <EmptyState
            icon={KeyRound}
            gradient="bg-gradient-sandi"
            title="Butuh brankas Sandi"
            description="Isi .env hampir selalu rahasia, jadi dienkripsi dengan kunci brankas Sandi. Buat brankasnya dulu, lalu kembali ke sini."
          >
            <Link
              to="/sandi"
              className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-primary transition hover:bg-surface"
            >
              Buka halaman Sandi
            </Link>
          </EmptyState>
        </Card>
      ) : isLoading ? (
        <ul aria-busy="true" aria-label="Memuat konfigurasi" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-16 animate-pulse rounded-2xl glass" />
          ))}
        </ul>
      ) : files.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileCog}
            gradient="bg-gradient-vault"
            title={filtering ? 'Tidak ada yang cocok' : 'Belum ada konfigurasi'}
            description={
              filtering
                ? 'Coba kata lain atau hapus filter lingkungan.'
                : 'Simpan .env atau config JSON di sini. Setiap simpan menjadi versi baru, jadi perubahannya bisa dilacak dan dibandingkan antar lingkungan.'
            }
          >
            {!filtering && dek && (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" /> Konfigurasi pertama
              </Button>
            )}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([project, rows]) => (
            <section key={project ?? '—'} aria-label={project ?? 'Tanpa project'}>
              <h3 className="mb-2 px-1 text-xs font-bold tracking-wide text-muted uppercase">
                {project ?? 'Tanpa project'}
              </h3>
              <ul className="space-y-2">
                {rows.map((f) => (
                  <FileRow key={f.id} file={f} locked={!dek} onOpen={() => onOpen(f.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {dek && (
        <ConfigDialog
          open={creating}
          dek={dek}
          defaultProjectId={projectId ?? null}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-h-9 rounded-lg px-2.5 text-xs font-semibold transition',
        active ? 'bg-gradient-vault text-white' : 'text-muted glass hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function FileRow({
  file,
  locked,
  onOpen,
}: {
  file: ConfigFileRow;
  locked: boolean;
  onOpen: () => void;
}) {
  const when = file.latest_at ? isoToLocal(file.latest_at) : null;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 w-full items-center gap-3 rounded-2xl p-3 text-left glass transition hover:bg-surface-strong"
      >
        <span className="shine flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-vault text-white shadow-md">
          <FileCog className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-sm font-bold">{file.name}</span>
            {file.environment && (
              <span className="rounded-lg bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                {file.environment}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted">
            {file.versions === 0
              ? 'Belum ada versi'
              : `v${file.versions} · ${when ? `${relativeDayLabel(when.date)} ${when.time}` : '—'}`}
          </span>
        </span>
        {/* Gembok = isinya terenkripsi dan brankas sedang terkunci (bukan sekadar warna) */}
        {locked && (
          <>
            <Lock className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <span className="sr-only">terenkripsi, brankas terkunci</span>
          </>
        )}
      </button>
    </li>
  );
}

/** Kelompokkan per project; "Tanpa project" selalu paling bawah. */
function groupByProject(files: ConfigFileRow[]): [string | null, ConfigFileRow[]][] {
  const map = new Map<string | null, ConfigFileRow[]>();
  for (const f of files) {
    const key = f.project_name ?? null;
    const list = map.get(key);
    if (list) list.push(f);
    else map.set(key, [f]);
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b, 'id');
  });
}
