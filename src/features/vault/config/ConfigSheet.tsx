import { useStatus } from '@powersync/react';
import {
  ArrowLeftRight,
  FileCog,
  History,
  KeyRound,
  LockKeyhole,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { askConfirm } from '@/components/ui/confirm-store';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import { useSheetDirty } from '@/components/ui/sheet-dirty';
import { toast } from '@/components/ui/toast-store';
import { useUser } from '@/features/auth/auth-context';
import { UnlockScreen } from '@/features/sandi/components/UnlockScreen';
import { unlockWithPassword, SandiError } from '@/features/sandi/crypto';
import { forgetDevice, rememberDevice } from '@/features/sandi/device-trust';
import { toKeyRecord } from '@/features/sandi/sandi-data';
import { useSandiStore } from '@/features/sandi/sandi-store';
import { useVaultKey } from '@/features/sandi/useVaultKey';
import { isoToLocal, relativeDayLabel } from '@/lib/date';
import {
  useConfigActions,
  useConfigFile,
  useConfigVersions,
  useDecryptedVersions,
  type DecryptedVersion,
} from './config-data';
import { diffEntries, parseConfig, summarizeDiff } from './config-parse';
import { ConfigCompare } from './ConfigCompare';
import { ConfigEditor } from './ConfigEditor';
import { ConfigValues } from './ConfigValues';

type Tab = 'isi' | 'riwayat' | 'bandingkan';

/**
 * Panel satu berkas konfigurasi. Isinya butuh brankas Sandi terbuka, jadi panel ini sendiri yang
 * menjadi gerbangnya — pengguna tidak perlu pindah halaman dulu.
 *
 * Pemulihan master password (lupa) SENGAJA tidak ada di sini: itu operasi berat yang merotasi
 * kunci seluruh brankas, jadi tempatnya di halaman Sandi. Di sini hanya tautan ke sana.
 */
export function ConfigSheet({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const file = useConfigFile(fileId);
  const title = file ? file.name : 'Konfigurasi';

  return (
    <Sheet open={fileId !== null} onClose={onClose} title={title} wide>
      {fileId !== null && (
        <Gate key={fileId} fileId={fileId} fileName={file?.name ?? ''} onClose={onClose} />
      )}
    </Sheet>
  );
}

function Gate({
  fileId,
  fileName,
  onClose,
}: {
  fileId: string;
  fileName: string;
  onClose: () => void;
}) {
  const user = useUser();
  const { status, dek, keyRow } = useVaultKey();
  const unlock = useSandiStore((s) => s.unlock);

  if (status === 'syncing' || status === 'checking')
    return (
      <p className="py-8 text-center text-sm text-muted" role="status">
        Memeriksa brankas…
      </p>
    );

  if (status === 'absent')
    return (
      <EmptyState
        icon={KeyRound}
        gradient="bg-gradient-sandi"
        title="Butuh brankas Sandi"
        description="Isi konfigurasi dienkripsi dengan kunci brankas Sandi, jadi brankasnya harus dibuat lebih dulu. Metadata berkas (nama & lingkungan) tetap terlihat tanpa itu."
      >
        <Link
          to="/sandi"
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-primary transition hover:bg-surface"
        >
          Buka halaman Sandi
        </Link>
      </EmptyState>
    );

  if (!dek || !keyRow)
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-xl p-3 text-xs text-muted glass">
          <LockKeyhole className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Isi konfigurasi dienkripsi dengan brankas Sandi. Buka brankas untuk melihatnya.
        </p>
        <UnlockScreen
          email={user.email}
          onForgot={() => {
            onClose();
            toast('Pemulihan master password ada di halaman Sandi.');
          }}
          onUnlock={async (password, remember) => {
            try {
              const key = await unlockWithPassword(toKeyRecord(keyRow!), password, user.id);
              if (!key) return false;
              if (remember) await rememberDevice(key, keyRow!.wrapped_key);
              else await forgetDevice();
              unlock(key, keyRow!.wrapped_key);
              return true;
            } catch (err) {
              if (err instanceof SandiError) throw err;
              throw new Error('Gagal membuka brankas. Coba lagi.', { cause: err });
            }
          }}
        />
      </div>
    );

  // Hanya di-mount saat brankas TERBUKA: hasil dekripsi ikut hilang begitu dikunci.
  return <Body fileId={fileId} fileName={fileName} dek={dek} onClose={onClose} />;
}

function Body({
  fileId,
  fileName,
  dek,
  onClose,
}: {
  fileId: string;
  fileName: string;
  dek: CryptoKey;
  onClose: () => void;
}) {
  const user = useUser();
  const file = useConfigFile(fileId);
  const { versions: rows, isLoading } = useConfigVersions(fileId);
  const { versions, failed, ready } = useDecryptedVersions(fileId, rows, dek, user.id);
  const actions = useConfigActions();
  const hasSynced = Boolean(useStatus().hasSynced);

  const [tab, setTab] = useState<Tab>('isi');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  useSheetDirty(editing && dirty);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Versi yang sedang dilihat; null = versi terbaru. */
  const [viewingId, setViewingId] = useState<string | null>(null);

  const onDirtyChange = useCallback((v: boolean) => setDirty(v), []);

  // Brankas terkunci saat mengedit → draf hilang bersama komponen ini. Beri tahu, jangan diam.
  useEffect(() => {
    if (!editing) return;
    return () => {
      if (dirty) toast('Perubahan konfigurasi yang belum disimpan dibuang.');
    };
  }, [editing, dirty]);

  if (isLoading || !ready)
    return (
      <p className="py-8 text-center text-sm text-muted" role="status">
        Membuka isi konfigurasi…
      </p>
    );

  const latest = versions[0] ?? null;
  const viewing = (viewingId ? versions.find((v) => v.id === viewingId) : latest) ?? latest;
  const format = file?.format ?? 'env';

  const save = async (text: string, note: string) => {
    setSaving(true);
    setFailure(null);
    try {
      await actions.saveVersion(dek, fileId, { text, note });
      toast('Versi baru disimpan', { tone: 'success' });
      setEditing(false);
      setDirty(false);
      setViewingId(null);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = async () => {
    if (dirty) {
      const ok = await askConfirm({
        title: 'Buang perubahan?',
        description: 'Isi yang sudah kamu ubah tidak akan disimpan.',
        confirmLabel: 'Buang',
      });
      if (!ok) return;
    }
    setDirty(false);
    setEditing(false);
  };

  if (editing)
    return (
      <ConfigEditor
        format={format}
        initialText={viewing?.payload.text ?? ''}
        onCancel={() => void cancelEdit()}
        onSave={(text, note) => void save(text, note)}
        saving={saving}
        failure={failure}
        onDirtyChange={onDirtyChange}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-muted">
          <FileCog className="size-3.5 shrink-0" aria-hidden="true" />
          {format === 'json' ? 'JSON' : '.env'}
          {file?.environment && <> · {file.environment}</>}
          {versions.length > 0 && <> · {versions.length} versi</>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={async () => {
            const ok = await askConfirm({
              title: `Hapus "${fileName}"?`,
              description:
                'Seluruh riwayat versinya ikut terhapus. Bisa diurungkan dari toast, lalu dibuang permanen setelah 30 hari.',
              confirmLabel: 'Hapus',
            });
            if (!ok) return;
            await actions.removeFile(fileId, fileName);
            onClose();
          }}
        >
          <Trash2 aria-hidden="true" /> Hapus
        </Button>
      </div>

      {failed.length > 0 && (
        <div
          role="alert"
          className="flex gap-3 rounded-2xl bg-warning/12 p-3.5 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            <strong>{failed.length} versi tidak bisa dibuka.</strong> Kemungkinan ditulis dengan
            kunci brankas lain. Datanya tidak dihapus.
          </p>
        </div>
      )}

      <SegmentedControl<Tab>
        label="Bagian konfigurasi"
        value={tab}
        onChange={setTab}
        className="w-full sm:w-96"
        options={[
          { value: 'isi', label: 'Isi', icon: <FileCog /> },
          { value: 'riwayat', label: 'Riwayat', icon: <History /> },
          { value: 'bandingkan', label: 'Bandingkan', icon: <ArrowLeftRight /> },
        ]}
      />

      {tab === 'isi' &&
        (viewing ? (
          <div className="space-y-3">
            {viewing.id !== latest?.id && (
              <p className="flex flex-wrap items-center gap-2 rounded-xl bg-primary/10 p-2.5 text-xs text-primary">
                Melihat <strong>v{viewing.number}</strong> (bukan versi terbaru).
                <button
                  type="button"
                  onClick={() => setViewingId(null)}
                  className="min-h-9 rounded-lg px-2 font-semibold underline"
                >
                  Kembali ke terbaru
                </button>
              </p>
            )}
            <ConfigValues
              entries={parseConfig(viewing.payload.text, format).entries}
              text={viewing.payload.text}
              format={format}
              name={fileName}
            />
            <div className="flex justify-end border-t border-line pt-3">
              <Button onClick={() => setEditing(true)} disabled={!hasSynced}>
                <Pencil aria-hidden="true" /> Ubah
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-2xl p-3.5 text-sm text-muted glass">
            Tidak ada versi yang bisa dibuka.
          </p>
        ))}

      {tab === 'riwayat' && (
        <HistoryList
          versions={versions}
          format={format}
          onView={(id) => {
            setViewingId(id);
            setTab('isi');
          }}
          onRestore={async (v) => {
            const ok = await askConfirm({
              title: `Pulihkan v${v.number}?`,
              description:
                'Isi versi ini disimpan sebagai versi BARU. Riwayat tidak ada yang hilang.',
              confirmLabel: 'Pulihkan',
            });
            if (!ok) return;
            await save(v.payload.text, `Dipulihkan dari v${v.number}`);
          }}
        />
      )}

      {tab === 'bandingkan' && file && (
        <ConfigCompare
          fileId={fileId}
          fileName={fileName}
          format={format}
          versions={versions}
          dek={dek}
          userId={user.id}
        />
      )}
    </div>
  );
}

/** Riwayat versi: catatan perubahan + ringkasan perbedaan terhadap versi sebelumnya. */
function HistoryList({
  versions,
  format,
  onView,
  onRestore,
}: {
  versions: DecryptedVersion[];
  format: 'env' | 'json';
  onView: (id: string) => void;
  onRestore: (v: DecryptedVersion) => void;
}) {
  if (versions.length === 0)
    return <p className="text-sm text-muted">Belum ada versi yang bisa dibuka.</p>;

  return (
    <ul className="space-y-2">
      {versions.map((v, i) => {
        // versions terbaru lebih dulu → tetangga berikutnya adalah versi sebelumnya
        const previous = versions[i + 1];
        const changes = previous
          ? summarizeDiff(
              diffEntries(
                parseConfig(previous.payload.text, format).entries,
                parseConfig(v.payload.text, format).entries,
              ),
            )
          : 'versi pertama';
        const when = isoToLocal(v.created_at);
        return (
          <li key={v.id} className="rounded-2xl p-3 glass">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">v{v.number}</span>
              {i === 0 && (
                <span className="rounded-lg bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                  terbaru
                </span>
              )}
              <span className="text-xs text-muted">
                {relativeDayLabel(when.date)} {when.time}
              </span>
            </div>
            {v.payload.note && <p className="mt-1 text-sm">{v.payload.note}</p>}
            <p className="mt-0.5 text-xs text-muted">{changes ?? 'tidak ada perubahan kunci'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onView(v.id)}>
                Lihat
              </Button>
              {i !== 0 && (
                <Button variant="ghost" size="sm" onClick={() => onRestore(v)}>
                  <RotateCcw aria-hidden="true" /> Pulihkan
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
