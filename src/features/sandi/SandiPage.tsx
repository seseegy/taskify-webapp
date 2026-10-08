import { useStatus } from '@powersync/react';
import {
  CloudOff,
  Dices,
  History,
  KeyRound,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/toast-store';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useUser } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { env } from '@/lib/env';
import { GeneratorPanel } from './components/GeneratorPanel';
import { Avatar, ItemRow } from './components/ItemRow';
import { ItemSheet } from './components/ItemSheet';
import { RecoverScreen, type RecoverResult } from './components/RecoverScreen';
import { SetupWizard } from './components/SetupWizard';
import { UnlockScreen } from './components/UnlockScreen';
import { TotpCode } from './components/TotpCode';
import { TotpHistorySheet } from './components/TotpHistorySheet';
import { VaultSettingsSheet } from './components/VaultSettingsSheet';
import {
  resetPasswordWithRecovery,
  SandiError,
  unlockWithPassword,
  type RewrittenVault,
} from './crypto';
import {
  fetchRemoteKeyState,
  toKeyRecord,
  useDecryptedItems,
  useDecryptedTotpLog,
  usePwItemRows,
  usePwKey,
  usePwTotpLogRows,
  useRejectedKeyUploads,
  useSandiActions,
  type DecryptedItem,
} from './sandi-data';
import { syncClockOffset } from './totp-clock';
import { KEY_REJECTED_MESSAGE, REMOTE_KEY_MESSAGE, type RemoteKeyState } from './vault-guard';
import { useSandiStore } from './sandi-store';
import type { PwKeys } from '@/db/schema';

type Tab = 'brankas' | 'kode' | 'generator';

/** Apa yang ditampilkan saat brankas sudah terbuka. */
type VaultView = 'items' | 'codes';

/** URL: ?tab=brankas|generator */
export function SandiPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'generator' ? 'generator' : raw === 'kode' ? 'kode' : 'brankas';

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
        className="mb-5 w-full sm:w-96"
        options={[
          { value: 'brankas', label: 'Brankas', icon: <LockKeyhole /> },
          { value: 'kode', label: 'Kode', icon: <ShieldCheck /> },
          { value: 'generator', label: 'Generator', icon: <Dices /> },
        ]}
      />

      {tab === 'generator' ? (
        <div className="max-w-2xl">
          <GeneratorPanel />
        </div>
      ) : (
        <>
          <RejectedKeyBanner />
          <VaultTab view={tab === 'kode' ? 'codes' : 'items'} />
        </>
      )}
    </>
  );
}

// ============================================================================ penjagaan setup
/**
 * Server menolak record kunci dari perangkat ini karena brankas sudah dibuat di perangkat lain
 * (dua perangkat membuat bersamaan). Sandi yang sempat disimpan di sini ditulis dengan kunci
 * yang ditolak sehingga tidak akan bisa dibuka.
 */
function RejectedKeyBanner() {
  const rejected = useRejectedKeyUploads();
  const actions = useSandiActions();
  if (rejected.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex max-w-3xl gap-3 rounded-2xl bg-warning/12 p-3.5 text-sm text-warning"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p>
          <strong>Brankas dari perangkat ini ditolak server</strong> karena brankas sudah dibuat di
          perangkat lain. Buka dengan master password brankas yang pertama dibuat. Sandi yang sempat
          disimpan di sini dengan kunci yang ditolak tidak bisa dibuka; salinan kuncinya ada di
          Pengaturan → Sinkronisasi.
        </p>
        <Button variant="secondary" size="sm" onClick={() => void actions.dismissRejectedKeys()}>
          Mengerti, tutup
        </Button>
      </div>
    </div>
  );
}

/** Periksa SERVER sebelum menampilkan wizard; hasilnya menentukan layar yang tampil. */
function useRemoteKeyCheck(enabled: boolean) {
  const [result, setResult] = useState<{ attempt: number; value: RemoteKeyState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchRemoteKeyState().then((value) => {
      if (!cancelled) setResult({ attempt, value });
    });
    return () => {
      cancelled = true;
      setResult(null); // setiap kali dibutuhkan lagi, periksa ulang dari awal
    };
  }, [enabled, attempt]);
  const state: RemoteKeyState | 'checking' =
    enabled && result?.attempt === attempt ? result.value : 'checking';
  return { state, recheck: () => setAttempt((a) => a + 1) };
}

