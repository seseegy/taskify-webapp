import type { Factor } from '@supabase/supabase-js';
import { Plus, Smartphone, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { askConfirm } from '@/components/ui/confirm-store';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/toast-store';
import { useUser } from '@/features/auth/auth-context';
import { translateMfaError } from '@/features/auth/mfa';
import { clearTrust, readTrust, trustValid, TRUST_DAYS } from '@/features/auth/mfa-trust';
import { TotpEnroll } from '@/features/auth/MfaScreen';
import { APP_TIMEZONE } from '@/lib/date';
import { supabase } from '@/lib/supabase';

const verifiedTotp = (factors: Factor[] | undefined) =>
  (factors ?? []).filter((f) => f.status === 'verified' && f.factor_type === 'totp');

/**
 * Daftar authenticator akun. MFA WAJIB (lihat features/auth/mfa.ts), jadi authenticator terakhir
 * tidak bisa dihapus dari sini. Authenticator cadangan disarankan: tanpa itu, HP hilang = harus
 * menghapus faktor lewat SQL (docs/SETUP.md).
 */
export function MfaSettings() {
  const user = useUser();
  // Awalnya dari sesi tersimpan (tampil saat offline), lalu disegarkan dari server
  const [factors, setFactors] = useState(() => verifiedTotp(user.factors));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    if (data) setFactors(verifiedTotp(data.all));
  }, []);

  useEffect(() => {
    let alive = true;
    void supabase.auth.mfa
      .listFactors()
      .then(({ data }) => alive && data && setFactors(verifiedTotp(data.all)))
      .catch(() => undefined); // offline: tetap pakai daftar dari sesi
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (f: Factor) => {
    const ok = await askConfirm({
      title: `Hapus authenticator “${f.friendly_name || 'Authenticator'}”?`,
      description: 'Kode dari aplikasi itu tidak bisa dipakai lagi untuk masuk ke Taskify.',
      confirmLabel: 'Hapus',
    });
    if (!ok) return;
    setRemoving(f.id);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) throw error;
      await refresh();
      toast('Authenticator dihapus', { tone: 'success' });
    } catch (e) {
      toast(translateMfaError(e), { tone: 'danger' });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-3">
      <Badge tone={factors.length > 1 ? 'success' : 'warning'}>
        {factors.length > 1 ? `${factors.length} authenticator` : 'Belum ada cadangan'}
      </Badge>
      <ul className="space-y-2">
        {factors.map((f) => (
          <li key={f.id} className="flex items-center gap-3 rounded-xl p-3 glass">
            <Smartphone className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{f.friendly_name || 'Authenticator'}</p>
              <p className="text-xs text-muted">
                Ditambahkan{' '}
                {new Date(f.created_at).toLocaleDateString('id-ID', {
                  timeZone: APP_TIMEZONE,
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
            {factors.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Hapus authenticator ${f.friendly_name || ''}`}
                loading={removing === f.id}
                onClick={() => void remove(f)}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={() => setAdding(true)}>
        <Plus /> Tambah authenticator cadangan
      </Button>
      <p className="text-xs text-muted">
        Verifikasi dua langkah wajib untuk akun ini. Daftarkan authenticator kedua (mis. di
        perangkat lain atau password manager) supaya tetap bisa masuk bila HP hilang. Perangkat yang
        diingat ({TRUST_DAYS} hari) tetap diminta kode setelah Keluar lalu masuk lagi.
      </p>
      <DeviceTrustRow userId={user.id} />
      <Sheet open={adding} onClose={() => setAdding(false)} title="Tambah authenticator">
        {adding && (
          <TotpEnroll
            defaultName={`Cadangan ${factors.length}`}
            onDone={() => {
              setAdding(false);
              void refresh();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

/** Status "Ingat perangkat ini" untuk perangkat ini + tombol untuk melupakannya. */
function DeviceTrustRow({ userId }: { userId: string }) {
  // Dibaca sekali saat tampil: null = tidak diingat (atau sudah lewat masanya)
  const [trust, setTrust] = useState(() => {
    const t = readTrust();
    return trustValid(t, userId, Date.now()) ? t : null;
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm glass">
      <span className="min-w-0">
        <span className="block font-semibold">Perangkat ini</span>
        <span className="block text-xs text-muted">
          {trust
            ? `Diingat sampai ${new Date(trust.until).toLocaleDateString('id-ID', {
                timeZone: APP_TIMEZONE,
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })} — aplikasi dibuka tanpa kode.`
            : 'Tidak diingat — kode diminta setiap aplikasi dibuka. Centang “Ingat perangkat ini” di layar kode untuk mengubahnya.'}
        </span>
      </span>
      {trust && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            clearTrust();
            setTrust(null);
            toast(`Perangkat ini dilupakan. Kode diminta lagi saat aplikasi dibuka berikutnya.`, {
              tone: 'success',
            });
          }}
        >
          Lupakan perangkat ini
        </Button>
      )}
    </div>
  );
}
