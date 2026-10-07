import { Delete, LockKeyhole } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Logo } from '@/components/layout/Logo';
import { cn } from '@/lib/utils';
import { ForgotPinScreen } from './ForgotPinScreen';
import { LOCK_MAX_ATTEMPTS, useLockStore } from './lock-store';
import { verifyPin } from './pin';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/**
 * Layar kunci PIN.
 * - Dialog modal bernama ("Taskify terkunci"); fokus langsung masuk ke kolom PIN.
 * - Kolom PIN asli (tersembunyi secara visual): mendukung keyboard fisik, tempel, dan pembaca
 *   layar. `inputMode="none"` agar keyboard layar HP tidak menutupi keypad di bawahnya.
 * - Keypad tetap ada untuk sentuhan; digit/Backspace dari keyboard fisik juga diterima saat
 *   fokus ada di salah satu tombol keypad.
 * - Error diumumkan sekali lewat `role="alert"` (hitung mundur hanya visual, tidak dibacakan tiap detik).
 */
export function LockScreen() {
  const config = useLockStore((s) => s.config);
  const unlock = useLockStore((s) => s.unlock);
  const registerFailure = useLockStore((s) => s.registerFailure);
  const cooldownUntil = useLockStore((s) => s.cooldownUntil);
  const failedAttempts = useLockStore((s) => s.failedAttempts);

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [forgot, setForgot] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const cooling = cooldownUntil !== null && cooldownUntil > now;
  const pinLength = config?.length ?? 4;
  const busy = cooling || checking;

  // Fokus ke kolom PIN saat tampil, dan saat kembali dari layar "Lupa PIN"
  useEffect(() => {
    if (!forgot) inputRef.current?.focus();
  }, [forgot]);

  useEffect(() => {
    if (!cooling) return;
    // Segarkan segera (lewat timer, bukan saat render) lalu tiap 500 ms
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [cooling]);

  // Setelah hitung mundur selesai, kembalikan fokus ke kolom PIN
  useEffect(() => {
    if (!cooling) inputRef.current?.focus({ preventScroll: true });
  }, [cooling]);

  const submit = async (value: string) => {
    if (!config || busy) return;
    setChecking(true);
    const ok = await verifyPin(value, config);
    setChecking(false);
    if (ok) {
      unlock();
    } else {
      registerFailure();
      setError('PIN salah');
      setPin('');
    }
  };

  const setDigits = (digits: string) => {
    if (busy) return;
    setError(null);
    const next = digits.replace(/\D/g, '').slice(0, pinLength);
    setPin(next);
    if (next.length === pinLength) void submit(next);
  };

  const press = (key: (typeof KEYS)[number]) => {
    if (!key) return;
    setDigits(key === 'del' ? pin.slice(0, -1) : pin + key);
  };

  // Keyboard fisik saat fokus ada di tombol keypad (di kolom PIN ditangani onChange-nya)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target === inputRef.current || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      press(e.key as (typeof KEYS)[number]);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      press('del');
    }
  };

  // Cadangan: jika tidak ada elemen yang berfokus (mis. baru tampil / klik di latar), digit dari
  // keyboard fisik tetap diterima seperti sebelumnya, lalu fokus dikembalikan ke kolom PIN.
  useEffect(() => {
    const onWindowKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key as (typeof KEYS)[number]);
        inputRef.current?.focus({ preventScroll: true });
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        press('del');
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  });

  if (forgot) return <ForgotPinScreen onBack={() => setForgot(false)} />;

  const secondsLeft = cooling ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  const attemptsLeft = LOCK_MAX_ATTEMPTS - failedAttempts;
  const visibleMessage = cooling
    ? `Terlalu banyak percobaan. Coba lagi dalam ${secondsLeft} dtk`
    : error
      ? `${error} · sisa ${attemptsLeft} percobaan`
      : '';
  // Untuk pembaca layar: teks STATIS saat cooldown → diumumkan sekali, bukan tiap detik
  const announcement = cooling
    ? 'Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi.'
    : error
      ? `${error}. Sisa ${attemptsLeft} percobaan.`
      : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={checking}
      onKeyDown={onKeyDown}
      // Klik di latar (bukan tombol) → kembalikan fokus ke kolom PIN
      onPointerUp={(e) => {
        if (!(e.target as HTMLElement).closest('button')) inputRef.current?.focus();
      }}
      className="app-backdrop fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 p-6"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size="lg" />
        <h1 id={titleId} className="flex items-center gap-2 text-sm font-normal text-muted">
          <LockKeyhole className="size-4" />
          Taskify terkunci
        </h1>
      </div>

      {/* Titik indikator (visual). Kolom PIN asli menutupi area ini dan menerima fokus. */}
      <label className="relative flex h-10 items-center gap-3 rounded-full px-4 focus-within:ring-2 focus-within:ring-primary">
        <span className="sr-only">PIN, {pinLength} digit</span>
        <input
          ref={inputRef}
          type="password"
          inputMode="none"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          maxLength={pinLength}
          value={pin}
          readOnly={busy}
          onChange={(e) => setDigits(e.target.value)}
          className="absolute inset-0 size-full cursor-default opacity-0"
        />
        <span
          aria-hidden="true"
          className={cn('flex items-center gap-3', checking && 'animate-pulse')}
        >
          {Array.from({ length: pinLength }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'size-3.5 rounded-full border-2 border-primary/60 transition-all',
                i < pin.length && 'scale-110 border-transparent bg-gradient-brand',
              )}
            />
          ))}
        </span>
      </label>

      {/* Hitungan digit untuk pengguna keypad + pembaca layar */}
      <p role="status" className="sr-only">
        {checking ? 'Memeriksa PIN…' : `${pin.length} dari ${pinLength} digit dimasukkan`}
      </p>

      <p aria-hidden="true" className="h-5 text-sm font-medium text-danger">
        {visibleMessage}
      </p>
      <p role="alert" className="sr-only">
        {announcement}
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
              disabled={busy}
              aria-label={key === 'del' ? 'Hapus digit terakhir' : key}
              className="flex size-18 items-center justify-center rounded-full text-2xl font-semibold glass transition active:scale-95 disabled:opacity-40"
            >
              {key === 'del' ? <Delete className="size-6" aria-hidden="true" /> : key}
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        onClick={() => setForgot(true)}
        className="min-h-11 rounded-xl px-4 text-sm font-semibold text-primary hover:bg-surface"
      >
        Lupa PIN?
      </button>
    </div>
  );
}
