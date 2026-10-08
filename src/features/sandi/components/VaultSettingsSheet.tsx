import { ChevronRight, KeyRound, Lock, RefreshCcw, Timer } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/toast-store';
import { focusField } from '@/lib/focus';
import { changePassword, rotateRecoveryKey, type KeyRecord, type RewrittenVault } from '../crypto';
import { masterPasswordProblem, userInputsFromEmail } from '../master-password';
import { useMasterStrength } from '../useMasterStrength';
import { AUTO_LOCK_OPTIONS, useSandiStore, type AutoLockMinutes } from '../sandi-store';
import { PasswordField } from './PasswordField';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { StrengthMeter } from './StrengthMeter';

type ReplaceVault = (
  id: string,
  vault: RewrittenVault,
) => Promise<{ reencrypted: number; skipped: number }>;

type View = 'main' | 'password' | 'rotate' | 'newkey';

const AUTO_LOCK_LABEL: Record<AutoLockMinutes, string> = {
  0: 'Segera',
  1: '1 mnt',
  5: '5 mnt',
  15: '15 mnt',
};

/**
 * Pengaturan brankas. Perubahan kunci (ganti master password, kunci pemulihan baru) baru DISIMPAN
 * setelah pengguna menyatakan sudah menyimpan kunci pemulihan yang baru; bila panel ditutup di
 * tengah jalan, kunci lama tetap berlaku (tidak ada kunci yang "hilang").
 */
