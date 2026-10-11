import { Eye, EyeOff, Minus, Plus, Equal, PencilLine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Disclosure } from '@/components/ui/Disclosure';
import { Listbox } from '@/components/ui/Listbox';
import { Label } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import {
  useConfigFiles,
  useConfigVersions,
  useDecryptedVersions,
  type DecryptedVersion,
} from './config-data';
import { diffEntries, parseConfig, type ConfigDiff, type ConfigFormat } from './config-parse';

const MASK = '••••••';

/** Prefiks pembeda antara "versi berkas ini" dan "berkas lain" di satu Listbox. */
const FILE_PREFIX = 'file:';

/**
 * Perbandingan PER KUNCI (untuk JSON per path). Dua kegunaannya:
 *   1. apa yang berubah antar versi berkas ini;
 *   2. kunci apa yang belum ada di lingkungan lain — bandingkan `.env` production dengan staging.
 *      Ini sumber bug deploy yang paling sering, dan satu-satunya cara menjawabnya adalah
 *      membandingkan kunci, bukan baris.
 */
export function ConfigCompare({
  fileId,
  fileName,
  format,
  versions,
  dek,
  userId,
}: {
  fileId: string;
  fileName: string;
  format: ConfigFormat;
  /** Versi berkas ini yang sudah didekripsi, terbaru lebih dulu. */
  versions: DecryptedVersion[];
  dek: CryptoKey;
  userId: string;
}) {
  // Bawaan: versi sebelumnya → versi terbaru (pertanyaan "apa yang baru saja berubah?")
  const [from, setFrom] = useState(() => versions[1]?.id ?? versions[0]?.id ?? '');
  const [to, setTo] = useState(() => versions[0]?.id ?? '');
  const [reveal, setReveal] = useState(false);

  const { files } = useConfigFiles();
  const otherFiles = files.filter((f) => f.id !== fileId && f.versions > 0);

  const otherId = to.startsWith(FILE_PREFIX) ? to.slice(FILE_PREFIX.length) : null;
  const other = files.find((f) => f.id === otherId) ?? null;

  // Berkas pembanding: cukup versi TERBARU-nya
  const { versions: otherVersions } = useConfigVersions(otherId);
  const latestOfOther = useMemo(() => otherVersions.slice(0, 1), [otherVersions]);
  const otherDecrypted = useDecryptedVersions(otherId, latestOfOther, dek, userId);

  const byId = new Map(versions.map((v) => [v.id, v]));
  const fromVersion = byId.get(from) ?? null;
  const toVersion = otherId ? null : (byId.get(to) ?? null);
  const otherPayload = otherDecrypted.versions[0]?.payload ?? null;

  const versionOptions = versions.map((v) => ({
    value: v.id,
    label: `v${v.number}${v.payload.note ? ` · ${v.payload.note}` : ''}`,
  }));

  const toOptions = [
    ...versionOptions,
    ...otherFiles.map((f) => ({
      value: FILE_PREFIX + f.id,
      label: `Berkas lain: ${f.name}${f.environment ? ` (${f.environment})` : ''}`,
    })),
  ];

  const toText = otherId ? otherPayload?.text : toVersion?.payload.text;
  const toLabel = otherId
    ? other
      ? `${other.name}${other.environment ? ` · ${other.environment}` : ''}`
      : 'berkas lain'
    : toVersion
      ? `v${toVersion.number}`
      : '—';

  const diff = useMemo<ConfigDiff | null>(() => {
    if (!fromVersion || toText === undefined || toText === null) return null;
    // Format pembanding mengikuti format berkas ini; membandingkan .env dengan JSON tetap
    // bermakna karena keduanya diratakan menjadi kunci → nilai.
    return diffEntries(
      parseConfig(fromVersion.payload.text, format).entries,
      parseConfig(toText, otherId ? (other?.format ?? format) : format).entries,
    );
  }, [fromVersion, toText, format, otherId, other?.format]);

  if (versions.length === 0)
    return <p className="text-sm text-muted">Belum ada versi untuk dibandingkan.</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="cmp-from">Dari</Label>
          <Listbox id="cmp-from" value={from} onChange={setFrom} options={versionOptions} />
        </div>
        <div>
          <Label htmlFor="cmp-to">Ke</Label>
          <Listbox id="cmp-to" value={to} onChange={setTo} options={toOptions} />
        </div>
      </div>

      <p className="text-xs text-muted">
        Membandingkan <strong>{fromVersion ? `v${fromVersion.number}` : '—'}</strong> dari{' '}
        {fileName} dengan <strong>{toLabel}</strong>. Perbandingan per kunci, jadi memindahkan baris
        atau mengubah komentar tidak dihitung sebagai perubahan.
      </p>

      {otherId && !otherDecrypted.ready ? (
        <p className="text-sm text-muted" role="status">
          Membuka berkas pembanding…
        </p>
      ) : otherId && !otherPayload ? (
        <p className="rounded-xl bg-warning/12 p-3 text-sm text-warning">
          Versi terbaru berkas itu tidak bisa dibuka dengan kunci brankas saat ini.
        </p>
      ) : !diff ? (
        <p className="text-sm text-muted">Pilih dua sisi untuk dibandingkan.</p>
      ) : (
        <>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={reveal}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            {reveal ? 'Sembunyikan nilai' : 'Tampilkan nilai'}
          </Button>

          <DiffGroup
            icon={Plus}
            tone="success"
            title="Ditambah"
            rows={diff.added.map((e) => ({ key: e.key, to: e.value }))}
            reveal={reveal}
          />
          <DiffGroup
            icon={PencilLine}
            tone="warning"
            title="Diubah"
            rows={diff.changed}
            reveal={reveal}
          />
          <DiffGroup
            icon={Minus}
            tone="danger"
            title="Dihapus"
            rows={diff.removed.map((e) => ({ key: e.key, from: e.value }))}
            reveal={reveal}
          />

          {diff.same.length > 0 && (
            <Disclosure summary={`Sama (${diff.same.length})`}>
              <ul className="mt-2 space-y-1">
                {diff.same.map((e) => (
                  <li key={e.key} className="flex items-center gap-2 rounded-xl px-3 py-2 glass">
                    <Equal className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 font-mono text-xs break-all">{e.key}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}

          {diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0 && (
            <p className="rounded-2xl p-3.5 text-sm text-muted glass" role="status">
              Tidak ada perbedaan kunci antara keduanya.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const TONE = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/10 text-danger',
} as const;

/**
 * Satu kelompok perbedaan. Ditandai ikon + teks + warna sekaligus: warna saja tidak boleh
 * menjadi satu-satunya pembeda.
 */
function DiffGroup({
  icon: Icon,
  tone,
  title,
  rows,
  reveal,
}: {
  icon: typeof Plus;
  tone: keyof typeof TONE;
  title: string;
  rows: { key: string; from?: string; to?: string }[];
  reveal: boolean;
}) {
  if (rows.length === 0) return null;
  const show = (v: string | undefined) =>
    v === undefined ? null : reveal ? (
      v === '' ? (
        <span className="text-muted italic">kosong</span>
      ) : (
        v
      )
    ) : (
      MASK
    );

  return (
    <section aria-label={`${title} (${rows.length})`} className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 px-1 text-xs font-bold">
        <Icon className="size-3.5" aria-hidden="true" />
        {title} ({rows.length})
      </h4>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className={cn('rounded-xl px-3 py-2', TONE[tone])}>
            <span className="block font-mono text-xs font-bold break-all">{r.key}</span>
            <span className="block font-mono text-xs break-all">
              {r.from !== undefined && r.to !== undefined ? (
                <>
                  {show(r.from)} <span aria-label="menjadi">→</span> {show(r.to)}
                </>
              ) : (
                show(r.from ?? r.to)
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
