import { Delete, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/layout/Logo';
import { cn } from '@/lib/utils';
import { useLockStore } from './lock-store';
import { verifyPin } from './pin';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

export function LockScreen() {
  const config = useLockStore((s) => s.config);
  const unlock = useLockStore((s) => s.unlock);
  const registerFailure = useLockStore((s) => s.registerFailure);
  const cooldownUntil = useLockStore((s) => s.cooldownUntil);

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const cooling = cooldownUntil !== null && cooldownUntil > now;
  const pinLength = config?.length ?? 4;

  useEffect(() => {
    if (!cooling) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [cooling]);

  const submit = async (value: string) => {
    if (!config || checking || cooling) return;
    setChecking(true);
    const ok = await verifyPin(value, config);
    setChecking(false);
    if (ok) {
      unlock();
    } else {
      registerFailure();
      setError('PIN salah');
      setPin('');
      setNow(Date.now());
    }
  };

  const press = (key: (typeof KEYS)[number]) => {
    if (cooling || checking) return;
    setError(null);
    if (key === 'del') return setPin((p) => p.slice(0, -1));
    if (!key) return;
    const next = (pin + key).slice(0, pinLength);
    setPin(next);
    if (next.length === pinLength) void submit(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key as (typeof KEYS)[number]);
      else if (e.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const secondsLeft = cooling ? Math.ceil((cooldownUntil - now) / 1000) : 0;

  return (
    <div className="app-backdrop fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size="lg" />
        <div className="flex items-center gap-2 text-sm text-muted">
          <LockKeyhole className="size-4" />
          Taskify terkunci
        </div>
      </div>

      <div className="flex h-6 items-center gap-3" aria-label={`${pin.length} digit dimasukkan`}>
        {Array.from({ length: pinLength }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'size-3.5 rounded-full border-2 border-primary/60 transition-all',
              i < pin.length && 'scale-110 border-transparent bg-gradient-brand',
            )}
          />
        ))}
      </div>

      <p className="h-5 text-sm font-medium text-danger" role="alert">
        {cooling ? `Terlalu banyak percobaan. Coba lagi dalam ${secondsLeft} dtk` : error}
      </p>

      <div className="grid grid-cols-3 gap-4">
        {KEYS.map((key, i) =>
          key === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => press(key)}
              disabled={cooling}
              aria-label={key === 'del' ? 'Hapus' : key}
              className="flex size-18 items-center justify-center rounded-full text-2xl font-semibold glass transition active:scale-95 disabled:opacity-40"
            >
              {key === 'del' ? <Delete className="size-6" /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
