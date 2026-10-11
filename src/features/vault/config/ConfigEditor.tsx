import { Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { Input, Label } from '@/components/ui/Input';
import { formatBytes } from '@/lib/bytes';
import { cn } from '@/lib/utils';
import {
  configByteLength,
  configSizeProblem,
  CONFIG_MAX_BYTES,
  diffEntries,
  hasBlockingProblem,
  parseConfig,
  summarizeDiff,
  type ConfigFormat,
  type ConfigProblem,
} from './config-parse';

const VALIDATE_DEBOUNCE_MS = 250;
/** Penghitung ukuran baru muncul saat sudah dekat batas; sebelum itu hanya mengganggu. */
const SIZE_HINT_AT = CONFIG_MAX_BYTES * 0.8;

/**
 * Editor isi konfigurasi. Yang diedit adalah TEKS MENTAH, bukan daftar kunci-nilai: dengan begitu
 * komentar, urutan, dan baris kosong milik pengguna tidak pernah hilang (parser di sini hanya
 * memvalidasi dan menghitung ringkasan perubahan).
 *
 * Validasi berjalan sebentar setelah berhenti mengetik. `error` memblokir simpan (JSON rusak,
 * kutip tak ditutup, isi terlalu besar); `warning` tidak (kunci dobel, baris aneh).
 */
export function ConfigEditor({
  format,
  initialText,
  onCancel,
  onSave,
  saving,
  failure,
  onDirtyChange,
}: {
  format: ConfigFormat;
  initialText: string;
  onCancel: () => void;
  onSave: (text: string, note: string) => void;
  saving: boolean;
  failure: string | null;
  /** Dipakai induk untuk meminta konfirmasi sebelum menutup panel. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [text, setText] = useState(initialText);
  const [note, setNote] = useState('');
  const [settled, setSettled] = useState(initialText);
  const [submitted, setSubmitted] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const dirty = text !== initialText;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Tunda validasi: mem-parse tiap ketikan pada berkas besar membuat pengetikan tersendat
  useEffect(() => {
    const t = setTimeout(() => setSettled(text), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const { problems, diff } = useMemo(() => {
    const parsed = parseConfig(settled, format);
    const size = configSizeProblem(settled);
    const all: ConfigProblem[] = size ? [size, ...parsed.problems] : parsed.problems;
    return {
      problems: all,
      diff: diffEntries(parseConfig(initialText, format).entries, parsed.entries),
    };
  }, [settled, format, initialText]);

  const blocked = hasBlockingProblem(problems);
  const bytes = configByteLength(text);
  const changes = summarizeDiff(diff);
  const stale = settled !== text;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (blocked) {
      // Fokus ke ringkasan: di berkas panjang, pesan di bawah editor bisa di luar layar
      summaryRef.current?.focus();
      return;
    }
    onSave(text, note);
  };

  const pickFile = async (file: File) => {
    const content = await file.text();
    setText(content);
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="config-text" className="mb-0">
            Isi berkas
          </Label>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-primary transition hover:bg-surface">
            <Upload className="size-3.5" aria-hidden="true" />
            Ambil dari berkas
            <input
              type="file"
              accept=".env,.json,text/plain,application/json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <Textarea
          id="config-text"
          data-autofocus=""
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={submitted && blocked ? true : undefined}
          aria-describedby="config-problems"
          placeholder={
            format === 'json' ? '{\n  "key": "value"\n}' : 'API_URL=https://api.example.com'
          }
          className="min-h-64 font-mono text-[13px] leading-relaxed"
        />
        {bytes > SIZE_HINT_AT && (
          <p className={cn('mt-1 px-1 text-xs', blocked ? 'text-danger' : 'text-muted')}>
            {formatBytes(bytes)} dari {formatBytes(CONFIG_MAX_BYTES)}
          </p>
        )}
      </div>

      {/* Ringkasan masalah: bisa difokus dan ditautkan ke editor, bukan hanya toast */}
      <div
        id="config-problems"
        ref={summaryRef}
        tabIndex={-1}
        role={submitted && blocked ? 'alert' : undefined}
        aria-live="polite"
        className="outline-none"
      >
        {problems.length > 0 && !stale && (
          <ul className="space-y-1">
            {problems.map((p, i) => (
              <li
                key={`${p.line}-${i}`}
                className={cn(
                  'flex gap-2 rounded-xl p-2.5 text-xs',
                  p.level === 'error' ? 'bg-danger/10 text-danger' : 'bg-warning/12 text-warning',
                )}
              >
                <strong className="shrink-0">{p.level === 'error' ? 'Error' : 'Perhatian'}</strong>
                <span>
                  {p.line > 0 && <span className="font-mono">baris {p.line}: </span>}
                  {p.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Label htmlFor="config-note">Catatan perubahan (opsional)</Label>
        <Input
          id="config-note"
          value={note}
          maxLength={200}
          placeholder="mis. ganti URL Supabase"
          autoComplete="off"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {failure && (
        <p role="alert" className="text-sm font-medium text-danger">
          {failure}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        <span className="mr-auto text-xs text-muted" role="status">
          {changes ? `Perubahan: ${changes}` : 'Belum ada perubahan'}
        </span>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Batal
        </Button>
        <Button type="submit" loading={saving} disabled={!dirty || blocked}>
          Simpan versi baru
        </Button>
      </div>
    </form>
  );
}
