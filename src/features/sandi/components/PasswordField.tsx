import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { FieldError } from '@/components/ui/FieldError';
import { Input, Label } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  id: string;
  label: string;
  error?: string | null;
  hint?: ReactNode;
  mono?: boolean;
  /** Sembunyikan lagi otomatis setelah sekian ms (untuk rahasia yang sudah tersimpan) */
  autoHideMs?: number;
}

/**
 * Kolom sandi dengan tombol tampil/sembunyi. Paste dan pengelola sandi SENGAJA diizinkan
 * (WCAG 2.2 "Accessible Authentication"); isi `autoComplete` sesuai konteks pemakai.
 */
export function PasswordField({
  id,
  label,
  error,
  hint,
  mono,
  autoHideMs,
  className,
  ...props
}: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!shown || !autoHideMs) return;
    const t = setTimeout(() => setShown(false), autoHideMs);
    return () => clearTimeout(t);
  }, [shown, autoHideMs]);

  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn('pr-12', mono && 'font-mono', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={
            shown ? `Sembunyikan ${label.toLowerCase()}` : `Tampilkan ${label.toLowerCase()}`
          }
          aria-pressed={shown}
          className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-xl text-muted transition hover:text-fg"
        >
          {shown ? (
            <EyeOff className="size-[18px]" aria-hidden="true" />
          ) : (
            <Eye className="size-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 px-1 text-xs text-muted">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-err`}>{error}</FieldError>
    </div>
  );
}
