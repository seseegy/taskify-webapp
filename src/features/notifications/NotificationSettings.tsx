import { BellOff, BellRing, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { toast } from '@/components/ui/toast-store';
import { readNotificationPrefs, writeNotificationPrefs } from './notification-prefs';
import { disablePush, enablePush, sendTestPush, type PushState } from './push';
import { usePushStatus } from './usePushStatus';

const INFO: Record<
  PushState,
  { badge: string; tone: 'success' | 'neutral' | 'warning' | 'danger'; hint: string }
> = {
  loading: { badge: 'Memeriksa…', tone: 'neutral', hint: '' },
  on: {
    badge: 'Aktif',
    tone: 'success',
    hint: 'Pengingat tugas dikirim ke perangkat ini, termasuk saat aplikasi ditutup.',
  },
  off: {
    badge: 'Nonaktif',
    tone: 'neutral',
    hint: 'Aktifkan agar pengingat tugas muncul sebagai notifikasi.',
  },
  denied: {
    badge: 'Diblokir',
    tone: 'danger',
    hint: 'Izin notifikasi diblokir. Buka pengaturan situs di browser → Notifikasi → Izinkan.',
  },
  'no-sw': {
    badge: 'Belum tersedia',
    tone: 'warning',
    hint: 'Notifikasi butuh service worker: pakai versi build (pnpm build && pnpm preview) atau yang sudah di-deploy.',
  },
  'no-key': {
    badge: 'Belum dikonfigurasi',
    tone: 'warning',
    hint: 'VITE_VAPID_PUBLIC_KEY belum diisi. Lihat docs/SETUP.md bagian Pengingat.',
  },
  unsupported: {
    badge: 'Tidak didukung',
    tone: 'neutral',
    hint: 'Browser ini tidak mendukung Web Push. Di Android, pasang Taskify dari Chrome terlebih dahulu.',
  },
};

export function NotificationSettings() {
  const { state, refresh } = usePushStatus();
  const [busy, setBusy] = useState<'enable' | 'disable' | 'test' | null>(null);
  const info = INFO[state];

  const run = async (kind: 'enable' | 'disable' | 'test', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'danger', duration: 7000 });
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  return (
    <div className="space-y-3">
      <Badge tone={info.tone}>{info.badge}</Badge>
      {info.hint && <p className="text-sm text-muted">{info.hint}</p>}
      <div className="flex flex-wrap gap-2">
        {(state === 'off' || state === 'denied') && (
          <Button
            loading={busy === 'enable'}
            onClick={() =>
              void run('enable', async () => {
                await enablePush();
                toast('Notifikasi diaktifkan', { tone: 'success' });
              })
            }
          >
            <BellRing /> Aktifkan notifikasi
          </Button>
        )}
        {state === 'on' && (
          <>
            <Button
              variant="secondary"
              loading={busy === 'test'}
              onClick={() =>
                void run('test', async () => {
                  const r = await sendTestPush();
                  toast(
                    r.sent > 0
                      ? `Notifikasi uji dikirim ke ${r.sent} perangkat`
                      : 'Tidak ada perangkat yang menerima. Coba nonaktifkan lalu aktifkan lagi.',
                    { tone: r.sent > 0 ? 'success' : 'danger' },
                  );
                })
              }
            >
              <Send /> Kirim notifikasi uji
            </Button>
            <Button
              variant="ghost"
              className="text-danger"
              loading={busy === 'disable'}
              onClick={() => void run('disable', disablePush)}
            >
              <BellOff /> Nonaktifkan
            </Button>
          </>
        )}
      </div>
      {state === 'on' && <HideContentOption />}
    </div>
  );
}

/** Sembunyikan judul tugas di notifikasi (berlaku untuk perangkat ini saja). */
function HideContentOption() {
  const [hide, setHide] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void readNotificationPrefs().then((p) => alive && setHide(p.hideContent));
    return () => {
      alive = false;
    };
  }, []);

  const change = async (next: boolean) => {
    setHide(next);
    try {
      await writeNotificationPrefs({ hideContent: next });
    } catch (e) {
      setHide(!next);
      toast(e instanceof Error ? e.message : String(e), { tone: 'danger' });
    }
  };

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl p-3 glass">
      <Checkbox
        checked={hide ?? false}
        disabled={hide === null}
        onChange={(v) => void change(v)}
        className="mt-0.5"
      />
      <span className="text-sm">
        <span className="font-semibold">Sembunyikan isi notifikasi</span>
        <span className="block text-muted">
          Notifikasi hanya bertuliskan “Ada pengingat tugas”, tanpa judul tugas — berguna karena
          notifikasi tampil di layar kunci walau PIN aplikasi aktif. Hanya untuk perangkat ini.
        </span>
      </span>
    </label>
  );
}