// ============================================================================ brankas
function VaultTab({ view }: { view: VaultView }) {
  const user = useUser();
  const { row, isLoading } = usePwKey();
  const hasSynced = Boolean(useStatus().hasSynced);
  const storedDek = useSandiStore((s) => s.dek);
  const stamp = useSandiStore((s) => s.stamp);
  const rekeying = useSandiStore((s) => s.rekeying);
  const unlock = useSandiStore((s) => s.unlock);
  const actions = useSandiActions();
  const [recovering, setRecovering] = useState(false);
  const remote = useRemoteKeyCheck(!isLoading && !row && hasSynced);

  // DEK di memori hanya sah untuk record kunci yang dipakai membukanya. Bila record berubah
  // (kunci diganti / DEK dirotasi di perangkat lain), DEK itu usang: kunci dan minta buka lagi.
  const stale = storedDek !== null && row !== null && stamp !== row.wrapped_key && !rekeying;
  const dek = stale ? null : storedDek;
  useEffect(() => {
    if (!stale) return;
    const s = useSandiStore.getState();
    if (s.dek && !s.rekeying && s.stamp !== row?.wrapped_key) {
      s.lock();
      toast('Kunci brankas diganti di perangkat lain. Buka lagi dengan master password terbaru.');
    }
  }, [stale, row?.wrapped_key]);

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
    if (remote.state !== 'none') {
      return (
        <Card className="mx-auto max-w-md" role="status">
          <EmptyState
            icon={CloudOff}
            gradient="bg-gradient-sandi"
            title={remote.state === 'checking' ? 'Memeriksa server…' : 'Belum bisa membuat brankas'}
            description={
              remote.state === 'checking'
                ? 'Memastikan brankas belum dibuat di perangkat lain.'
                : REMOTE_KEY_MESSAGE[remote.state]
            }
          >
            {remote.state !== 'checking' && (
              <Button variant="secondary" onClick={remote.recheck}>
                Periksa lagi
              </Button>
            )}
          </EmptyState>
        </Card>
      );
    }
    return (
      <SetupWizard
        userId={user.id}
        email={user.email}
        ready={hasSynced}
        onComplete={async (vault) => {
          // Periksa ulang tepat sebelum menyimpan: pengguna bisa saja lama di wizard.
          const latest = await fetchRemoteKeyState();
          if (latest !== 'none') throw new Error(REMOTE_KEY_MESSAGE[latest]);
          const keyId = await actions.createKey(vault.record);
          // Jangan buka brankas sebelum server menerima kuncinya (lihat vault-guard.ts).
          if ((await actions.confirmKeyUploaded(keyId)) === 'rejected')
            throw new Error(KEY_REJECTED_MESSAGE);
          unlock(vault.dek, vault.record.wrapped_key);
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
          onFinished={async (vault: RewrittenVault) => {
            const { skipped } = await actions.replaceVault(row.id, vault);
            setRecovering(false);
            unlock(vault.dek, vault.record.wrapped_key);
            if (skipped > 0)
              toast(`${skipped} sandi lama tidak bisa dibuka dan dibiarkan apa adanya.`);
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
            unlock(key, row.wrapped_key);
            return true;
          } catch (err) {
            if (err instanceof SandiError) throw err;
            throw new Error('Gagal membuka brankas. Coba lagi.', { cause: err });
          }
        }}
      />
    );
  }

  return view === 'codes' ? <CodesVault dek={dek} /> : <UnlockedVault dek={dek} keyRow={row} />;
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
        onUseCode={(item, code) =>
          void actions.recordTotpUse(dek, item.id, item.payload.title, code)
        }
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
        onReplaceVault={actions.replaceVault}
      />
    </div>
  );
}

