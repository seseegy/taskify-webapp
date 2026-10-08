import { Download, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { saveBlob } from '@/lib/files';
import { recoveryFileText } from '../recovery-file';
import { CopyButton } from './CopyButton';

/**
 * Menampilkan kunci pemulihan SEKALI. Pengguna harus menyatakan sudah menyimpannya
 * (`confirmed`) sebelum lanjut — kunci ini tidak disimpan di mana pun dan tidak bisa ditampilkan lagi.
 */
export function RecoveryKeyPanel({
  recoveryKey,
  email,
  confirmed,
  onConfirmedChange,
}: {
  recoveryKey: string;
  email?: string | null;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
}) {
  const groups = recoveryKey.split('-');
  return (
    <div className="space-y-4">
      <div role="note" className="flex gap-3 rounded-2xl bg-warning/12 p-3.5 text-sm text-warning">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p>
          <strong>Ini satu-satunya cara</strong> membuka brankas bila Anda lupa master password.
          Kunci ini <strong>tidak akan ditampilkan lagi</strong>.
        </p>
      </div>

      <div className="rounded-2xl p-4 glass-strong">
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          Kunci pemulihan
        </p>
        <p
          className="flex flex-wrap gap-x-3 gap-y-1.5 font-mono text-lg font-bold tracking-wider select-all sm:text-xl"
          aria-label={`Kunci pemulihan: ${groups.join(', ')}`}
        >
          {groups.map((g, i) => (
            <span key={i} aria-hidden="true">
              {g}
            </span>
          ))}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyButton
            value={recoveryKey}
            label="Salin kunci pemulihan"
            what="Kunci pemulihan"
            secret
            showLabel
            className="glass"
          />
          <Button
            variant="secondary"

            onClick={() =>
              saveBlob(
                new Blob([recoveryFileText(recoveryKey, email)], { type: 'text/plain' }),
                'taskify-kunci-pemulihan.txt',
              )
            }
          >
            <Download aria-hidden="true" /> Unduh .txt
          </Button>
        </div>
      </div>

      <p className="flex gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Simpan di tempat terpisah dari perangkat ini: dicetak, atau di pengelola sandi lain.
      </p>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-surface">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
        />
        <span className="text-sm font-semibold">
          Saya sudah menyimpan kunci pemulihan ini di tempat yang aman
        </span>
      </label>
    </div>
  );
}
