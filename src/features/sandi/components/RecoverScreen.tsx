import { ArrowLeft, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FieldError } from '@/components/ui/FieldError';
import { Input, Label } from '@/components/ui/Input';
import { focusField } from '@/lib/focus';
import type { RewrittenVault } from '../crypto';
import { masterPasswordProblem, userInputsFromEmail } from '../master-password';
import { useMasterStrength } from '../useMasterStrength';
import { PasswordField } from './PasswordField';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { StrengthMeter } from './StrengthMeter';

export type RecoverResult = { ok: true; vault: RewrittenVault } | { ok: false; message: string };

/**
 * Lupa master password: kunci pemulihan + master password baru. `onRecover` HANYA menurunkan kunci
 * baru di memori; perubahan baru disimpan (`onFinished`) setelah pengguna mengonfirmasi sudah
 * menyimpan kunci pemulihan yang baru. Jika tab ditutup sebelum itu, kunci lama tetap berlaku.
 */
export function RecoverScreen({
  email,
  onRecover,
  onCancel,
  onFinished,
}: {
  email: string | null | undefined;
  onRecover: (recoveryKey: string, newPassword: string) => Promise<RecoverResult>;
  onCancel: () => void;
  onFinished: (vault: RewrittenVault) => Promise<void>;
}) {
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ key?: string; pw?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const [vault, setVault] = useState<RewrittenVault | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const inputs = userInputsFromEmail(email);
  const strength = useMasterStrength(password, inputs);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!key.trim()) next.key = 'Masukkan kunci pemulihan.';
    const problem = await masterPasswordProblem(password, inputs);
    if (problem) next.pw = problem;
    else if (password !== confirm) next.confirm = 'Konfirmasi tidak sama dengan master password.';
    setErrors(next);
    if (next.key) return focusField('sandi-recovery');
    if (next.pw) return focusField('sandi-new');
    if (next.confirm) return focusField('sandi-confirm');

    setBusy(true);
    const result = await onRecover(key, password);
    setBusy(false);
    if (result.ok) setVault(result.vault);
    else {
      setErrors({ key: result.message });
      focusField('sandi-recovery');
    }
  };

  const finish = async (v: RewrittenVault) => {
    setSaving(true);
    setFailure(null);
    try {
      await onFinished(v);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Gagal menyimpan perubahan.');
      setSaving(false);
    }
  };

  if (vault) {
    return (
      <Card className="mx-auto w-full max-w-xl animate-fade-up space-y-4 p-5 sm:p-7">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Master password diganti</h2>
          <p className="mt-1.5 text-sm text-muted">
            Kunci pemulihan yang lama akan <strong>tidak berlaku</strong> setelah kamu menyimpan
            perubahan. Simpan kunci yang baru ini dulu.
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
          loading={saving}
          onClick={() => void finish(vault)}
        >
          Simpan & buka brankas
        </Button>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-xl animate-fade-up p-5 sm:p-7">
      <div className="mb-5">
        <span className="shine mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-sandi text-white shadow-lg">
          <KeyRound className="size-7" aria-hidden="true" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight">Pulihkan dengan kunci pemulihan</h2>
        <p className="mt-1.5 text-sm text-muted">
          Masukkan kunci pemulihan yang kamu simpan saat membuat brankas, lalu buat master password
          baru. Sandi tersimpanmu tetap utuh.
        </p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="sandi-recovery">Kunci pemulihan</Label>
          <Input
            id="sandi-recovery"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (errors.key) setErrors({ ...errors, key: undefined });
            }}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={errors.key ? true : undefined}
            aria-describedby={errors.key ? 'sandi-recovery-err' : undefined}
            className="font-mono uppercase"
            autoFocus
          />
          <FieldError id="sandi-recovery-err">{errors.key}</FieldError>
        </div>

        <PasswordField
          id="sandi-new"
          label="Master password baru"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.pw) setErrors({ ...errors, pw: undefined });
          }}
          error={errors.pw}
        />
        {strength && <StrengthMeter strength={strength} issues={strength.issues} />}

        <PasswordField
          id="sandi-confirm"
          label="Ulangi master password baru"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (errors.confirm) setErrors({ ...errors, confirm: undefined });
          }}
          error={errors.confirm}
        />

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            aria-label="Kembali ke layar kunci"
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <Button type="submit" className="flex-1" loading={busy}>
            {busy ? 'Memulihkan…' : 'Pulihkan & ganti master password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
