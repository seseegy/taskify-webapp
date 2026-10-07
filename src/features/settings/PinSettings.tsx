import { KeyRound, LockKeyhole, ShieldOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { confirmDialog } from '@/components/ui/confirm-store';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { useLockStore } from '@/features/lock/lock-store';
import { AUTO_LOCK_OPTIONS, createLockConfig, isValidPin } from '@/features/lock/pin';
import { onRadioGroupKeyDown, radioTabIndex } from '@/lib/radio-group';

const AUTO_LOCK_LABEL: Record<number, string> = {
  0: 'Segera',
  1: '1 menit',
  5: '5 menit',
  15: '15 menit',
  60: '1 jam',
};

export function PinSettings() {
  const config = useLockStore((s) => s.config);
  const setConfig = useLockStore((s) => s.setConfig);
  const lock = useLockStore((s) => s.lock);

  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEditing(false);
    setPin('');
    setConfirm('');
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidPin(pin)) return setError('PIN harus 4–8 digit angka.');
    if (pin !== confirm) return setError('Konfirmasi PIN tidak sama.');
    setSaving(true);
    setConfig(await createLockConfig(pin, config?.autoLockMinutes ?? 5));
    setSaving(false);
    reset();
  };

  const setAutoLock = (minutes: number) => {
    if (config) setConfig({ ...config, autoLockMinutes: minutes });
  };

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pin">PIN baru</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="4–8 digit"
            />
          </div>
          <div>
            <Label htmlFor="pin-confirm">Ulangi PIN</Label>
            <Input
              id="pin-confirm"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>
            Simpan PIN
          </Button>
          <Button variant="ghost" onClick={reset}>
            Batal
          </Button>
        </div>
      </form>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Kunci aplikasi dengan PIN saat dibuka atau setelah ditinggalkan.
        </p>
        <Button onClick={() => setEditing(true)}>
          <KeyRound /> Aktifkan PIN
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p id="autolock-label" className="mb-1.5 text-sm font-semibold">
          Kunci otomatis setelah ditinggalkan
        </p>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-labelledby="autolock-label"
          onKeyDown={onRadioGroupKeyDown}
        >
          {AUTO_LOCK_OPTIONS.map((m, i) => (
            <Button
              key={m}
              size="sm"
              role="radio"
              aria-checked={config.autoLockMinutes === m}
              tabIndex={radioTabIndex(
                config.autoLockMinutes === m,
                AUTO_LOCK_OPTIONS.some((o) => o === config.autoLockMinutes),
                i,
              )}
              variant={config.autoLockMinutes === m ? 'primary' : 'secondary'}
              onClick={() => setAutoLock(m)}
            >
              {AUTO_LOCK_LABEL[m]}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={lock}>
          <LockKeyhole /> Kunci sekarang
        </Button>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <KeyRound /> Ganti PIN
        </Button>
        <Button
          variant="ghost"
          className="text-danger"
          onClick={async () => {
            if (
              await confirmDialog('Matikan kunci PIN di perangkat ini?', {
                confirmLabel: 'Matikan',
              })
            )
              setConfig(null);
          }}
        >
          <ShieldOff /> Matikan
        </Button>
      </div>
    </div>
  );
}
