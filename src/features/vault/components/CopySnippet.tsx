import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/toast-store';
import { cn } from '@/lib/utils';
import { fillTemplate, templateVariables } from '../vault-data';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast('Tidak bisa menyalin — izinkan akses clipboard', { tone: 'danger' });
    return false;
  }
}

/** Salin 1 klik. Jika ada {{variabel}}, isi dulu lewat dialog. */
export function CopySnippet({
  code,
  size = 'sm',
  className,
}: {
  code: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const vars = templateVariables(code);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const flash = () => {
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <>
      <Button
        size={size === 'sm' ? 'sm' : 'md'}
        variant="secondary"
        className={cn(done && 'text-success', className)}
        onClick={async (e) => {
          e.stopPropagation();
          if (vars.length) setOpen(true);
          else if (await copyText(code)) flash();
        }}
      >
        {/* Tanpa aria-label: nama tombol = teks yang terlihat (WCAG 2.5.3 Label in Name) */}
        {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {done ? 'Tersalin' : vars.length ? `Salin (${vars.length} variabel)` : 'Salin'}
      </Button>
      {/* Konfirmasi untuk pembaca layar; teks tombol berubah tapi fokus tetap, jadi tidak otomatis dibacakan */}
      <span role="status" className="sr-only">
        {done ? 'Kode tersalin' : ''}
      </span>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        variant="center"
        title="Isi variabel template"
      >
        {open && (
          <TemplateForm
            vars={vars}
            onSubmit={async (values) => {
              if (await copyText(fillTemplate(code, values))) {
                setOpen(false);
                flash();
                toast('Tersalin dengan variabel terisi', { tone: 'success' });
              }
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function TemplateForm({
  vars,
  onSubmit,
}: {
  vars: string[];
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {vars.map((v, i) => (
        <div key={v}>
          <Label htmlFor={`var-${v}`} className="font-mono">{`{{${v}}}`}</Label>
          <Input
            id={`var-${v}`}
            data-autofocus={i === 0 ? '' : undefined}
            value={values[v] ?? ''}
            onChange={(e) => setValues({ ...values, [v]: e.target.value })}
          />
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <Button type="submit">
          <Copy /> Salin
        </Button>
      </div>
    </form>
  );
}
