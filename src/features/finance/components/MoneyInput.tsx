import { useId, useState } from 'react';
import { formatIDR, isIncompleteIDR, parseIDR } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Hubungkan dengan `<Label htmlFor>`; jika kosong, id dibuat otomatis. */
  id?: string;
  /** Nama aksesibel jika tidak ada `<Label>` yang terlihat. */
  'aria-label'?: string;
  autoFocus?: boolean;
  size?: 'md' | 'lg';
  tone?: 'expense' | 'income' | 'transfer' | 'neutral';
  placeholder?: string;
}

const TONE = {
  expense: 'text-danger',
  income: 'text-success',
  transfer: 'text-primary',
  neutral: 'text-fg',
};

/**
 * Input nominal rupiah yang menerima "25000", "25.000", "25rb", "1,5jt".
 * Teks mentah disimpan apa adanya selama diketik; nilai integer dikirim lewat onChange.
 * Pesan error ditautkan lewat `aria-describedby` dan diumumkan (`role="alert"`).
 */
export function MoneyInput({
  value,
  onChange,
  id,
  'aria-label': ariaLabel,
  autoFocus,
  size = 'md',
  tone = 'neutral',
  placeholder = '0',
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const unitId = `${inputId}-unit`;
  const hintId = `${inputId}-hint`;

  const [text, setText] = useState(() =>
    value ? new Intl.NumberFormat('id-ID').format(value) : '',
  );
  const [focused, setFocused] = useState(false);
  const parsed = text.trim() ? parseIDR(text) : null;
  // "25r" sedang diketik menuju "25rb" → jangan tampilkan error dulu selama masih fokus
  const typingSuffix = focused && isIncompleteIDR(text);
  const invalid = text.trim() !== '' && parsed === null && !typingSuffix;
  const usesSuffix = /[a-z]/i.test(text.replace(/^\s*rp/i, ''));

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded-2xl px-4 glass transition focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/15',
          size === 'lg' ? 'h-16' : 'h-11',
          invalid && 'border-danger/70',
        )}
      >
        <span
          id={unitId}
          className={cn('font-bold text-muted', size === 'lg' ? 'text-xl' : 'text-sm')}
        >
          Rp
        </span>
        <input
          id={inputId}
          value={text}
          data-autofocus={autoFocus ? '' : undefined}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={`${unitId} ${hintId}`}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim() ? parseIDR(e.target.value) : null);
          }}
          onBlur={() => {
            setFocused(false);
            if (parsed) setText(new Intl.NumberFormat('id-ID').format(parsed));
          }}
          className={cn(
            'min-w-0 flex-1 bg-transparent font-extrabold tracking-tight outline-none placeholder:text-muted/50',
            size === 'lg' ? 'text-3xl' : 'text-base',
            TONE[tone],
          )}
        />
      </div>
      <p
        id={hintId}
        className={cn('mt-1 min-h-4 px-1 text-xs', invalid ? 'text-danger' : 'text-muted')}
      >
        {invalid ? (
          <span role="alert">Format tidak dikenali — contoh: 25000, 25rb, 1,5jt</span>
        ) : usesSuffix && parsed ? (
          `= ${formatIDR(parsed)}`
        ) : (
          ''
        )}
      </p>
    </div>
  );
}
