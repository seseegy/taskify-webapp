import { Save, Timer, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FieldError } from '@/components/ui/FieldError';
import { Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast-store';
import { focusField } from '@/lib/focus';
import { parseTotpInput, totpProblem, type TotpConfig } from '../totp';
import { TotpCode } from './TotpCode';

/**
 * Cek cepat: tempel kunci rahasia, kode langsung muncul. TIDAK menyimpan apa pun dan TIDAK
 * masuk riwayat — setara 2fa.live, tetapi perhitungannya terjadi di perangkat ini dan kuncinya
 * tidak pernah dikirim ke mana pun.
 *
 * Tidak butuh kunci brankas, jadi tetap berguna saat brankas masih terkunci. `onSave` hanya
 * diberikan bila brankas terbuka (menyimpan perlu kunci enkripsi).
 */
export function TotpQuickCheck({
  onSave,
}: {
  onSave?: (title: string, config: TotpConfig) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = text.trim();
  const parsed = trimmed ? parseTotpInput(trimmed) : null;
  const problem = trimmed && !parsed ? totpProblem(trimmed) : null;

  // Nama dari URI otpauth dipakai sebagai usulan, sampai pengguna mengubahnya sendiri
  const suggested = parsed?.name || parsed?.username || '';
  const nameValue = titleTouched ? title : suggested;

  const reset = () => {
    setText('');
    setTitle('');
    setTitleTouched(false);
    setTitleError(null);
  };

  const save = async () => {
    if (!onSave || !parsed) return;
    const name = nameValue.trim();
    if (!name) {
      setTitleError('Beri nama dulu agar mudah dicari.');
      return focusField('quick-name');
    }
    setSaving(true);
    try {
      await onSave(name, parsed.config);
      toast(`"${name}" disimpan ke brankas`, { tone: 'success' });
      reset();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan.', { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-3 p-3.5 sm:p-4">
      <div>
        <Label htmlFor="quick-totp" className="flex items-center gap-1.5">
          <Timer className="size-4 text-primary" aria-hidden="true" />
          Cek cepat
        </Label>
        <Input
          id="quick-totp"
          value={text}
          maxLength={1000}
          placeholder="Tempel kunci base32 atau otpauth://totp/…"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby="quick-totp-help"
          className="font-mono"
          onChange={(e) => setText(e.target.value)}
        />
        <p id="quick-totp-help" className="mt-1.5 text-xs text-muted">
          Kode muncul langsung. <strong>Tidak disimpan</strong> dan tidak masuk riwayat.
        </p>
      </div>

      {problem && (
        <p role="status" className="text-xs text-warning">
          {problem}
        </p>
      )}

      {parsed && (
        <div className="space-y-3 border-t border-line pt-3">
          <TotpCode config={parsed.config} name={suggested || 'kunci yang ditempel'} size="lg" />

          <p className="text-xs text-muted">
            {parsed.config.digits} digit · {parsed.config.period} detik · {parsed.config.algorithm}
            {parsed.username && ` · ${parsed.username}`}
          </p>

          {onSave && (
            <div className="space-y-2">
              <Label htmlFor="quick-name">Simpan sebagai item (opsional)</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="quick-name"
                  value={nameValue}
                  maxLength={200}
                  placeholder="mis. GitHub"
                  autoComplete="off"
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? 'quick-name-err' : undefined}
                  className="min-w-0 flex-1"
                  onChange={(e) => {
                    setTitleTouched(true);
                    setTitle(e.target.value);
                    if (titleError) setTitleError(null);
                  }}
                />
                <Button onClick={() => void save()} loading={saving}>
                  <Save aria-hidden="true" /> Simpan
                </Button>
              </div>
              <FieldError id="quick-name-err">{titleError}</FieldError>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={reset}>
            <X aria-hidden="true" /> Bersihkan
          </Button>
        </div>
      )}
    </Card>
  );
}
