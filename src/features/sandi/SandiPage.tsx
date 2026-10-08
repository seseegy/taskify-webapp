import { useStatus } from '@powersync/react';
import {
  CloudOff,
  Dices,
  KeyRound,
  LockKeyhole,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useUser } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { GeneratorPanel } from './components/GeneratorPanel';
import { ItemRow } from './components/ItemRow';
import { ItemSheet } from './components/ItemSheet';
import { RecoverScreen, type RecoverResult } from './components/RecoverScreen';
import { SetupWizard } from './components/SetupWizard';
import { UnlockScreen } from './components/UnlockScreen';
import { VaultSettingsSheet } from './components/VaultSettingsSheet';
import { resetPasswordWithRecovery, SandiError, unlockWithPassword, type NewVault } from './crypto';
import {
  toKeyRecord,
  useDecryptedItems,
  usePwItemRows,
  usePwKey,
  useSandiActions,
  type DecryptedItem,
} from './sandi-data';
import { useSandiStore } from './sandi-store';
import type { PwKeys } from '@/db/schema';

type Tab = 'brankas' | 'generator';

/** URL: ?tab=brankas|generator */
export function SandiPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'generator' ? 'generator' : 'brankas';

  return (
    <>
      <PageHeader
        title="Sandi"
        subtitle="Brankas terenkripsi & pembuat sandi"
        icon={KeyRound}
        gradient="bg-gradient-sandi"
      />

      <SegmentedControl<Tab>
        label="Bagian sandi"
        value={tab}
        onChange={(t) => setParams(t === 'brankas' ? {} : { tab: t }, { replace: true })}
        className="mb-5 w-full sm:w-80"
        options={[
          { value: 'brankas', label: 'Brankas', icon: <LockKeyhole /> },
          { value: 'generator', label: 'Generator', icon: <Dices /> },
        ]}
      />

      {tab === 'generator' ? (
        <div className="max-w-2xl">
          <GeneratorPanel />
        </div>
      ) : (
        <VaultTab />
      )}
    </>
  );
}

// ============================================================================ brankas
function VaultTab() {
  const user = useUser();
  const { row, isLoading } = usePwKey();
  const hasSynced = Boolean(useStatus().hasSynced);
  const dek = useSandiStore((s) => s.dek);
  const unlock = useSandiStore((s) => s.unlock);
  const actions = useSandiActions();
  const [recovering, setRecovering] = useState(false);

  // Jangan tampilkan "buat brankas" sebelum sinkron pertama selesai: brankas bisa saja sudah ada
  // di server tetapi belum sampai ke perangkat ini.
  if (isLoading || (!row && !hasSynced)) {
    return (
      <Card className="mx-auto max-w-md" role="status">
        <EmptyState
          icon={CloudOff}
          gradient="bg-gradient-sandi"
          title="Menyinkronkan…"
          description="Memeriksa apakah brankas sudah ada. Pertama kali dipakai di perangkat ini butuh internet."
        />
      </Card>
    );
  }

  if (!row) {
    return (
      <SetupWizard
        userId={user.id}
        email={user.email}
        ready={hasSynced}
        onComplete={async (vault) => {
          await actions.createKey(vault.record);
          unlock(vault.dek);
        }}
      />
    );
  }

  if (!dek) {
    if (recovering) {
      return (
        <RecoverScreen
          email={user.email}
          onCancel={() => setRecovering(false)}
          onRecover={async (recoveryKey, newPassword): Promise<RecoverResult> => {
            try {
              const vault = await resetPasswordWithRecovery(
                toKeyRecord(row),
                recoveryKey,
                newPassword,
                user.id,
              );
              if (!vault)
                return {
                  ok: false,
                  message: 'Kunci pemulihan salah atau salah ketik. Periksa lagi.',
                };
              // Belum disimpan: RecoverScreen menyimpan setelah pengguna mengonfirmasi kunci baru.
              return { ok: true, vault };
            } catch (err) {
              return {
                ok: false,
                message: err instanceof Error ? err.message : 'Gagal memulihkan brankas.',
              };
            }
          }}
          onFinished={async (vault: NewVault) => {
            await actions.replaceKey(row.id, vault.record);
            setRecovering(false);
            unlock(vault.dek);
          }}
        />
      );
    }
    return (
      <UnlockScreen
        email={user.email}
        onForgot={() => setRecovering(true)}
        onUnlock={async (password) => {
          try {
            const key = await unlockWithPassword(toKeyRecord(row), password, user.id);
            if (!key) return false;
            unlock(key);
            return true;
          } catch (err) {
            if (err instanceof SandiError) throw err;
            throw new Error('Gagal membuka brankas. Coba lagi.', { cause: err });
          }
        }}
      />
    );
  }

  return <UnlockedVault dek={dek} keyRow={row} />;
}

