import { KeyRound, LockKeyhole } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast-store';
import { useAuth, useUser } from '@/features/auth/auth-context';
import { focusField } from '@/lib/focus';
import { verifyPasswordForReset } from './forgot-pin';
import { useLockStore } from './lock-store';

/**
 * Layar "Lupa PIN": masukkan password akun → PIN di perangkat ini dimatikan dan aplikasi terbuka.
 * Terpisah dari LockScreen karena layar kunci merebut fokus ke kolom PIN tiap klik latar.
 */
export function ForgotPinScreen({ onBack }: { onBack: () => void }) {
  const user = useUser();
  const { signIn } = useAuth();
  const setConfig = useLockStore((s) => s.setConfig);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const titleId = useId();
  const inputId = useId();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError(null);
    const result = await verifyPasswordForReset({
      email: user.email,
      password,
      online: navigator.onLine,
      signIn,
    });
    setChecking(false);
    if (result.ok) {
      setConfig(null); // PIN dimatikan, hitungan salah direset, aplikasi terbuka
      toast('PIN dimatikan di perangkat ini. Atur PIN baru di Pengaturan.', { tone: 'success' });
    } else {
      setError(result.message);
      setPassword('');
      focusField(inputId);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="app-backdrop fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size="lg" />
        <h1 id={titleId} className="flex items-center gap-2 text-sm font-normal text-muted">
          <LockKeyhole className="size-4" />
          Atur ulang PIN
        </h1>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="w-full max-w-sm space-y-3">
        <p className="text-center text-sm text-muted">
          Masukkan password akun <span className="font-semibold text-fg">{user.email}</span> untuk
          membuka kunci. PIN di perangkat ini akan dimatikan.
        </p>
        <div>
          <Label htmlFor={inputId}>Password</Label>
          <Input
            id={inputId}
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-err` : undefined}
          />
        </div>
        {error && (
          <p id={`${inputId}-err`} role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={checking} className="flex-1">
            <KeyRound /> Buka kunci
          </Button>
          <Button type="button" variant="ghost" onClick={onBack} disabled={checking}>
            Kembali
          </Button>
        </div>
      </form>
    </div>
  );
}