export function VaultSettingsSheet({
  open,
  onClose,
  email,
  userId,
  keyId,
  record,
  onReplaceVault,
}: {
  open: boolean;
  onClose: () => void;
  email: string | null | undefined;
  userId: string;
  keyId: string;
  record: KeyRecord;
  onReplaceVault: ReplaceVault;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Pengaturan brankas">
      {open && (
        <Body
          email={email}
          userId={userId}
          keyId={keyId}
          record={record}
          onReplaceVault={onReplaceVault}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function Body({
  email,
  userId,
  keyId,
  record,
  onReplaceVault,
  onClose,
}: {
  email: string | null | undefined;
  userId: string;
  keyId: string;
  record: KeyRecord;
  onReplaceVault: ReplaceVault;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>('main');
  const [pending, setPending] = useState<{ vault: RewrittenVault; what: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const autoLock = useSandiStore((s) => s.autoLockMinutes);
  const setAutoLock = useSandiStore((s) => s.setAutoLock);
  const lock = useSandiStore((s) => s.lock);
  const unlock = useSandiStore((s) => s.unlock);
  const setRekeying = useSandiStore((s) => s.setRekeying);

  const persist = async () => {
    if (!pending) return;
    setSaving(true);
    setFailure(null);
    // Record kunci berubah SENGAJA dari sini; jangan anggap DEK di memori usang selama proses ini.
    setRekeying(true);
    try {
      const { skipped } = await onReplaceVault(keyId, pending.vault);
      unlock(pending.vault.dek, pending.vault.record.wrapped_key);
      toast(`${pending.what} berhasil`, { tone: 'success' });
      if (skipped > 0) toast(`${skipped} sandi lama tidak bisa dibuka dan dibiarkan apa adanya.`);
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Gagal menyimpan.');
      setSaving(false);
    } finally {
      setRekeying(false);
    }
  };

  if (view === 'newkey' && pending)
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Kunci pemulihan yang lama akan <strong>tidak berlaku</strong> setelah kamu menyimpan
          perubahan. Simpan yang baru ini lalu konfirmasi.
        </p>
        <RecoveryKeyPanel
          recoveryKey={pending.vault.recoveryKey}
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
          disabled={!confirmed}
          loading={saving}
          onClick={() => void persist()}
        >
          Simpan perubahan
        </Button>
      </div>
    );

  if (view === 'password')
    return (
      <ChangePasswordForm
        record={record}
        userId={userId}
        email={email}
        onBack={() => setView('main')}
        onReady={(vault) => {
          setPending({ vault, what: 'Master password diganti' });
          setConfirmed(false);
          setView('newkey');
        }}
      />
    );

  if (view === 'rotate')
    return (
      <RotateForm
        record={record}
        userId={userId}
        onBack={() => setView('main')}
        onReady={(vault) => {
          setPending({ vault, what: 'Kunci pemulihan baru disimpan' });
          setConfirmed(false);
          setView('newkey');
        }}
      />
    );

  return (
    <div className="space-y-6">
      <section aria-labelledby="set-autolock">
        <h3 id="set-autolock" className="mb-1 flex items-center gap-2 text-sm font-bold">
          <Timer className="size-4" aria-hidden="true" /> Kunci otomatis
        </h3>
        <p className="mb-2.5 text-xs text-muted">
          Brankas terkunci bila tidak disentuh, atau bila tab ditinggalkan, selama waktu ini.
          &ldquo;Segera&rdquo; berarti begitu tab ditinggalkan. Berlaku di perangkat ini saja.
        </p>
        <SegmentedControl<`${AutoLockMinutes}`>
          label="Kunci otomatis"
          value={`${autoLock}`}
          onChange={(v) => setAutoLock(Number(v) as AutoLockMinutes)}
          options={AUTO_LOCK_OPTIONS.map((m) => ({
            value: `${m}` as `${AutoLockMinutes}`,
            label: AUTO_LOCK_LABEL[m],
          }))}
        />
      </section>

      <section aria-labelledby="set-keys" className="space-y-2">
        <h3 id="set-keys" className="text-sm font-bold">
          Kunci & pemulihan
        </h3>
        <button
          type="button"
          onClick={() => setView('password')}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left glass transition hover:bg-surface-strong"
        >
          <KeyRound className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Ganti master password</span>
            <span className="block text-xs text-muted">Sandi tersimpan tetap utuh</span>
          </span>
          <ChevronRight className="size-4 text-muted" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setView('rotate')}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left glass transition hover:bg-surface-strong"
        >
          <RefreshCcw className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Buat kunci pemulihan baru</span>
            <span className="block text-xs text-muted">Bila kunci lama hilang atau bocor</span>
          </span>
          <ChevronRight className="size-4 text-muted" aria-hidden="true" />
        </button>
      </section>

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          lock();
          onClose();
        }}
      >
        <Lock aria-hidden="true" /> Kunci sekarang
      </Button>
    </div>
  );
}

function ChangePasswordForm({
  record,
  userId,
  email,
  onBack,
  onReady,
}: {
  record: KeyRecord;
  userId: string;
  email: string | null | undefined;
  onBack: () => void;
  onReady: (vault: RewrittenVault) => void;
}) {
  const [oldPw, setOldPw] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ old?: string; pw?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const inputs = userInputsFromEmail(email);
  const strength = useMasterStrength(pw, inputs);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!oldPw) next.old = 'Masukkan master password saat ini.';
    const problem = await masterPasswordProblem(pw, inputs);
    if (problem) next.pw = problem;
    else if (pw !== confirm) next.confirm = 'Konfirmasi tidak sama.';
    setErrors(next);
    if (next.old) return focusField('set-old');
    if (next.pw) return focusField('set-new');
    if (next.confirm) return focusField('set-confirm');

    setBusy(true);
    try {
      const vault = await changePassword(record, oldPw, pw, userId);
      if (!vault) {
        setErrors({ old: 'Master password saat ini salah.' });
        return focusField('set-old');
      }
      onReady(vault);
    } catch (err) {
      setErrors({ old: err instanceof Error ? err.message : 'Gagal memproses.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <p className="text-sm text-muted">
        Setelah diganti kamu akan mendapat <strong>kunci pemulihan baru</strong>; yang lama dicabut.
        Semua sandi dienkripsi ulang dengan kunci data baru. Perangkat lain akan diminta membuka
        brankas lagi.
      </p>
      <PasswordField
        id="set-old"
        label="Master password saat ini"
        autoComplete="current-password"
        value={oldPw}
        onChange={(e) => setOldPw(e.target.value)}
        error={errors.old}
        autoFocus
      />
      <PasswordField
        id="set-new"
        label="Master password baru"
        autoComplete="new-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        error={errors.pw}
      />
      {strength && <StrengthMeter strength={strength} issues={strength.issues} />}
      <PasswordField
        id="set-confirm"
        label="Ulangi master password baru"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" loading={busy}>
          {busy ? 'Memproses…' : 'Lanjut'}
        </Button>
      </div>
    </form>
  );
}

function RotateForm({
  record,
  userId,
  onBack,
  onReady,
}: {
  record: KeyRecord;
  userId: string;
  onBack: () => void;
  onReady: (vault: RewrittenVault) => void;
}) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw) {
      setError('Masukkan master password.');
      return focusField('set-rotate');
    }
    setBusy(true);
    try {
      const vault = await rotateRecoveryKey(record, pw, userId);
      if (!vault) {
        setError('Master password salah.');
        return focusField('set-rotate');
      }
      onReady(vault);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <p className="text-sm text-muted">
        Kunci pemulihan lama akan <strong>dicabut</strong> dan diganti yang baru. Master password
        tidak berubah. Semua sandi dienkripsi ulang dengan kunci data baru, jadi kunci lama tidak
        bisa membuka data saat ini. Cadangan atau ekspor yang dibuat sebelumnya tetap bisa dibuka
        dengan kunci lamanya.
      </p>
      <PasswordField
        id="set-rotate"
        label="Master password"
        autoComplete="current-password"
        value={pw}
        onChange={(e) => {
          setPw(e.target.value);
          if (error) setError(null);
        }}
        error={error}
        autoFocus
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" loading={busy}>
          {busy ? 'Memproses…' : 'Buat kunci baru'}
        </Button>
      </div>
    </form>
  );
}
