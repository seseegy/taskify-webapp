import { useId, useRef, useState } from 'react';
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
  /** Error dari form induk (mis. "Isi nominal terlebih dahulu"); ditampilkan & diumumkan. */
  error?: string;
}

const TONE = {
  expense: 'text-danger',
  income: 'text-success',
  transfer: 'text-primary',
  neutral: 'text-fg',
};

/** Tombol pintas sufiks: keyboard angka di HP tidak punya huruf, jadi "rb"/"jt" disediakan di sini. */
const SUFFIX_CHIPS = [
  { suffix: 'rb', label: 'ribu' },
  { suffix: 'jt', label: 'juta' },
] as const;

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
  error,
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const unitId = `${inputId}-unit`;
  const hintId = `${inputId}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState(() =>
    value ? new Intl.NumberFormat('id-ID').format(value) : '',
  );
  const [focused, setFocused] = useState(false);
  const parsed = text.trim() ? parseIDR(text) : null;
  // "25r" sedang diketik menuju "25rb" → jangan tampilkan error dulu selama masih fokus
  const typingSuffix = focused && isIncompleteIDR(text);
  const badFormat = text.trim() !== '' && parsed === null && !typingSuffix;
  const message = badFormat ? 'Format tidak dikenali — contoh: 25000, 25rb, 1,5jt' : error;
  const invalid = !!message;
  const usesSuffix = /[a-z]/i.test(text.replace(/^\s*rp/i, ''));
  // Chip hanya saat angka murni (belum ada sufiks) — tidak membuat "25rbrb"
  const showChips = /^[\d.,\s]*\d[\d.,\s]*$/.test(text);

  const update = (next: string) => {
    setText(next);
    onChange(next.trim() ? parseIDR(next) : null);
  };

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
          className={cn('font-semibold text-muted', size === 'lg' ? 'text-xl' : 'text-sm')}
        >
          Rp
        </span>
        <input
          ref={inputRef}
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
          onChange={(e) => update(e.target.value)}
          onBlur={() => {
            setFocused(false);
            if (parsed) setText(new Intl.NumberFormat('id-ID').format(parsed));
          }}
          className={cn(
            'min-w-0 flex-1 bg-transparent font-semibold tracking-tight outline-none placeholder:text-muted',
            size === 'lg' ? 'text-3xl' : 'text-base',
            TONE[tone],
          )}
        />
      </div>
      <div className="mt-1 flex min-h-8 items-start justify-between gap-2 px-1">
        <p id={hintId} className={cn('pt-1 text-xs', invalid ? 'text-danger' : 'text-muted')}>
          {invalid ? (
            <span role="alert">{message}</span>
          ) : usesSuffix && parsed ? (
            `= ${formatIDR(parsed)}`
          ) : (
            ''
          )}
        </p>
        {showChips && (
          <div className="flex shrink-0 gap-1.5" role="group" aria-label="Tambah satuan">
            {SUFFIX_CHIPS.map((c) => (
              <button
                key={c.suffix}
                type="button"
                aria-label={`Tambah ${c.label}`}
                // jaga fokus di input agar keyboard HP tidak menutup/membuka ulang
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  update(`${text.trim()}${c.suffix}`);
                  inputRef.current?.focus();
                }}
                className="min-h-8 min-w-10 rounded-lg px-2.5 text-xs font-semibold text-primary glass transition hover:bg-surface-strong"
              >
                {c.suffix}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