// ============================================================================ tab Kode
/**
 * Taskify sebagai authenticator: hanya item yang punya kunci TOTP, dengan kode hidup dan hitung
 * mundur. Menyalin kode mencatatnya ke riwayat (`pw_totp_log`) tanpa mengubah item itu sendiri.
 */
function CodesVault({ dek }: { dek: CryptoKey }) {
  const user = useUser();
  const { rows, isLoading } = usePwItemRows();
  const { items, ready } = useDecryptedItems(rows, dek, user.id);
  const actions = useSandiActions();
  const lock = useSandiStore((s) => s.lock);

  const [search, setSearch] = useState('');
  const [history, setHistory] = useState(false);

  // Sekali saat tab dibuka: samakan jam dengan server dan buang riwayat kedaluwarsa.
  useEffect(() => {
    void syncClockOffset(`${env.supabaseUrl}/auth/v1/health`);
    void actions.purgeTotpLog();
  }, [actions]);

  const q = search.trim().toLowerCase();
  const codes = items
    .filter((i) => i.payload.totp)
    .filter(
      (i) => !q || [i.payload.title, i.payload.username].some((f) => f.toLowerCase().includes(q)),
    )
    .toSorted((a, b) => Number(b.payload.favorite) - Number(a.payload.favorite));

  const loading = isLoading || !ready;
  const total = items.filter((i) => i.payload.totp).length;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-0 basis-full items-center gap-2 rounded-xl px-3 glass sm:flex-1 sm:basis-0">
          <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari akun"
            aria-label="Cari kode"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
          />
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={() => setHistory(true)}>
            <History aria-hidden="true" /> <span className="hidden sm:inline">Riwayat</span>
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
        </div>
      </div>

      {loading ? (
        <ul aria-busy="true" aria-label="Memuat kode" className="space-y-2">
          {[0, 1].map((i) => (
            <li key={i} className="h-24 animate-pulse rounded-2xl glass" />
          ))}
        </ul>
      ) : total === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            gradient="bg-gradient-sandi"
            title="Belum ada kode TOTP"
            description="Buka sebuah sandi di tab Brankas, pilih Ubah, lalu tempel kunci rahasia atau URI otpauth:// dari situsnya."
          />
        </Card>
      ) : codes.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            gradient="bg-gradient-sandi"
            title="Tidak ada yang cocok"
            description={`Tidak ada akun untuk "${search.trim()}".`}
          >
            <Button variant="secondary" onClick={() => setSearch('')}>
              Hapus pencarian
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2">
          {codes.map((item) => (
            <li key={item.id} className="rounded-2xl p-3.5 glass">
              <div className="mb-2 flex min-w-0 items-center gap-3">
                <Avatar title={item.payload.title || 'Tanpa judul'} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {item.payload.title || 'Tanpa judul'}
                  </span>
                  {item.payload.username && (
                    <span className="block truncate text-xs text-muted">
                      {item.payload.username}
                    </span>
                  )}
                </span>
              </div>
              <TotpCode
                config={item.payload.totp!}
                name={item.payload.title || 'Tanpa judul'}
                size="lg"
                onUse={(code) => void actions.recordTotpUse(dek, item.id, item.payload.title, code)}
              />
            </li>
          ))}
        </ul>
      )}

      {history && <TotpHistory dek={dek} onClose={() => setHistory(false)} />}
    </div>
  );
}

/** Dipasang hanya saat panel riwayat dibuka, supaya dekripsi tidak jalan sia-sia. */
function TotpHistory({ dek, onClose }: { dek: CryptoKey; onClose: () => void }) {
  const user = useUser();
  const { rows, isLoading } = usePwTotpLogRows();
  const { entries, ready } = useDecryptedTotpLog(rows, dek, user.id);
  const actions = useSandiActions();

  return (
    <TotpHistorySheet
      open
      onClose={onClose}
      entries={entries}
      loading={isLoading || !ready}
      onDelete={actions.deleteTotpLogRow}
      onClearAll={actions.clearTotpLog}
    />
  );
}
