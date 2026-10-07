import { useQuery } from '@powersync/react';
import {
  BellRing,
  Download,
  Hash,
  Trash2,
  CloudAlert,
  HardDrive,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SyncStatus } from '@/components/layout/SyncStatus';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useDatabase } from '@/db/database-context';
import { useAuth, useUser } from '@/features/auth/auth-context';
import { useLockStore } from '@/features/lock/lock-store';
import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { useAllTags } from '@/features/tags/tag-actions';
import { TagChip } from '@/features/tags/TagPicker';
import { Link } from 'react-router';
import { useTheme, type ThemePreference } from '@/features/theme/theme-context';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast-store';
import { clearDeviceData } from './clear-device-data';
import { exportAllData } from './export-data';
import { PinSettings } from './PinSettings';
import { UploadErrors } from './UploadErrors';
import { formatBytes, useStorageInfo } from './useStorageInfo';

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Pengaturan"
        subtitle="Tampilan, keamanan, dan sinkronisasi"
        icon={Settings}
        gradient="bg-gradient-settings"
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <AppearanceSection />
        <SecuritySection />
        <Section icon={BellRing} title="Notifikasi pengingat" gradient="bg-gradient-journal">
          <NotificationSettings />
        </Section>
        <SyncSection />
        <DataSection />
        <AccountSection />
      </div>
    </>
  );
}

function Section({
  icon: Icon,
  title,
  gradient,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  gradient: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('animate-fade-up', className)}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            'shine flex size-9 items-center justify-center rounded-xl text-white shadow-md',
            gradient,
          )}
        >
          <Icon className="size-4" />
        </span>
        <h2 className="font-bold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function AppearanceSection() {
  const { preference, setPreference } = useTheme();
  return (
    <Section icon={Palette} title="Tampilan" gradient="bg-gradient-brand">
      <SegmentedControl<ThemePreference>
        label="Tema"
        value={preference}
        onChange={setPreference}
        options={[
          { value: 'system', label: 'Sistem', icon: <Monitor /> },
          { value: 'light', label: 'Terang', icon: <Sun /> },
          { value: 'dark', label: 'Gelap', icon: <Moon /> },
        ]}
      />
      <p className="mt-3 text-xs text-muted">
        Tema disimpan per perangkat. Terang = &ldquo;Aurora pagi&rdquo;, Gelap = &ldquo;Nebula
        malam&rdquo;.
      </p>
    </Section>
  );
}

function SecuritySection() {
  const enabled = useLockStore((s) => s.config !== null);
  return (
    <Section icon={ShieldCheck} title="Kunci aplikasi" gradient="bg-gradient-tasks">
      <div className="mb-3">
        <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'PIN aktif' : 'Tanpa PIN'}</Badge>
      </div>
      <PinSettings />
      <p className="mt-4 text-xs text-muted">
        PIN mengunci tampilan di perangkat ini saja, bukan mengenkripsi data.
      </p>
    </Section>
  );
}

function SyncSection() {
  const { powerSync, vfs } = useDatabase();
  const { info, requestPersist } = useStorageInfo();
  const pending = usePendingUploads();
  const { data: errorRows } = useQuery<{ n: number }>('SELECT COUNT(*) AS n FROM upload_errors');
  const failed = errorRows[0]?.n ?? 0;

  return (
    <Section icon={HardDrive} title="Sinkronisasi & penyimpanan" gradient="bg-gradient-vault">
      <dl className="space-y-3 text-sm">
        <Row label="Status">
          <SyncStatus />
        </Row>
        <Row label="Menunggu diunggah">{pending ?? '–'} perubahan</Row>
        {failed > 0 && (
          <Row label="Ditolak server">
            <Badge tone="danger">
              <CloudAlert /> {failed} perubahan
            </Badge>
          </Row>
        )}
        <Row label="Penyimpanan persisten">
          {info.persisted ? (
            <Badge tone="success">Aktif</Badge>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void requestPersist()}>
              Aktifkan
            </Button>
          )}
        </Row>
        <Row label="Terpakai">
          {formatBytes(info.usage)} dari {formatBytes(info.quota)}
        </Row>
        <Row label="Mesin database">
          <span className="font-mono text-xs">{vfs}</span>
        </Row>
      </dl>
      {failed > 0 && <UploadErrors />}
      <p className="mt-4 text-xs text-muted">
        Semua data tersimpan di perangkat & bisa dipakai offline. Perubahan dikirim ke server
        otomatis saat online.
      </p>
      {import.meta.env.DEV && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => console.log(powerSync.currentStatus)}
        >
          Log status sync (dev)
        </Button>
      )}
    </Section>
  );
}

function AccountSection() {
  const user = useUser();
  const { signOut } = useAuth();
  const { powerSync } = useDatabase();
  const [loading, setLoading] = useState(false);

  const onLogout = async () => {
    const stats = await powerSync.getUploadQueueStats();
    const warning =
      stats.count > 0
        ? `Masih ada ${stats.count} perubahan yang BELUM terunggah dan akan HILANG. Tetap keluar?`
        : 'Keluar dan hapus data lokal dari perangkat ini? (Data tetap aman di server.)';
    if (!window.confirm(warning)) return;

    setLoading(true);
    try {
      await powerSync.disconnectAndClear();
      await clearDeviceData();
      await signOut();
      location.assign('/');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section icon={UserRound} title="Akun" gradient="bg-gradient-journal">
      <dl className="space-y-3 text-sm">
        <Row label="Email">{user.email}</Row>
        <Row label="Versi aplikasi">v{__APP_VERSION__}</Row>
      </dl>
      <Button variant="danger" className="mt-5" onClick={() => void onLogout()} loading={loading}>
        <LogOut /> Keluar
      </Button>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

/** Jumlah operasi di antrean upload (di-poll ringan karena tidak ada event khusus). */
function usePendingUploads() {
  const { powerSync } = useDatabase();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const stats = await powerSync.getUploadQueueStats();
      if (alive) setCount(stats.count);
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [powerSync]);

  return count;
}

function DataSection() {
  const tags = useAllTags();
  const { powerSync } = useDatabase();
  const user = useUser();
  const [busy, setBusy] = useState(false);
  return (
    <Section icon={Hash} title="Data, tag & Sampah" gradient="bg-gradient-brand">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {tags.length === 0 ? (
          <p className="text-sm text-muted">
            Belum ada tag. Ketik #nama saat menambah tugas atau di Cari &amp; catat cepat.
          </p>
        ) : (
          tags.map((t) => <TagChip key={t.id} tag={t} />)
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const n = await exportAllData(powerSync, user.id);
              toast(`${n} baris diekspor`, { tone: 'success' });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download /> Ekspor semua data (JSON)
        </Button>
        <Link
          to="/sampah"
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-primary hover:bg-surface"
        >
          <Trash2 className="size-4" /> Buka Sampah
        </Link>
      </div>
      <p className="mt-3 text-xs text-muted">
        Ekspor dibuat dari data di perangkat ini, jadi tetap bisa dipakai saat offline. Server juga
        dicadangkan otomatis tiap minggu (lihat docs/SETUP.md §9).
      </p>
    </Section>
  );
}
