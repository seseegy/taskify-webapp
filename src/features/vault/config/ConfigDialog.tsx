import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError } from '@/components/ui/FieldError';
import { Input, Label } from '@/components/ui/Input';
import { Listbox } from '@/components/ui/Listbox';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import { Textarea } from '@/components/ui/Field';
import { toast } from '@/components/ui/toast-store';
import { focusField } from '@/lib/focus';
import { LIMITS } from '@/lib/limits';
import { cn } from '@/lib/utils';
import { useProjects } from '../vault-data';
import { useConfigActions, useConfigEnvironments } from './config-data';
import {
  configSizeProblem,
  guessFormat,
  hasBlockingProblem,
  parseConfig,
  type ConfigFormat,
} from './config-parse';

/** Pilihan cepat; pengguna tetap bisa mengetik nama lingkungan sendiri. */
const QUICK_ENVIRONMENTS = ['production', 'staging', 'lokal'] as const;

/**
 * Berkas konfigurasi baru. Berkas DAN versi pertamanya disimpan bersama, jadi tidak pernah ada
 * berkas tanpa isi. Butuh brankas terbuka (`dek`), karena isinya langsung dienkripsi.
 */
export function ConfigDialog({
  open,
  dek,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  dek: CryptoKey;
  defaultProjectId?: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Konfigurasi baru" wide>
      {open && (
        <Form
          dek={dek}
          defaultProjectId={defaultProjectId ?? null}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </Sheet>
  );
}

function Form({
  dek,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  dek: CryptoKey;
  defaultProjectId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const actions = useConfigActions();
  const { projects } = useProjects('');
  const environments = useConfigEnvironments();

  const [name, setName] = useState('');
  const [format, setFormat] = useState<ConfigFormat>('env');
  const [formatTouched, setFormatTouched] = useState(false);
  const [environment, setEnvironment] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [text, setText] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Format ditebak dari nama/isi sampai pengguna memilih sendiri
  const effectiveFormat = formatTouched ? format : guessFormat(name, text);
  const parsed = parseConfig(text, effectiveFormat);
  const size = configSizeProblem(text);
  const blocked = hasBlockingProblem(size ? [size, ...parsed.problems] : parsed.problems);
  const firstError = size ?? parsed.problems.find((p) => p.level === 'error') ?? null;

  const known = [...new Set([...QUICK_ENVIRONMENTS, ...environments.map((e) => e.environment)])];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Isi nama berkas, mis. `.env`.');
      return focusField('cfg-name');
    }
    if (blocked) return;
    setSaving(true);
    setFailure(null);
    try {
      const id = await actions.createFile(dek, {
        name,
        format: effectiveFormat,
        environment,
        projectId: projectId || null,
        text,
        note: 'versi pertama',
      });
      toast('Konfigurasi dibuat', { tone: 'success' });
      onCreated(id);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Gagal menyimpan.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cfg-name">Nama berkas</Label>
          <Input
            id="cfg-name"
            data-autofocus=""
            value={name}
            maxLength={LIMITS.configName}
            placeholder=".env"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'cfg-name-err' : undefined}
            className="font-mono"
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
          />
          <FieldError id="cfg-name-err">{nameError}</FieldError>
        </div>

        <div>
          <Label htmlFor="cfg-project">Project (opsional)</Label>
          <Listbox
            id="cfg-project"
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: '', label: 'Tanpa project' },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
      </div>

      <div>
        <Label id="cfg-format-label">Format</Label>
        <SegmentedControl<ConfigFormat>
          label="Format berkas"
          value={effectiveFormat}
          onChange={(f) => {
            setFormat(f);
            setFormatTouched(true);
          }}
          className="w-full sm:w-64"
          options={[
            { value: 'env', label: '.env' },
            { value: 'json', label: 'JSON' },
          ]}
        />
      </div>

      <div>
        <Label htmlFor="cfg-env">Lingkungan (opsional)</Label>
        <Input
          id="cfg-env"
          value={environment}
          maxLength={LIMITS.configEnvironment}
          placeholder="production"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby="cfg-env-help"
          onChange={(e) => setEnvironment(e.target.value)}
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {known.map((env) => (
            <button
              key={env}
              type="button"
              onClick={() => setEnvironment(env)}
              aria-pressed={environment.trim().toLowerCase() === env}
              className={cn(
                'min-h-9 rounded-lg px-2.5 text-xs font-semibold transition',
                environment.trim().toLowerCase() === env
                  ? 'bg-gradient-vault text-white'
                  : 'text-muted glass hover:text-fg',
              )}
            >
              {env}
            </button>
          ))}
        </div>
        <p id="cfg-env-help" className="mt-1 px-1 text-xs text-muted">
          Bebas diketik. Disimpan huruf kecil, mis. &ldquo;production&rdquo;.
        </p>
      </div>

      <div>
        <Label htmlFor="cfg-text">Isi (bisa ditempel sekarang atau nanti)</Label>
        <Textarea
          id="cfg-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={
            effectiveFormat === 'json'
              ? '{\n  "key": "value"\n}'
              : 'API_URL=https://api.example.com'
          }
          className="min-h-40 font-mono text-[13px]"
        />
        {firstError && (
          <p role="status" className="mt-1 px-1 text-xs text-danger">
            {firstError.line > 0 && `Baris ${firstError.line}: `}
            {firstError.message}
          </p>
        )}
      </div>

      {failure && (
        <p role="alert" className="text-sm font-medium text-danger">
          {failure}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button type="submit" loading={saving} disabled={blocked}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