// ============================================================================ terbuka
/**
 * HANYA di-mount saat brankas terbuka: begitu dikunci, komponen ini unmount dan seluruh hasil
 * dekripsi (plaintext) di state-nya ikut hilang.
 */
function UnlockedVault({ dek, keyRow }: { dek: CryptoKey; keyRow: PwKeys }) {
  const user = useUser();
  const { rows, isLoading } = usePwItemRows();
  const { items, failed, ready } = useDecryptedItems(rows, dek, user.id);
  const actions = useSandiActions();
  const lock = useSandiStore((s) => s.lock);

  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [sheet, setSheet] = useState<{ item: DecryptedItem | null } | null>(null);
  const [settings, setSettings] = useState(false);

  const q = search.trim().toLowerCase();
  const visible = items
    .filter((i) => !onlyFavorites || i.payload.favorite)
    .filter(
      (i) =>
        !q ||
        [i.payload.title, i.payload.url, i.payload.username, i.payload.notes].some((f) =>
          f.toLowerCase().includes(q),
        ),
    )
    .toSorted((a, b) => Number(b.payload.favorite) - Number(a.payload.favorite));

  const loading = isLoading || !ready;

  return (
    <div className="max-w-3xl space-y-4">
      {/* ------------------------------------------------------------ toolbar */}
      {/* HP: pencarian satu baris penuh, lalu filter di kiri dan aksi di kanan. sm+: satu baris. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-0 basis-full items-center gap-2 rounded-xl px-3 glass sm:flex-1 sm:basis-0">
          <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul, situs, atau username"
            aria-label="Cari sandi"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
          />
        </label>
        <div className="flex flex-1 items-center justify-between gap-2 sm:flex-none">
          <Button
            variant={onlyFavorites ? 'primary' : 'secondary'}
            aria-pressed={onlyFavorites}
            onClick={() => setOnlyFavorites((v) => !v)}
          >
            <Star className={cn(onlyFavorites && 'fill-current')} aria-hidden="true" /> Favorit
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="size-11 px-0"
              aria-label="Pengaturan brankas"
              title="Pengaturan brankas"
              onClick={() => setSettings(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </Button>
            <Button
              variant="secondary"
              onClick={lock}
              aria-label="Kunci brankas sekarang"
              title="Kunci brankas sekarang"
              className="max-sm:size-11 max-sm:px-0"
            >
              <LockKeyhole aria-hidden="true" /> <span className="hidden sm:inline">Kunci</span>
            </Button>
            <Button
              onClick={() => setSheet({ item: null })}
              aria-label="Tambah sandi"
              className="max-sm:size-11 max-sm:px-0"
            >
              <Plus aria-hidden="true" /> <span className="hidden sm:inline">Tambah</span>
            </Button>
          </div>
        </div>
      </div>

      {failed.length > 0 && (
        <div
          role="alert"
          className="flex gap-3 rounded-2xl bg-warning/12 p-3.5 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            <strong>{failed.length} sandi tidak bisa dibuka.</strong> Kemungkinan dibuat dengan
            kunci brankas lain atau datanya rusak. Data tidak dihapus.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------ daftar */}
      {loading ? (
        <ul aria-busy="true" aria-label="Memuat sandi" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-[4.25rem] animate-pulse rounded-2xl glass" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={KeyRound}
            gradient="bg-gradient-sandi"
            title="Brankas masih kosong"
            description="Simpan sandi pertamamu. Semuanya dienkripsi di perangkat ini sebelum disinkronkan."
          >
            <Button onClick={() => setSheet({ item: null })}>
              <Plus aria-hidden="true" /> Tambah sandi pertama
            </Button>
          </EmptyState>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            gradient="bg-gradient-sandi"
            title="Tidak ada yang cocok"
            description={
              onlyFavorites && !q
                ? 'Belum ada sandi favorit.'
                : `Tidak ada sandi untuk "${search.trim()}".`
            }
          >
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setOnlyFavorites(false);
              }}
            >
              Hapus pencarian
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <>
          <p className="px-1 text-xs text-muted" role="status">
            {visible.length === items.length
              ? `${items.length} sandi`
              : `${visible.length} dari ${items.length} sandi`}
          </p>
          <ul className="space-y-2">
            {visible.map((item) => (
              <ItemRow key={item.id} item={item} onOpen={() => setSheet({ item })} />
            ))}
          </ul>
        </>
      )}

      <ItemSheet
        open={sheet !== null}
        item={sheet?.item ?? null}
        onClose={() => setSheet(null)}
        onSave={(payload, id) => actions.saveItem(dek, payload, id)}
        onDelete={(item) => actions.removeItem(item.id, item.payload.title)}
      />
      <VaultSettingsSheet
        open={settings}
        onClose={() => setSettings(false)}
        email={user.email}
        userId={user.id}
        keyId={keyRow.id}
        record={toKeyRecord(keyRow)}
        onReplaceKey={actions.replaceKey}
      />
    </div>
  );
}
