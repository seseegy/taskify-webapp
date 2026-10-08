import { LockKeyhole, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useLockStore } from '@/features/lock/lock-store';
import { focusField } from '@/lib/focus';
import { TRUST_DAYS } from '../device-trust';
import { PasswordField } from './PasswordField';
import { Switch } from './Switch';

/**
 * Layar buka brankas. Memeriksa master password butuh ±0,3–1,5 detik (KDF sengaja lambat), jadi
 * tombol menampilkan status "Memeriksa…" agar tidak terasa macet.
 */
export function UnlockScreen({
  email,
  onUnlock,
  onForgot,
}: {
  email: string | null | undefined;
  /** true = berhasil. Melempar bila data brankas tidak didukung/rusak. */
  onUnlock: (password: string, remember: boolean) => Promise<boolean>;
  onForgot: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  // Bila brankas tidak lagi meminta master password di perangkat ini, penjaga sebenarnya
  // adalah PIN aplikasi. Peringatkan kalau PIN belum aktif.
  const pinActive = useLockStore((st) => st.config !== null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setError('Masukkan master password.');
      return focusField('sandi-master');
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onUnlock(password, remember);
      if (!ok) {
        setError('Master password salah.');
        setPassword('');
        focusField('sandi-master');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuka brankas.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-md animate-fade-up p-6 sm:p-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="shine mb-4 flex size-16 items-center justify-center rounded-3xl bg-gradient-sandi text-white shadow-xl">
          <LockKeyhole className="size-8" aria-hidden="true" />
        </span>
        <h2 className="text-xl font-extrabold tracking-tight">Brankas terkunci</h2>
        <p className="mt-1 text-sm text-muted">
          Masukkan master password untuk membuka sandi{email ? ` ${email}` : ''}.
        </p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <PasswordField
          id="sandi-master"
          label="Master password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          error={error}
          autoFocus
        />
        <Switch
          checked={remember}
          onChange={setRemember}
          label={`Ingat perangkat ini ${TRUST_DAYS} hari`}
          hint="Brankas terbuka tanpa master password di perangkat ini. Kunci disimpan browser dalam bentuk yang tidak bisa dibaca, dan batal sendiri bila master password diganti."
        />

        {remember && !pinActive && (
          <p role="alert" className="flex items-start gap-2 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            PIN aplikasi belum aktif. Tanpa PIN, siapa pun yang memegang perangkat ini bisa membuka
            brankas. Aktifkan di Pengaturan → Kunci aplikasi.
          </p>
        )}

        <Button type="submit" className="w-full" size="lg" loading={busy}>
          {busy ? 'Memeriksa…' : 'Buka brankas'}
        </Button>
      </form>

      <button
        type="button"
        onClick={onForgot}
        className="mt-4 min-h-11 w-full rounded-xl px-3 text-sm font-semibold text-primary transition hover:bg-surface"
      >
        Lupa master password?
      </button>
    </Card>
  );
}
