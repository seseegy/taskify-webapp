import { ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError } from '@/components/ui/FieldError';
import { Input, Label } from '@/components/ui/Input';
import { formatSecret, parseTotpInput, totpProblem, type TotpConfig } from '../totp';
import { TotpCode } from './TotpCode';

/**
 * Isi kunci TOTP sebuah item. Menerima kunci base32 maupun URI `otpauth://` lengkap dari QR.
 * Kunci yang sudah tersimpan TIDAK ditampilkan utuh lagi — hanya kodenya — supaya tidak
 * tergeser ke layar/tangkapan layar tanpa sebab; menggantinya berarti menempel yang baru.
 */
export function TotpField({
  value,
  name,
  onChange,
}: {
  value: TotpConfig | null;
  /** Judul item, untuk label aksesibel pada kode pratinjau. */
  name: string;
  onChange: (config: TotpConfig | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const apply = () => {
    const problem = totpProblem(text);
    if (problem) return setError(problem);
    const parsed = parseTotpInput(text);
    if (!parsed) return setError('Kunci TOTP tidak bisa dibaca.');
    onChange(parsed.config);
    setText('');
    setError(null);
    setAdding(false);
  };

  if (value && !adding)
    return (
      <div className="space-y-2.5 rounded-2xl p-3.5 glass">
        <div className="flex items-center justify-between gap-2">
          <Label className="mb-0 flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Kode TOTP
          </Label>
          <span className="text-xs text-muted">
            {value.digits} digit · {value.period}s · {value.algorithm}
          </span>
        </div>

        <TotpCode config={value} name={name || 'akun ini'} />

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Ganti kunci
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            aria-label="Hapus kunci TOTP dari item ini"
          >
            <Trash2 aria-hidden="true" /> Hapus
          </Button>
        </div>
      </div>
    );

  return (
    <div className="space-y-2">
      <Label htmlFor="item-totp" className="flex items-center gap-1.5">
        <ShieldCheck className="size-4" aria-hidden="true" />
        Kode TOTP {value ? '(ganti kunci)' : '(opsional)'}
      </Label>
      <Input
        id="item-totp"
        value={text}
        maxLength={1000}
        placeholder="Tempel kunci base32 atau otpauth://totp/…"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'item-totp-err' : 'item-totp-help'}
        className="font-mono"
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
      />
      <FieldError id="item-totp-err">{error}</FieldError>

      {text.trim() !== '' && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={apply}>
            Pakai kunci ini
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setText('');
              setError(null);
              setAdding(false);
            }}
          >
            Batal
          </Button>
        </div>
      )}

      <p id="item-totp-help" className="text-xs text-muted">
        Ambil dari layar &ldquo;setel aplikasi authenticator&rdquo; di situsnya: pilih{' '}
        <strong>tidak bisa memindai QR</strong>, lalu tempel kuncinya di sini.
        {text.trim() === '' && value === null && (
          <> Kunci tersimpan terenkripsi bersama sandi item ini.</>
        )}
      </p>

      <p className="flex items-start gap-1.5 text-xs text-warning">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Jangan simpan kode 2FA akun Taskify sendiri di sini — kamu akan terkunci dari aplikasi yang
        menyimpan kodenya.
      </p>

      {text.trim() !== '' && totpProblem(text) === null && <PreviewCode text={text} name={name} />}
    </div>
  );
}

/** Pratinjau sebelum disimpan: memastikan kunci yang ditempel benar. */
function PreviewCode({ text, name }: { text: string; name: string }) {
  const parsed = parseTotpInput(text);
  if (!parsed) return null;
  return (
    <div className="space-y-1 rounded-2xl p-3 glass">
      <p className="text-xs font-semibold text-muted">
        Pratinjau — cocokkan dengan authenticator lamamu sebelum menyimpan
      </p>
      <TotpCode config={parsed.config} name={parsed.name || name || 'akun ini'} />
      <p className="font-mono text-[11px] break-all text-muted">
        {formatSecret(parsed.config.secret)}
      </p>
    </div>
  );
}
