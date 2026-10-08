import {
  ArrowLeft,
  CloudOff,
  KeyRound,
  Lock,
  ShieldCheck,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/toast-store';
import { focusField } from '@/lib/focus';
import { cn } from '@/lib/utils';
import { createVault, type NewVault } from '../crypto';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  estimatePasswordStrength,
  generatePassphrase,
  masterPasswordProblem,
} from '../generator';
import { PasswordField } from './PasswordField';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { StrengthMeter } from './StrengthMeter';

type Step = 'intro' | 'password' | 'recovery';
const STEPS: { id: Step; label: string }[] = [
  { id: 'intro', label: 'Mengenal brankas' },
  { id: 'password', label: 'Master password' },
  { id: 'recovery', label: 'Kunci pemulihan' },
];

/** Penunjuk langkah: teks + nomor (tidak mengandalkan warna), langkah aktif ditandai aria-current. */
function StepIndicator({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <nav aria-label="Langkah pembuatan brankas" className="mb-5">
      <p className="mb-2 text-xs font-semibold text-muted">
        Langkah {index + 1} dari {STEPS.length}: {STEPS[index]!.label}
      </p>
      <ol className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === index ? 'step' : undefined}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i <= index ? 'bg-gradient-sandi' : 'bg-muted/25',
            )}
          >
            <span className="sr-only">{s.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Membuat brankas baru dalam 3 langkah. Brankas BARU disimpan setelah langkah 3 dikonfirmasi
 * (`onComplete`): bila pengguna menutup di tengah jalan, tidak ada brankas setengah jadi.
 */
export function SetupWizard({
  userId,
  email,
  ready,
  onComplete,
}: {
  userId: string;
  email: string | null | undefined;
  /** false = sinkron pertama belum selesai → jangan buat brankas (bisa bentrok dengan perangkat lain) */
  ready: boolean;
  onComplete: (vault: NewVault) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>('intro');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<{ field: 'pw' | 'confirm'; message: string } | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vault, setVault] = useState<NewVault | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Pindahkan fokus ke judul langkah agar pembaca layar/keyboard tidak "tertinggal" di langkah lama
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const strength = estimatePasswordStrength(password);

  const suggest = async () => {
    const { EFF_WORDLIST } = await import('../eff-wordlist');
    setSuggestion(generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 5 }, EFF_WORDLIST));
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    const problem = masterPasswordProblem(password);
    if (problem) {
      setError({ field: 'pw', message: problem });
      return focusField('sandi-new');
    }
    if (password !== confirm) {
      setError({ field: 'confirm', message: 'Konfirmasi tidak sama dengan master password.' });
      return focusField('sandi-confirm');
    }
    setError(null);
    setBusy(true);
    try {
      setVault(await createVault(password, userId));
      setStep('recovery');
    } catch (err) {
      setError({
        field: 'pw',
        message: err instanceof Error ? err.message : 'Gagal membuat brankas.',
      });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!vault) return;
    setBusy(true);
    setFailure(null);
    try {
      await onComplete(vault);
      toast('Brankas sandi siap dipakai', { tone: 'success' });
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Gagal menyimpan brankas.');
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-xl animate-fade-up p-5 sm:p-7">
      <StepIndicator step={step} />

      {step === 'intro' && (
        <div className="space-y-5">
          <div>
            <span className="shine mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-sandi text-white shadow-lg">
              <ShieldCheck className="size-7" aria-hidden="true" />
            </span>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-extrabold tracking-tight outline-none"
            >
              Brankas sandi yang hanya bisa kamu buka
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Semua sandi dienkripsi <strong>di perangkatmu</strong> sebelum disimpan dan
              disinkronkan. Server, backup, dan ekspor data hanya melihat data acak.
            </p>
          </div>

          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <Lock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                Dibuka dengan <strong>master password</strong> yang hanya kamu ketahui. Tidak pernah
                dikirim ke server.
              </span>
            </li>
            <li className="flex gap-3">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                Kamu mendapat <strong>kunci pemulihan</strong> sekali saja, untuk berjaga-jaga bila
                lupa master password.
              </span>
            </li>
            <li className="flex gap-3 rounded-xl bg-warning/12 p-3 text-warning">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                Lupa <strong>keduanya</strong> berarti data{' '}
                <strong>tidak bisa dipulihkan siapa pun</strong>, termasuk pembuat aplikasi ini.
              </span>
            </li>
          </ul>

          {!ready && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-xl bg-surface p-3 text-sm text-muted"
            >
              <CloudOff className="size-4 shrink-0" aria-hidden="true" />
              Menunggu sinkronisasi pertama selesai. Butuh internet agar tidak bentrok dengan
              brankas di perangkat lain.
            </p>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={!ready}
            onClick={() => setStep('password')}
          >
            Mulai
          </Button>
        </div>
      )}

      {step === 'password' && (
        <form onSubmit={(e) => void submitPassword(e)} className="space-y-4" noValidate>
          <div>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-extrabold tracking-tight outline-none"
            >
              Buat master password
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Pakai <strong>frasa beberapa kata</strong> atau sandi acak yang panjang. Harus
              <strong> berbeda</strong> dari password akun Taskify.
            </p>
          </div>

          <PasswordField
            id="sandi-new"
            label="Master password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error?.field === 'pw') setError(null);
            }}
            error={error?.field === 'pw' ? error.message : null}
            autoFocus
          />
          {password && <StrengthMeter strength={strength} issues={strength.issues} />}

          <div className="rounded-2xl p-3.5 glass">
            {suggestion ? (
              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-muted">Frasa yang disarankan</p>
                <p className="font-mono text-base font-bold break-words select-all">{suggestion}</p>
                <p className="text-xs text-muted">
                  Tulis di kertas dulu. Setelah dipakai, frasa ini tidak bisa ditampilkan lagi.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setPassword(suggestion);
                      setConfirm(suggestion);
                      setError(null);
                    }}
                  >
                    Pakai frasa ini
                  </Button>
                  <Button variant="ghost" onClick={() => void suggest()}>
                    Ganti
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={() => void suggest()}>
                <Wand2 aria-hidden="true" /> Buatkan frasa 5 kata
              </Button>
            )}
          </div>

          <PasswordField
            id="sandi-confirm"
            label="Ulangi master password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (error?.field === 'confirm') setError(null);
            }}
            error={error?.field === 'confirm' ? error.message : null}
          />

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep('intro')}
              disabled={busy}
              aria-label="Kembali ke langkah sebelumnya"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <Button type="submit" className="flex-1" loading={busy}>
              {busy ? 'Mengamankan brankas…' : 'Lanjut'}
            </Button>
          </div>
        </form>
      )}

      {step === 'recovery' && vault && (
        <div className="space-y-4">
          <div>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-extrabold tracking-tight outline-none"
            >
              Simpan kunci pemulihan
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Brankas sudah dibuat. Satu langkah lagi: simpan kunci ini sebelum melanjutkan.
            </p>
          </div>

          <RecoveryKeyPanel
            recoveryKey={vault.recoveryKey}
            email={email}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
          />

          {failure && (
            <p role="alert" className="text-sm font-medium text-danger">
              {failure}
            </p>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={!confirmed}
            loading={busy}
            onClick={() => void finish()}
          >
            Selesai & buka brankas
          </Button>
        </div>
      )}
    </Card>
  );
}
